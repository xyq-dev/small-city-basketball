import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GovernanceService } from './governance-service.js';
import type { Actor, ApiOptions } from './service.js';
import { forbidden, notFound } from './errors.js';
import { emailInput, objectInput, text } from './validation.js';
import {
  allocateSponsorPool,
  allocateSponsorRefund,
  sponsorDate,
  sponsorFail,
  sponsorHash,
  sponsorId,
  sponsorInt,
  sponsorShareInput,
  sponsorVersion,
  validateSponsorAdvanceCoverage,
  assertSponsorRecipientLimit,
  type SponsorAdvanceCoverage,
} from './sponsor-commerce-domain.js';
import type { SponsorShare } from '../../../packages/contracts/sponsor-commerce.js';
import { assertSponsorRefundReadyForUnfreeze } from './sponsor-commerce-source.js';
import type { SponsorSettlementProvider } from './trade-wechat-multi-provider.js';

type Row = Record<string, any>;
export interface SponsorMerchant {
  key: string;
  merchantId: string;
  appId: string;
  displayName: string;
  maximumSplitBps: number;
  ownFundsRefundSupported?: boolean;
  financeActorIds: string[];
  receivers: Record<
    string,
    {
      merchantId: string;
      displayName: string;
      authorizationVersion: string;
      expiresAt: string;
      returnsEnabled: boolean;
    }
  >;
  provider?: SponsorSettlementProvider;
}
export interface SponsorCommerceOptions {
  enabled?: boolean;
  /** Trusted atomic reservation in the same PostgreSQL transaction. Must earmark this exact merchant/order/allocation until the common refund reaches a final state. No generic balance, client evidence or cross-order pool is accepted. */
  reserveAdvanceCoverage?: (
    c: PoolClient,
    input: Omit<
      SponsorAdvanceCoverage,
      'reservationId' | 'proofHash' | 'channelSupportsOwnFundsRefund' | 'reservedUntilRefundFinal'
    >,
  ) => Promise<SponsorAdvanceCoverage>;
  merchants?: Record<string, SponsorMerchant>;
  historicalMerchants?: Record<string, SponsorMerchant>;
  captureSourceCharge?: (
    c: PoolClient,
    actor: Actor,
    input: {
      kind: 'SPONSOR_ORDER';
      sourceId: string;
      acceptedTermsId?: string;
      chargeConsent: boolean;
    },
  ) => Promise<string | null>;
  captureSourceRefund?: (
    c: PoolClient,
    actor: Actor,
    input: {
      kind: 'SPONSOR_ORDER';
      sourceId: string;
      allocationId: string;
      amountFen: number;
      reason: string;
    },
  ) => Promise<{ refundId: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' }>;
}
const status = (actual: string, expected: string[]) => {
  if (!expected.includes(actual)) sponsorFail('SPONSOR_STATE_CONFLICT', '当前状态不支持此操作');
};
const iso = (v: Date | string) => new Date(v).toISOString();

export class SponsorCommerceService extends GovernanceService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    private commerce: SponsorCommerceOptions = {},
  ) {
    super(pool, options);
  }
  private merchant(org: string, pin?: Row) {
    const current = this.commerce.merchants?.[org];
    const m =
      pin && pin.merchant_key !== current?.key
        ? this.commerce.historicalMerchants?.[org + ':' + pin.merchant_key]
        : current;
    if (
      pin &&
      m &&
      (m.key !== pin.merchant_key ||
        m.merchantId !== pin.merchant_id ||
        m.appId !== pin.merchant_app_id)
    )
      return undefined;
    return m;
  }
  private async calendar(c: PoolClient, org: string, allowInactive = false) {
    if (
      !(
        await c.query(
          "SELECT id FROM organizations WHERE id=$1 AND ($2 OR status='ACTIVE') FOR SHARE",
          [org, allowInactive],
        )
      ).rowCount
    )
      throw notFound();
    await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT DO NOTHING', [
      org,
    ]);
    await c.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [org]);
    await c.query('SELECT x12_calendar_lock()');
  }
  private async live(c: PoolClient, org: string, pin?: Row) {
    const m = this.merchant(org, pin);
    if (!this.commerce.enabled || !m || !m.provider?.enabled || !m.provider.returnSupported)
      sponsorFail('SPONSOR_COMMERCE_DISABLED', '商业收款及多方分账尚未开通', 503);
    if (
      (
        await c.query(
          "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
        )
      ).rowCount
    )
      sponsorFail('SPONSOR_RESTORE_QUARANTINED', '恢复环境禁止渠道写入', 503);
    return m;
  }
  private async finance(c: PoolClient, a: Actor, org: string, pin?: Row) {
    await this.govAdmin(c, a, org);
    if (!this.merchant(org, pin)?.financeActorIds.includes(a.user.id)) throw forbidden();
    await this.ensureFreshSession(c, a);
  }
  private async access(c: PoolClient, a: Actor, org: string, payer?: string) {
    if (a.user.id !== payer) await this.govAdmin(c, a, org);
  }
  private async command<T extends object>(
    c: PoolClient,
    a: Actor,
    org: string,
    id: unknown,
    input: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const commandId = sponsorId(id),
      hash = sponsorHash(input);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'sponsor-command:' + a.user.id + ':' + commandId,
    ]);
    const prior = (
      await c.query(
        'SELECT * FROM sponsor_commerce_operations WHERE actor_id=$1 AND command_id=$2',
        [a.user.id, commandId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash || prior.org_id !== org)
        sponsorFail('SPONSOR_COMMAND_REUSED', '操作编号已用于其他请求');
      return prior.result;
    }
    const result = await work();
    await c.query(
      'INSERT INTO sponsor_commerce_operations(actor_id,command_id,request_hash,org_id,result) VALUES($1,$2,$3,$4,$5)',
      [a.user.id, commandId, hash, org, result],
    );
    await this.audit(c, a.user.id, org, 'SPONSOR_COMMERCE_COMMAND', 'sponsor_command', commandId, {
      requestHash: hash,
    });
    return result;
  }
  async receipt(cookie: string | undefined, rawOrg: string, rawCommand: string, cancel = false) {
    const org = sponsorId(rawOrg),
      commandId = sponsorId(rawCommand);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      if (
        !(
          await c.query(
            'SELECT 1 FROM sponsor_contracts WHERE org_id=$1 AND payer_user_id=$2 LIMIT 1',
            [org, a.user.id],
          )
        ).rowCount
      )
        await this.govAdmin(c, a, org);
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'sponsor-command:' + a.user.id + ':' + commandId,
      ]);
      const prior = (
        await c.query(
          'SELECT org_id,result FROM sponsor_commerce_operations WHERE actor_id=$1 AND command_id=$2',
          [a.user.id, commandId],
        )
      ).rows[0];
      if (prior) {
        if (prior.org_id !== org) throw forbidden();
        return { found: true, result: prior.result };
      }
      if (!cancel) return { found: false };
      const result = { cancelled: true };
      await c.query(
        'INSERT INTO sponsor_commerce_operations(actor_id,command_id,request_hash,org_id,result) VALUES($1,$2,$3,$4,$5)',
        [a.user.id, commandId, sponsorHash({ cancelled: true }), org, result],
      );
      await this.audit(
        c,
        a.user.id,
        org,
        'SPONSOR_COMMAND_CANCELLED',
        'sponsor_command',
        commandId,
        {},
      );
      return { found: true, result };
    });
  }
  async list(cookie: string | undefined, rawOrg: string) {
    const org = sponsorId(rawOrg);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const admin = !!(
        await c.query(
          "SELECT 1 FROM organization_memberships WHERE org_id=$1 AND user_id=$2 AND role IN('ORG_OWNER','ORG_ADMIN') AND status='ACTIVE'",
          [org, a.user.id],
        )
      ).rowCount;
      if (
        !admin &&
        !(
          await c.query(
            'SELECT 1 FROM sponsor_contracts WHERE org_id=$1 AND payer_user_id=$2 LIMIT 1',
            [org, a.user.id],
          )
        ).rowCount
      )
        throw forbidden();
      if (admin) await this.govAdmin(c, a, org);
      const contracts = (
        await c.query(
          'SELECT * FROM sponsor_contracts WHERE org_id=$1 AND ($3 OR payer_user_id=$2) ORDER BY created_at DESC,id LIMIT 100',
          [org, a.user.id, admin],
        )
      ).rows;
      const orders = (
        await c.query(
          `SELECT o.*,t.id AS trade_order_id,COALESCE((SELECT sum(p.total_fen) FROM trade_payment_attempts p WHERE p.order_id=t.id AND p.status='PAID'),0)::integer AS paid_fen FROM sponsor_orders o LEFT JOIN trade_orders t ON t.source_id=o.id AND t.kind='SPONSOR_ORDER' WHERE o.org_id=$1 AND ($3 OR o.payer_user_id=$2) ORDER BY o.created_at DESC,o.id LIMIT 100`,
          [org, a.user.id, admin],
        )
      ).rows;
      const m = this.merchant(org);
      return {
        enabled:
          !!this.commerce.enabled && !!m?.provider?.enabled && !!m?.provider?.returnSupported,
        canManage: admin,
        canFinance: admin && !!m?.financeActorIds.includes(a.user.id),
        canAdvance:
          admin &&
          !!m?.financeActorIds.includes(a.user.id) &&
          m.ownFundsRefundSupported === true &&
          !!this.commerce.reserveAdvanceCoverage,
        userId: a.user.id,
        campaignOptions: admin
          ? (
              await c.query(
                "SELECT id,title,starts_at,ends_at FROM sponsorship_campaigns WHERE org_id=$1 AND status NOT IN('REJECTED','WITHDRAWN') ORDER BY created_at DESC,id LIMIT 100",
                [org],
              )
            ).rows
          : [],
        contracts: contracts.map((r) => ({ ...r, contractHash: this.contractHash(r) })),
        orders,
        beneficiaries: admin
          ? (
              await c.query(
                'SELECT * FROM sponsor_beneficiaries WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT 100',
                [org],
              )
            ).rows
          : [],
        receiverOptions: admin
          ? Object.entries(m?.receivers ?? {}).map(([beneficiaryOrgId, v]) => ({
              beneficiaryOrgId,
              displayName: v.displayName,
              authorizationVersion: v.authorizationVersion,
            }))
          : [],
      };
    });
  }
  async beneficiary(cookie: string | undefined, rawOrg: string, raw: unknown) {
    const org = sponsorId(rawOrg),
      b = objectInput(raw, [
        'commandId',
        'action',
        'id',
        'expectedVersion',
        'beneficiaryOrgId',
        'evidence',
      ]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      await this.finance(c, a, org);
      return this.command(c, a, org, b.commandId, { org, beneficiary: b }, async () => {
        if (b.action === 'PROPOSE') {
          const target = sponsorId(b.beneficiaryOrgId),
            cfg = this.merchant(org)?.receivers[target];
          if (!cfg || !cfg.returnsEnabled || Date.parse(cfg.expiresAt) <= Date.now())
            sponsorFail('SPONSOR_RECEIVER_UNAVAILABLE', '受益主体尚未完成商户授权配置');
          const id = randomUUID();
          await c.query(
            'INSERT INTO sponsor_beneficiaries(id,org_id,beneficiary_org_id,merchant_id,display_name,authorization_version,evidence,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              id,
              org,
              target,
              cfg.merchantId,
              cfg.displayName,
              cfg.authorizationVersion,
              text(b.evidence, 'evidence', 4, 2000),
              sponsorDate(cfg.expiresAt),
              a.user.id,
            ],
          );
          return { id, status: 'IN_REVIEW', version: 1 };
        }
        const r = (
          await c.query(
            'SELECT * FROM sponsor_beneficiaries WHERE id=$1 AND org_id=$2 FOR UPDATE',
            [sponsorId(b.id), org],
          )
        ).rows[0];
        if (!r) throw notFound();
        sponsorVersion(r.version, b.expectedVersion);
        if (r.created_by === a.user.id) throw forbidden();
        status(r.status, b.action === 'DISABLE' ? ['APPROVED'] : ['IN_REVIEW']);
        const next =
          b.action === 'APPROVE'
            ? 'APPROVED'
            : b.action === 'REJECT'
              ? 'REJECTED'
              : b.action === 'DISABLE'
                ? 'DISABLED'
                : sponsorFail('SPONSOR_INVALID_ACTION', '操作无效', 422);
        await c.query(
          'UPDATE sponsor_beneficiaries SET status=$2,reviewed_by=$3,version=version+1 WHERE id=$1',
          [r.id, next, a.user.id],
        );
        return { id: r.id, status: next, version: r.version + 1 };
      });
    });
  }
  async createContract(cookie: string | undefined, rawOrg: string, raw: unknown) {
    const org = sponsorId(rawOrg),
      b = objectInput(raw, [
        'commandId',
        'campaignId',
        'payerUserId',
        'payerEmail',
        'title',
        'totalFen',
        'allowedFeeFen',
        'terms',
        'startsAt',
        'endsAt',
        'shares',
      ]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      await this.govAdmin(c, a, org);
      return this.command(c, a, org, b.commandId, { org, contract: b }, async () => {
        const m = await this.live(c, org);
        if (b.payerUserId !== undefined && b.payerEmail !== undefined)
          sponsorFail('SPONSOR_INVALID_CONTRACT', '请只提供一个广告主身份', 422);
        const payer =
          b.payerEmail === undefined
            ? sponsorId(b.payerUserId)
            : (
                await c.query("SELECT id FROM users WHERE email=$1 AND status='ACTIVE' FOR SHARE", [
                  emailInput(b.payerEmail),
                ])
              ).rows[0]?.id;
        if (!payer) sponsorFail('SPONSOR_PAYER_UNAVAILABLE', '未找到可签署合同的广告主账户', 422);
        const total = sponsorInt(b.totalFen, 1),
          fee = sponsorInt(b.allowedFeeFen, 0, total - 1),
          start = sponsorDate(b.startsAt),
          end = sponsorDate(b.endsAt);
        if (payer === a.user.id || Date.parse(start) >= Date.parse(end))
          sponsorFail('SPONSOR_INVALID_CONTRACT', '合同双方及投放时段无效', 422);
        const campaign = (
          await c.query(
            'SELECT id,starts_at,ends_at,status FROM sponsorship_campaigns WHERE id=$1 AND org_id=$2 FOR SHARE',
            [sponsorId(b.campaignId), org],
          )
        ).rows[0];
        if (
          !campaign ||
          ['REJECTED', 'WITHDRAWN'].includes(campaign.status) ||
          Date.parse(start) < new Date(campaign.starts_at).getTime() ||
          Date.parse(end) > new Date(campaign.ends_at).getTime()
        )
          sponsorFail('SPONSOR_CAMPAIGN_MISMATCH', '投放记录与合同机构或时段不一致', 422);
        if (
          !(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [payer]))
            .rowCount
        )
          throw notFound();
        const shares: SponsorShare[] = [];
        const requestedShares = sponsorShareInput(b.shares);
        assertSponsorRecipientLimit(
          requestedShares.map((x) => ({ retained: x.beneficiaryOrgId === org })),
        );
        for (const x of requestedShares) {
          if (x.beneficiaryOrgId === org) {
            shares.push({
              id: org,
              beneficiaryOrgId: org,
              merchantId: m.merchantId,
              displayName: m.displayName,
              basisPoints: x.basisPoints,
              retained: true,
              authorizationVersion: m.key,
            });
            continue;
          }
          const cfg = m.receivers[x.beneficiaryOrgId];
          const approved = (
            await c.query(
              "SELECT * FROM sponsor_beneficiaries WHERE org_id=$1 AND beneficiary_org_id=$2 AND status='APPROVED' AND expires_at>clock_timestamp() AND authorization_version=$3 FOR SHARE",
              [org, x.beneficiaryOrgId, cfg?.authorizationVersion ?? ''],
            )
          ).rows[0];
          if (
            !cfg ||
            !cfg.returnsEnabled ||
            !approved ||
            approved.merchant_id !== cfg.merchantId ||
            Date.parse(cfg.expiresAt) <= Date.now()
          )
            sponsorFail('SPONSOR_RECEIVER_UNAPPROVED', '受益主体缺少有效独立审核或回退授权');
          shares.push({
            id: x.beneficiaryOrgId,
            beneficiaryOrgId: x.beneficiaryOrgId,
            merchantId: cfg.merchantId,
            displayName: cfg.displayName,
            basisPoints: x.basisPoints,
            retained: false,
            authorizationVersion: cfg.authorizationVersion,
          });
        }
        if (
          new Set(shares.map((x) => x.merchantId)).size !== shares.length ||
          shares.filter((x) => !x.retained).reduce((s, x) => s + x.basisPoints, 0) >
            sponsorInt(m.maximumSplitBps, 0, 10000)
        )
          sponsorFail('SPONSOR_CHANNEL_LIMIT', '接收商户重复或超出商户允许的分账比例');
        const id = randomUUID();
        await c.query(
          'INSERT INTO sponsor_contracts(id,org_id,campaign_id,payer_user_id,beneficiary_user_id,title,total_fen,allowed_fee_fen,terms,starts_at,ends_at,merchant_key,merchant_id,merchant_app_id,shares,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$5)',
          [
            id,
            org,
            campaign.id,
            payer,
            a.user.id,
            text(b.title, 'title', 1, 120),
            total,
            fee,
            text(b.terms, 'terms', 4, 4000),
            start,
            end,
            m.key,
            m.merchantId,
            m.appId,
            JSON.stringify(shares),
          ],
        );
        return { id, status: 'DRAFT', version: 1 };
      });
    });
  }
  async contractCommand(cookie: string | undefined, rawOrg: string, rawId: string, raw: unknown) {
    const org = sponsorId(rawOrg),
      id = sponsorId(rawId),
      b = objectInput(raw, ['commandId', 'expectedVersion', 'action', 'acceptedContractHash']);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const r = (
        await c.query('SELECT * FROM sponsor_contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [
          id,
          org,
        ])
      ).rows[0];
      if (!r) throw notFound();
      await this.access(c, a, org, r.payer_user_id);
      return this.command(c, a, org, b.commandId, { org, id, contractCommand: b }, async () => {
        sponsorVersion(r.version, b.expectedVersion);
        await this.ensureFreshSession(c, a);
        if (b.action === 'SUBMIT') {
          await this.govAdmin(c, a, org);
          status(r.status, ['DRAFT']);
          await c.query(
            "UPDATE sponsor_contracts SET status='IN_REVIEW',version=version+1 WHERE id=$1",
            [id],
          );
        } else if (b.action === 'APPROVE' || b.action === 'REJECT') {
          await this.finance(c, a, org, r);
          status(r.status, ['IN_REVIEW']);
          if ([r.created_by, r.payer_user_id].includes(a.user.id)) throw forbidden();
          await c.query(
            'UPDATE sponsor_contracts SET status=$2,reviewed_by=$3,reviewed_at=clock_timestamp(),version=version+1 WHERE id=$1',
            [id, b.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', a.user.id],
          );
        } else if (b.action === 'OWNER_SIGN') {
          await this.govAdmin(c, a, org);
          status(r.status, ['APPROVED']);
          if (a.user.id === r.payer_user_id || a.user.id === r.reviewed_by || r.owner_signed_by)
            throw forbidden();
          await c.query(
            'UPDATE sponsor_contracts SET owner_signed_by=$2,version=version+1 WHERE id=$1',
            [id, a.user.id],
          );
        } else if (b.action === 'ADVERTISER_SIGN') {
          status(r.status, ['APPROVED']);
          if (a.user.id !== r.payer_user_id) throw forbidden();
          if (!r.owner_signed_by || b.acceptedContractHash !== this.contractHash(r))
            sponsorFail('SPONSOR_SIGNATURE_MISMATCH', '请重新核对已冻结的合同及签署人');
          await c.query(
            "UPDATE sponsor_contracts SET status='SIGNED',advertiser_signed_at=clock_timestamp(),version=version+1 WHERE id=$1",
            [id],
          );
        } else sponsorFail('SPONSOR_INVALID_ACTION', '操作无效', 422);
        const out = (await c.query('SELECT * FROM sponsor_contracts WHERE id=$1', [id])).rows[0];
        return { ...out, contractHash: this.contractHash(out) };
      });
    });
  }
  private contractHash(r: Row) {
    return sponsorHash({
      id: r.id,
      org: r.org_id,
      payer: r.payer_user_id,
      total: r.total_fen,
      fee: r.allowed_fee_fen,
      terms: r.terms,
      shares: r.shares,
      start: iso(r.starts_at),
      end: iso(r.ends_at),
      merchant: r.merchant_id,
      appId: r.merchant_app_id,
      reviewer: r.reviewed_by,
      ownerSigner: r.owner_signed_by,
    });
  }
  async createOrder(cookie: string | undefined, rawOrg: string, raw: unknown) {
    const org = sponsorId(rawOrg),
      b = objectInput(raw, [
        'commandId',
        'contractId',
        'expectedVersion',
        'acceptedContractHash',
        'chargeConsent',
      ]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const r = (
        await c.query('SELECT * FROM sponsor_contracts WHERE id=$1 AND org_id=$2 FOR UPDATE', [
          sponsorId(b.contractId),
          org,
        ])
      ).rows[0];
      if (!r) throw notFound();
      if (a.user.id !== r.payer_user_id) throw forbidden();
      return this.command(c, a, org, b.commandId, { org, order: b }, async () => {
        await this.live(c, org, r);
        sponsorVersion(r.version, b.expectedVersion);
        status(r.status, ['SIGNED']);
        if (b.acceptedContractHash !== this.contractHash(r))
          sponsorFail('SPONSOR_SIGNATURE_MISMATCH', '请重新核对合同');
        if (new Date(r.ends_at).getTime() <= Date.now())
          sponsorFail('SPONSOR_CONTRACT_EXPIRED', '投放合同已到期');
        if ((await c.query('SELECT 1 FROM sponsor_orders WHERE contract_id=$1', [r.id])).rowCount)
          sponsorFail('SPONSOR_ORDER_EXISTS', '合同已经生成订单');
        const id = randomUUID(),
          snapshot = {
            contractId: r.id,
            contractHash: this.contractHash(r),
            shares: r.shares,
            allowedFeeFen: r.allowed_fee_fen,
            startsAt: iso(r.starts_at),
            endsAt: iso(r.ends_at),
            ownerSigner: r.owner_signed_by,
            advertiserSignedAt: iso(r.advertiser_signed_at),
            reviewer: r.reviewed_by,
          };
        await c.query(
          'INSERT INTO sponsor_orders(id,org_id,contract_id,payer_user_id,beneficiary_user_id,title,total_fen,merchant_key,merchant_id,merchant_app_id,terms,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$4)',
          [
            id,
            org,
            r.id,
            r.payer_user_id,
            r.beneficiary_user_id,
            r.title,
            r.total_fen,
            r.merchant_key,
            r.merchant_id,
            r.merchant_app_id,
            r.terms,
            snapshot,
          ],
        );
        if (b.chargeConsent !== true)
          sponsorFail('SPONSOR_CHARGE_CONSENT_REQUIRED', '须明确同意按冻结合同收费', 422);
        if (!this.commerce.captureSourceCharge)
          sponsorFail('SPONSOR_CHARGE_BRIDGE_DISABLED', '统一收款尚未接通', 503);
        const tradeOrderId = await this.commerce.captureSourceCharge(c, a, {
          kind: 'SPONSOR_ORDER',
          sourceId: id,
          acceptedTermsId: r.id,
          chargeConsent: true,
        });
        if (!tradeOrderId)
          sponsorFail('SPONSOR_CHARGE_BRIDGE_DISABLED', '未能建立统一交易，合同订单尚未创建', 503);
        return { id, status: 'WAITING_PAYMENT', version: 1, tradeOrderId };
      });
    });
  }
  private async lockOrder(c: PoolClient, org: string, id: string) {
    const t = (
      await c.query(
        "SELECT * FROM trade_orders WHERE org_id=$1 AND source_id=$2 AND kind='SPONSOR_ORDER' FOR UPDATE",
        [org, id],
      )
    ).rows[0];
    const o = (
      await c.query('SELECT * FROM sponsor_orders WHERE org_id=$1 AND id=$2 FOR UPDATE', [org, id])
    ).rows[0];
    if (!o) throw notFound();
    return { o, t };
  }
  private async money(c: PoolClient, t: Row | undefined) {
    if (!t) sponsorFail('SPONSOR_PAYMENT_REQUIRED', '尚无统一交易订单');
    const payments = (
      await c.query(
        "SELECT * FROM trade_payment_attempts WHERE order_id=$1 AND status='PAID' ORDER BY paid_at,id FOR SHARE",
        [t.id],
      )
    ).rows;
    if (
      payments.length !== 1 ||
      payments[0]!.total_fen !== t.total_fen ||
      !payments[0]!.provider_transaction_id ||
      !payments[0]!.profit_sharing
    )
      sponsorFail('SPONSOR_PAYMENT_REQUIRED', '须有已核验且允许分账的唯一实收记录');
    const refunds = (
      await c.query('SELECT * FROM trade_refunds WHERE order_id=$1 ORDER BY created_at,id', [t.id])
    ).rows;
    if (
      (
        await c.query(
          "SELECT 1 FROM trade_settlements WHERE order_id=$1 AND status NOT IN('REJECTED','FAILED')",
          [t.id],
        )
      ).rowCount ||
      (
        await c.query(
          "SELECT 1 FROM trade_deductions WHERE order_id=$1 AND status NOT IN('REJECTED','REVERSED')",
          [t.id],
        )
      ).rowCount
    )
      sponsorFail('SPONSOR_FOREIGN_ALLOCATION', '存在非广告分配记录，须先核对');
    return {
      p: payments[0]!,
      refunds,
      refunded: refunds
        .filter((r) => r.status === 'SUCCEEDED')
        .reduce((s, r) => s + r.amount_fen, 0),
      reserved: refunds
        .filter((r) => !['REJECTED', 'FAILED'].includes(r.status))
        .reduce((s, r) => s + r.amount_fen, 0),
    };
  }
  async get(cookie: string | undefined, rawOrg: string, rawId: string) {
    const org = sponsorId(rawOrg),
      id = sponsorId(rawId);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const { o, t } = await this.lockOrder(c, org, id);
      await this.access(c, a, org, o.payer_user_id);
      const contract = (
        await c.query('SELECT * FROM sponsor_contracts WHERE id=$1', [o.contract_id])
      ).rows[0];
      const batches = (
        await c.query('SELECT * FROM sponsor_settlement_batches WHERE order_id=$1', [id])
      ).rows;
      return {
        order: o,
        tradeOrderId: t?.id ?? null,
        contract: { ...contract, contractHash: this.contractHash(contract) },
        deliveries: (
          await c.query(
            'SELECT * FROM sponsor_deliveries WHERE order_id=$1 ORDER BY created_at DESC,id',
            [id],
          )
        ).rows,
        batches,
        items: batches.length
          ? (
              await c.query(
                'SELECT * FROM sponsor_settlement_items WHERE batch_id=$1 ORDER BY beneficiary_org_id',
                [batches[0]!.id],
              )
            ).rows
          : [],
        refunds: (
          await c.query(
            'SELECT p.*,r.status AS refund_status FROM sponsor_refund_plans p LEFT JOIN trade_refunds r ON r.id=p.trade_refund_id WHERE p.order_id=$1 ORDER BY p.created_at,p.id',
            [id],
          )
        ).rows,
        returns: (
          await c.query(
            'SELECT r.* FROM sponsor_return_items r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id=$1 ORDER BY r.id',
            [id],
          )
        ).rows,
        recovery: (
          await c.query(
            'SELECT r.* FROM sponsor_recovery_cases r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE p.order_id=$1 ORDER BY r.id',
            [id],
          )
        ).rows,
      };
    });
  }
  async orderCommand(
    cookie: string | undefined,
    rawOrg: string,
    rawId: string,
    raw: unknown,
  ): Promise<Row> {
    const org = sponsorId(rawOrg),
      id = sponsorId(rawId),
      b = objectInput(raw, [
        'commandId',
        'expectedVersion',
        'action',
        'childId',
        'evidence',
        'reason',
        'amountFen',
        'outcome',
      ]);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const { o, t } = await this.lockOrder(c, org, id);
      await this.access(c, a, org, o.payer_user_id);
      return this.command(c, a, org, b.commandId, { org, id, orderCommand: b }, async () => {
        sponsorVersion(o.version, b.expectedVersion);
        let result: Row = { id };
        if (b.action === 'DELIVERY') {
          await this.govAdmin(c, a, org);
          status(o.status, ['WAITING_PAYMENT', 'DELIVERING']);
          await this.money(c, t);
          const child = randomUUID();
          await c.query(
            'INSERT INTO sponsor_deliveries(id,org_id,order_id,evidence,created_by) VALUES($1,$2,$3,$4,$5)',
            [child, org, id, text(b.evidence, 'evidence', 4, 2000), a.user.id],
          );
          await c.query("UPDATE sponsor_orders SET status='DELIVERING' WHERE id=$1", [id]);
          result = { id, deliveryId: child };
        } else if (b.action === 'ACCEPT' || b.action === 'DISPUTE') {
          if (a.user.id !== o.payer_user_id) throw forbidden();
          status(o.status, ['DELIVERING', 'ACCEPTED', 'DISPUTED']);
          const d = (
            await c.query(
              'SELECT * FROM sponsor_deliveries WHERE id=$1 AND order_id=$2 FOR UPDATE',
              [sponsorId(b.childId), id],
            )
          ).rows[0];
          if (!d) throw notFound();
          status(d.status, ['PROPOSED', 'ACCEPTED', 'DISPUTED']);
          const next = b.action === 'ACCEPT' ? 'ACCEPTED' : 'DISPUTED';
          if (next === 'ACCEPTED') {
            status(d.status, ['PROPOSED', 'DISPUTED']);
            if (d.status === 'DISPUTED') text(b.reason, 'reason', 4, 1000);
            await this.money(c, t);
          }
          await c.query(
            'UPDATE sponsor_deliveries SET status=$2,reviewed_by=$3,reviewed_at=clock_timestamp(),reason=$4 WHERE id=$1',
            [
              d.id,
              next,
              a.user.id,
              b.action === 'DISPUTE' ? text(b.reason, 'reason', 4, 1000) : null,
            ],
          );
          await c.query(
            "UPDATE sponsor_orders SET status=$2,accepted_at=CASE WHEN $2='ACCEPTED' THEN clock_timestamp() ELSE accepted_at END WHERE id=$1",
            [id, next],
          );
        } else if (b.action === 'VERIFY_FEE') {
          await this.finance(c, a, org, o);
          if ([o.created_by, o.beneficiary_user_id].includes(a.user.id)) throw forbidden();
          if (o.verified_fee_fen !== null) sponsorFail('SPONSOR_FEE_FROZEN', '手续费证据已冻结');
          await this.money(c, t);
          const fee = sponsorInt(b.amountFen, 0, o.snapshot.allowedFeeFen);
          await c.query(
            'UPDATE sponsor_orders SET verified_fee_fen=$2,fee_evidence=$3,fee_verified_by=$4 WHERE id=$1',
            [id, fee, text(b.evidence, 'evidence', 4, 2000), a.user.id],
          );
        } else if (b.action === 'PROPOSE_SETTLEMENT') {
          await this.govAdmin(c, a, org);
          const m = await this.live(c, org, o);
          status(o.status, ['ACCEPTED']);
          const money = await this.money(c, t);
          if (o.verified_fee_fen === null || money.reserved !== money.refunded)
            sponsorFail('SPONSOR_SETTLEMENT_BLOCKED', '手续费未核验或仍有退款处理中');
          if (
            (
              await c.query(
                "SELECT 1 FROM sponsor_refund_plans WHERE order_id=$1 AND status NOT IN('REJECTED','CLAIMED')",
                [id],
              )
            ).rowCount ||
            (
              await c.query(
                "SELECT 1 FROM sponsor_settlement_batches WHERE order_id=$1 AND status<>'REJECTED'",
                [id],
              )
            ).rowCount
          )
            sponsorFail('SPONSOR_SETTLEMENT_EXISTS', '已有分配或退款计划未完成');
          const pool = money.p.total_fen - money.refunded - o.verified_fee_fen;
          if (pool < 0) sponsorFail('SPONSOR_INVALID_POOL', '实收不足以覆盖退款和手续费');
          const allocation = allocateSponsorPool(pool, o.snapshot.shares);
          await this.validateReceivers(c, org, m, allocation);
          const batch = randomUUID(),
            out = 'SCBADS' + batch.replaceAll('-', '');
          await c.query('UPDATE trade_orders SET money_version=money_version+1 WHERE id=$1', [
            t!.id,
          ]);
          await c.query(
            'INSERT INTO sponsor_settlement_batches(id,org_id,order_id,trade_order_id,payment_id,transaction_id,out_order_no,pool_fen,source_hash,money_version,proposed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
            [
              batch,
              org,
              id,
              t!.id,
              money.p.id,
              money.p.provider_transaction_id,
              out,
              pool,
              this.settlementHash(o, t!, money),
              t!.money_version + 1,
              a.user.id,
            ],
          );
          for (const x of allocation)
            await c.query(
              'INSERT INTO sponsor_settlement_items(id,org_id,batch_id,beneficiary_org_id,receiver_merchant_id,display_name,authorization_version,amount_fen,retained,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
              [
                randomUUID(),
                org,
                batch,
                x.beneficiaryOrgId,
                x.merchantId,
                x.displayName,
                x.authorizationVersion,
                x.amountFen,
                x.retained,
                x.retained ? 'RETAINED' : 'PENDING',
              ],
            );
          result = { id, batchId: batch, status: 'IN_REVIEW' };
        } else if (b.action === 'APPROVE_SETTLEMENT' || b.action === 'REJECT_SETTLEMENT') {
          await this.finance(c, a, org, o);
          const batch = await this.batch(c, id, sponsorId(b.childId));
          status(batch.status, ['IN_REVIEW']);
          if (
            [
              batch.proposed_by,
              o.payer_user_id,
              o.beneficiary_user_id,
              o.snapshot.ownerSigner,
            ].includes(a.user.id) ||
            batch.approvals.includes(a.user.id)
          )
            throw forbidden();
          await this.checkSettlement(c, o, t!, batch);
          const approvals = [...batch.approvals, a.user.id],
            next =
              b.action === 'REJECT_SETTLEMENT'
                ? 'REJECTED'
                : approvals.length >= batch.approval_required
                  ? 'APPROVED'
                  : 'IN_REVIEW';
          await c.query(
            'UPDATE sponsor_settlement_batches SET status=$2,approvals=$3,version=version+1 WHERE id=$1',
            [batch.id, next, approvals],
          );
          result = { id, batchId: batch.id, status: next };
        } else if (b.action === 'PROPOSE_REFUND') {
          const money = await this.money(c, t),
            amount = sponsorInt(b.amountFen, 1),
            reason = text(b.reason, 'reason', 4, 1000);
          if (
            money.reserved !== money.refunded ||
            (
              await c.query(
                "SELECT 1 FROM sponsor_refund_plans WHERE order_id=$1 AND status NOT IN('REJECTED','CLAIMED')",
                [id],
              )
            ).rowCount
          )
            sponsorFail('SPONSOR_REFUND_PENDING', '先处理原退款计划及退款结果');
          if (amount > money.p.total_fen - money.reserved)
            sponsorFail('SPONSOR_REFUND_EXCEEDS_PAID', '退款超过实收余额');
          let batch = (
            await c.query(
              "SELECT * FROM sponsor_settlement_batches WHERE order_id=$1 AND status<>'REJECTED' FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (batch && ['IN_REVIEW', 'APPROVED'].includes(batch.status)) {
            await c.query(
              "UPDATE sponsor_settlement_batches SET status='REJECTED',version=version+1 WHERE id=$1",
              [batch.id],
            );
            batch = undefined;
          }
          if (batch && !['SUCCEEDED', 'PARTIAL'].includes(batch.status))
            sponsorFail('SPONSOR_SPLIT_UNKNOWN', '先逐项查询原分账，未知金额不能重新分配');
          if (
            (
              await c.query(
                "SELECT 1 FROM sponsor_refund_plans p LEFT JOIN trade_refunds r ON r.id=p.trade_refund_id WHERE p.order_id=$1 AND p.status='CLAIMED' AND r.status<>'SUCCEEDED'",
                [id],
              )
            ).rowCount
          )
            sponsorFail('SPONSOR_REFUND_PENDING', '原退款义务仍未完成，请查询原退款');
          const plan = randomUUID();
          let reduction = 0;
          if (batch) {
            const previous = Number(
              (
                await c.query(
                  "SELECT COALESCE(sum(pool_reduction_fen),0)::integer AS n FROM sponsor_refund_plans WHERE batch_id=$1 AND status<>'REJECTED'",
                  [batch.id],
                )
              ).rows[0].n,
            );
            reduction = Math.min(amount, batch.pool_fen - previous);
            const items = (
              await c.query(
                'SELECT * FROM sponsor_settlement_items WHERE batch_id=$1 ORDER BY beneficiary_org_id',
                [batch.id],
              )
            ).rows;
            const original = items.map((x) => ({
                id: x.beneficiary_org_id,
                amountFen: x.amount_fen,
              })),
              before = allocateSponsorRefund(previous, original),
              after = allocateSponsorRefund(previous + reduction, original);
            await c.query(
              "INSERT INTO sponsor_refund_plans(id,org_id,order_id,batch_id,amount_fen,pool_reduction_fen,reason,status,proposed_by) VALUES($1,$2,$3,$4,$5,$6,$7,'IN_REVIEW',$8)",
              [plan, org, id, batch.id, amount, reduction, reason, a.user.id],
            );
            for (let n = 0; n < items.length; n++) {
              const item = items[n]!,
                share = after[n]!.refundFen - before[n]!.refundFen;
              if (!share) continue;
              if (!['RETAINED', 'SUCCEEDED', 'FAILED'].includes(item.status))
                sponsorFail('SPONSOR_SPLIT_UNKNOWN', '存在尚未核验的分账项');
              const rid = randomUUID();
              await c.query(
                'INSERT INTO sponsor_return_items(id,org_id,refund_plan_id,settlement_item_id,amount_fen,out_return_no,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
                [
                  rid,
                  org,
                  plan,
                  item.id,
                  share,
                  'SCBADSR' + rid.replaceAll('-', ''),
                  item.status === 'SUCCEEDED' ? 'PENDING' : 'NOT_REQUIRED',
                ],
              );
            }
          } else
            await c.query(
              "INSERT INTO sponsor_refund_plans(id,org_id,order_id,amount_fen,pool_reduction_fen,reason,status,proposed_by) VALUES($1,$2,$3,$4,0,$5,'IN_REVIEW',$6)",
              [plan, org, id, amount, reason, a.user.id],
            );
          await c.query('UPDATE trade_orders SET money_version=money_version+1 WHERE id=$1', [
            t!.id,
          ]);
          result = { id, refundPlanId: plan, status: 'IN_REVIEW' };
        } else if (b.action === 'APPROVE_REFUND' || b.action === 'REJECT_REFUND') {
          await this.finance(c, a, org, o);
          const p = await this.refundPlan(c, id, sponsorId(b.childId));
          status(p.status, ['IN_REVIEW']);
          if ([p.proposed_by, o.payer_user_id, o.beneficiary_user_id].includes(a.user.id))
            throw forbidden();
          const money = await this.money(c, t);
          if (p.amount_fen > money.p.total_fen - money.reserved)
            sponsorFail('SPONSOR_REFUND_EXCEEDS_PAID', '退款余额已变化');
          const pending = (
            await c.query(
              "SELECT 1 FROM sponsor_return_items WHERE refund_plan_id=$1 AND status<>'NOT_REQUIRED'",
              [p.id],
            )
          ).rowCount;
          const next =
            b.action === 'REJECT_REFUND' ? 'REJECTED' : pending ? 'APPROVED' : 'READY_FOR_REFUND';
          await c.query(
            'UPDATE sponsor_refund_plans SET status=$2,reviewed_by=$3,version=version+1 WHERE id=$1',
            [p.id, next, a.user.id],
          );
          result = { id, refundPlanId: p.id, status: next };
        } else if (b.action === 'CLOSE_ORDER') {
          await this.finance(c, a, org, o);
          const money = await this.money(c, t);
          if (
            money.reserved !== money.refunded ||
            (
              await c.query(
                "SELECT 1 FROM sponsor_refund_plans p WHERE p.order_id=$1 AND p.status NOT IN('REJECTED','CLAIMED')",
                [id],
              )
            ).rowCount ||
            (
              await c.query(
                "SELECT 1 FROM sponsor_recovery_cases k JOIN sponsor_refund_plans p ON p.id=k.refund_plan_id WHERE p.order_id=$1 AND k.status='OPEN'",
                [id],
              )
            ).rowCount
          )
            sponsorFail('SPONSOR_OBLIGATION_OPEN', '退款或追偿义务尚未完成');
          if (
            money.refunded !== money.p.total_fen &&
            (o.status !== 'ACCEPTED' ||
              !(
                await c.query(
                  "SELECT 1 FROM sponsor_settlement_batches WHERE order_id=$1 AND status='SUCCEEDED' AND finished",
                  [id],
                )
              ).rowCount)
          )
            sponsorFail('SPONSOR_OBLIGATION_OPEN', '需全额退款，或完成验收及最终分账');
          await c.query("UPDATE sponsor_orders SET status='CLOSED' WHERE id=$1", [id]);
          await c.query(
            "UPDATE sponsor_contracts SET status='CLOSED',version=version+1 WHERE id=$1",
            [o.contract_id],
          );
          result = { id, status: 'CLOSED' };
        } else if (b.action === 'ADVANCE_PROPOSE' || b.action === 'ADVANCE_APPROVE') {
          await this.finance(c, a, org, o);
          if (
            (
              await c.query(
                "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
              )
            ).rowCount
          )
            sponsorFail('SPONSOR_RESTORE_QUARANTINED', '恢复环境禁止新增资金锁定', 503);
          const merchant = this.merchant(org, o),
            reserve = this.commerce.reserveAdvanceCoverage;
          if (!merchant?.ownFundsRefundSupported || !reserve)
            sponsorFail(
              'SPONSOR_ADVANCE_DISABLED',
              '原商户尚未配置自有资金退款及可信资金锁定核验',
              503,
            );
          const p = await this.refundPlan(c, id, sponsorId(b.childId));
          status(p.status, ['RECOVERY_REQUIRED']);
          if ([o.payer_user_id, o.beneficiary_user_id].includes(a.user.id) || p.advance_coverage)
            throw forbidden();
          const returns = (
            await c.query('SELECT * FROM sponsor_return_items WHERE refund_plan_id=$1 FOR UPDATE', [
              p.id,
            ])
          ).rows;
          if (
            !returns.some((r) => r.status === 'FAILED') ||
            returns.some((r) => !['NOT_REQUIRED', 'SUCCEEDED', 'FAILED'].includes(r.status))
          )
            sponsorFail('SPONSOR_RETURN_UNKNOWN', '原回退须逐项核验为成功或明确失败');
          if (b.action === 'ADVANCE_PROPOSE') {
            if (p.advance_proposed_by)
              sponsorFail('SPONSOR_ADVANCE_REVIEW_PENDING', '已有垫付提议待独立审核');
            await c.query(
              'UPDATE sponsor_refund_plans SET advance_proposed_by=$2,advance_evidence=$3,version=version+1 WHERE id=$1',
              [p.id, a.user.id, text(b.evidence, 'evidence', 4, 2000)],
            );
          } else {
            if (!p.advance_proposed_by || p.advance_proposed_by === a.user.id) throw forbidden();
            const money = await this.money(c, t);
            if (p.amount_fen > money.p.total_fen - money.reserved)
              sponsorFail('SPONSOR_REFUND_EXCEEDS_PAID', '原退款余额已变化');
            const binding = {
              sourceId: id,
              allocationId: p.id,
              tradeOrderId: t!.id,
              paymentId: money.p.id,
              merchantKey: o.merchant_key,
              merchantId: o.merchant_id,
              currency: 'CNY' as const,
              amountFen: p.amount_fen,
            };
            const coverage = validateSponsorAdvanceCoverage(await reserve(c, binding), binding);
            await c.query(
              "UPDATE sponsor_refund_plans SET funding_mode='PLATFORM_ADVANCE',advance_reviewed_by=$2,advance_coverage=$3,version=version+1 WHERE id=$1",
              [p.id, a.user.id, coverage],
            );
          }
          // Failed provider returns and OPEN recovery remain unchanged. Only a real common-ledger refund can discharge the advertiser obligation.
          result = { id, refundPlanId: p.id, status: 'RECOVERY_REQUIRED' };
        } else if (b.action === 'CLAIM_REFUND') {
          await this.finance(c, a, org, o);
          const p = await this.refundPlan(c, id, sponsorId(b.childId));
          status(
            p.status,
            p.funding_mode === 'PLATFORM_ADVANCE' ? ['RECOVERY_REQUIRED'] : ['READY_FOR_REFUND'],
          );
          if (!this.commerce.captureSourceRefund)
            sponsorFail('SPONSOR_REFUND_BRIDGE_DISABLED', '统一退款尚未接通', 503);
          result = {
            id,
            ...(await this.commerce.captureSourceRefund(c, a, {
              kind: 'SPONSOR_ORDER',
              sourceId: id,
              allocationId: p.id,
              amountFen: p.amount_fen,
              reason: p.reason,
            })),
          };
        } else if (b.action === 'RECOVERY_PROPOSE' || b.action === 'RECOVERY_APPROVE') {
          await this.finance(c, a, org, o);
          const r = (
            await c.query(
              'SELECT r.* FROM sponsor_recovery_cases r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE r.id=$1 AND p.order_id=$2 FOR UPDATE OF r',
              [sponsorId(b.childId), id],
            )
          ).rows[0];
          if (!r) throw notFound();
          status(r.status, ['OPEN']);
          if (b.action === 'RECOVERY_PROPOSE') {
            if (r.proposed_by) sponsorFail('SPONSOR_RECOVERY_REVIEW_PENDING', '追偿证据已提交');
            await c.query(
              'UPDATE sponsor_recovery_cases SET proposed_by=$2,evidence=$3 WHERE id=$1',
              [r.id, a.user.id, text(b.evidence, 'evidence', 4, 2000)],
            );
          } else {
            if (!r.proposed_by || r.proposed_by === a.user.id || o.payer_user_id === a.user.id)
              throw forbidden();
            if (!['RECOVERED', 'WRITTEN_OFF'].includes(String(b.outcome)))
              sponsorFail('SPONSOR_INVALID_ACTION', '追偿处理结果无效', 422);
            await c.query(
              'UPDATE sponsor_recovery_cases SET reviewed_by=$2,status=$3 WHERE id=$1',
              [r.id, a.user.id, b.outcome],
            );
          }
          // Off-channel recovery/waiver is recorded as an obligation outcome, never a provider return or a refund success.
          result = { id, recoveryId: r.id };
        } else sponsorFail('SPONSOR_INVALID_ACTION', '操作无效', 422);
        await c.query(
          'UPDATE sponsor_orders SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [id],
        );
        return { ...result, version: o.version + 1 };
      });
    });
  }
  private async validateReceivers(
    c: PoolClient,
    org: string,
    m: SponsorMerchant,
    rows: Array<SponsorShare & { amountFen?: number }>,
  ): Promise<void> {
    assertSponsorRecipientLimit(rows);
    if (rows.filter((x) => !x.retained).reduce((n, x) => n + x.basisPoints, 0) > m.maximumSplitBps)
      sponsorFail('SPONSOR_CHANNEL_LIMIT', '原商户当前分账额度不足');
    for (const x of rows.filter((x) => !x.retained)) {
      const cfg = m.receivers[x.beneficiaryOrgId];
      if (
        !cfg ||
        !cfg.returnsEnabled ||
        cfg.merchantId !== x.merchantId ||
        cfg.authorizationVersion !== x.authorizationVersion ||
        Date.parse(cfg.expiresAt) <= Date.now() ||
        !(
          await c.query(
            "SELECT 1 FROM sponsor_beneficiaries WHERE org_id=$1 AND beneficiary_org_id=$2 AND merchant_id=$3 AND authorization_version=$4 AND status='APPROVED' AND expires_at>clock_timestamp() FOR SHARE",
            [org, x.beneficiaryOrgId, x.merchantId, x.authorizationVersion],
          )
        ).rowCount
      )
        sponsorFail('SPONSOR_RECEIVER_UNAVAILABLE', '原分账主体授权失效，禁止更换收款人');
    }
  }
  private settlementHash(o: Row, t: Row, money: Row) {
    return sponsorHash({
      snapshot: o.snapshot,
      fee: o.verified_fee_fen,
      paid: money.p.id,
      refunds: money.refunded,
      tradeHash: t.source_hash,
    });
  }
  private async batch(c: PoolClient, orderId: string, id: string) {
    const r = (
      await c.query(
        'SELECT * FROM sponsor_settlement_batches WHERE id=$1 AND order_id=$2 FOR UPDATE',
        [id, orderId],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }
  private async refundPlan(c: PoolClient, orderId: string, id: string) {
    const r = (
      await c.query('SELECT * FROM sponsor_refund_plans WHERE id=$1 AND order_id=$2 FOR UPDATE', [
        id,
        orderId,
      ])
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }
  private async checkSettlement(c: PoolClient, o: Row, t: Row, batch: Row) {
    status(o.status, ['ACCEPTED']);
    const money = await this.money(c, t);
    if (
      batch.money_version !== t.money_version ||
      batch.source_hash !== this.settlementHash(o, t, money) ||
      money.reserved !== money.refunded ||
      (
        await c.query(
          "SELECT 1 FROM sponsor_refund_plans WHERE order_id=$1 AND status NOT IN('REJECTED','CLAIMED')",
          [o.id],
        )
      ).rowCount
    )
      sponsorFail('SPONSOR_SETTLEMENT_STALE', '资金或交付状态已变化，请重建审核');
  }
  /** Preparation is committed before a channel call. Retries only query the original number. */
  async channel(cookie: string | undefined, rawOrg: string, rawId: string, raw: unknown) {
    const org = sponsorId(rawOrg),
      id = sponsorId(rawId),
      b = objectInput(raw, ['commandId', 'expectedVersion', 'action', 'childId']);
    const action = String(b.action);
    if (
      ![
        'SEND_SPLIT',
        'QUERY_SPLIT',
        'FINISH',
        'QUERY_FINISH',
        'REFUND_UNFREEZE',
        'SEND_RETURN',
        'QUERY_RETURN',
      ].includes(action)
    )
      sponsorFail('SPONSOR_INVALID_ACTION', '渠道操作无效', 422);
    const job = await this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.calendar(c, org);
      const { o, t } = await this.lockOrder(c, org, id);
      await this.finance(c, a, org, o);
      const m = this.merchant(org, o);
      if (!m?.provider?.enabled || !m.provider.returnSupported)
        sponsorFail('SPONSOR_CHANNEL_DISABLED', '原商户渠道未配置', 503);
      if (
        (
          await c.query(
            "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
          )
        ).rowCount
      )
        sponsorFail('SPONSOR_RESTORE_QUARANTINED', '恢复环境禁止渠道操作', 503);
      const replay = !!(
        await c.query(
          'SELECT 1 FROM sponsor_commerce_operations WHERE actor_id=$1 AND command_id=$2',
          [a.user.id, sponsorId(b.commandId)],
        )
      ).rowCount;
      const prepared = await this.command(
        c,
        a,
        org,
        b.commandId,
        { org, id, channel: b },
        async () => {
          sponsorVersion(o.version, b.expectedVersion);
          if (!action.startsWith('QUERY') && !['SEND_RETURN', 'REFUND_UNFREEZE'].includes(action))
            await this.live(c, org, o);
          const fence = randomUUID();
          let batch: Row, returnItem: Row | undefined, plan: Row | undefined;
          if (action.endsWith('RETURN')) {
            returnItem = (
              await c.query(
                'SELECT r.* FROM sponsor_return_items r JOIN sponsor_refund_plans p ON p.id=r.refund_plan_id WHERE r.id=$1 AND p.order_id=$2 FOR UPDATE OF r',
                [sponsorId(b.childId), id],
              )
            ).rows[0];
            if (!returnItem) throw notFound();
            plan = await this.refundPlan(c, id, returnItem.refund_plan_id);
            status(
              plan!.status,
              action === 'QUERY_RETURN'
                ? ['APPROVED', 'RECOVERY_REQUIRED', 'CLAIMED']
                : ['APPROVED', 'RECOVERY_REQUIRED'],
            );
            const item = (
              await c.query('SELECT * FROM sponsor_settlement_items WHERE id=$1 FOR SHARE', [
                returnItem.settlement_item_id,
              ])
            ).rows[0];
            batch = await this.batch(c, id, item.batch_id);
            status(
              returnItem.status,
              action === 'SEND_RETURN'
                ? ['PENDING']
                : ['SENDING', 'UNKNOWN', 'PROCESSING', 'FAILED'],
            );
            await c.query(
              "UPDATE sponsor_return_items SET status='SENDING',fence=$2,updated_at=clock_timestamp() WHERE id=$1",
              [returnItem.id, fence],
            );
            returnItem = { ...returnItem, receiver_merchant_id: item.receiver_merchant_id };
          } else {
            if (action === 'REFUND_UNFREEZE') {
              const refundPlan = await this.refundPlan(c, id, sponsorId(b.childId));
              await assertSponsorRefundReadyForUnfreeze(
                c,
                id,
                refundPlan.id,
                refundPlan.amount_fen,
              );
              if (!refundPlan.batch_id)
                sponsorFail('SPONSOR_UNFREEZE_NOT_REQUIRED', '此退款没有已发送的分账批次');
              batch = await this.batch(c, id, refundPlan.batch_id);
              status(batch.status, ['SUCCEEDED', 'PARTIAL']);
              status(batch.finish_status, ['PENDING']);
              if (
                (
                  await c.query(
                    "SELECT 1 FROM sponsor_settlement_items WHERE batch_id=$1 AND amount_fen>0 AND status NOT IN('RETAINED','SUCCEEDED','FAILED')",
                    [batch.id],
                  )
                ).rowCount
              )
                sponsorFail('SPONSOR_SPLIT_UNKNOWN', '所有分账项须先核验到终态');
            } else batch = await this.batch(c, id, sponsorId(b.childId));
            if (action === 'SEND_SPLIT') {
              status(batch.status, ['APPROVED']);
              await this.checkSettlement(c, o, t!, batch);
              await this.validateReceivers(c, org, m, o.snapshot.shares);
            }
            if (action === 'QUERY_SPLIT')
              status(batch.status, ['SENDING', 'UNKNOWN', 'PROCESSING', 'PARTIAL']);
            if (action === 'FINISH') {
              status(batch.status, ['SUCCEEDED']);
              status(batch.finish_status, ['PENDING']);
              status(o.status, ['ACCEPTED']);
              if (
                (
                  await c.query(
                    "SELECT 1 FROM sponsor_refund_plans p LEFT JOIN trade_refunds r ON r.id=p.trade_refund_id WHERE p.order_id=$1 AND p.status<>'REJECTED' AND (p.status<>'CLAIMED' OR r.status<>'SUCCEEDED')",
                    [id],
                  )
                ).rowCount
              )
                sponsorFail('SPONSOR_REFUND_PENDING', '退款或回退义务尚未完成');
            }
            if (action === 'QUERY_FINISH') status(batch.finish_status, ['SENDING', 'UNKNOWN']);
            if (action.endsWith('FINISH') || action === 'REFUND_UNFREEZE')
              await c.query(
                "UPDATE sponsor_settlement_batches SET finish_status='SENDING',fence=$2,version=version+1 WHERE id=$1",
                [batch.id, fence],
              );
            else
              await c.query(
                "UPDATE sponsor_settlement_batches SET status='SENDING',fence=$2,version=version+1 WHERE id=$1",
                [batch.id, fence],
              );
          }
          const items = (
            await c.query(
              'SELECT * FROM sponsor_settlement_items WHERE batch_id=$1 ORDER BY beneficiary_org_id',
              [batch.id],
            )
          ).rows;
          await c.query(
            'UPDATE sponsor_orders SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [id],
          );
          return {
            fence,
            batch,
            items,
            returnItem: returnItem ?? null,
            plan: plan ?? null,
            actorId: a.user.id,
            merchantKey: m.key,
            merchantId: m.merchantId,
            merchantAppId: m.appId,
            version: o.version + 1,
          };
        },
      );
      return { ...prepared, replay };
    });
    if (job.replay) return { id, version: job.version, status: 'QUERY_ORIGINAL_REQUIRED' };
    const provider = this.merchant(org, {
      merchant_key: job.merchantKey,
      merchant_id: job.merchantId,
      merchant_app_id: job.merchantAppId,
    })?.provider;
    if (!provider) return this.recordChannel(org, id, action, job, null);
    const split = {
      transactionId: job.batch.transaction_id as string,
      outOrderNo: job.batch.out_order_no as string,
      receivers: job.items
        .filter((x: Row) => !x.retained && x.amount_fen > 0)
        .map((x: Row) => ({
          merchantId: x.receiver_merchant_id as string,
          displayName: x.display_name as string,
          amountFen: x.amount_fen as number,
        })),
    };
    let result: unknown = null;
    try {
      if (action === 'SEND_SPLIT' || action === 'QUERY_SPLIT')
        result = split.receivers.length
          ? await (action === 'SEND_SPLIT' ? provider.split(split) : provider.querySplit(split))
          : {
              transactionId: split.transactionId,
              outOrderNo: split.outOrderNo,
              orderId: null,
              state: 'FINISHED',
              receivers: [],
            };
      else if (action === 'FINISH' || action === 'QUERY_FINISH' || action === 'REFUND_UNFREEZE') {
        const finish = {
          transactionId: split.transactionId,
          outOrderNo: split.outOrderNo + 'F',
          maximumFen: job.batch.pool_fen as number,
        };
        result = await (action !== 'QUERY_FINISH'
          ? provider.finish(finish)
          : provider.queryFinish(finish));
      } else {
        const i = {
          outOrderNo: split.outOrderNo,
          outReturnNo: job.returnItem!.out_return_no as string,
          receiverMerchantId: job.returnItem!.receiver_merchant_id as string,
          amountFen: job.returnItem!.amount_fen as number,
        };
        result = await (action === 'SEND_RETURN'
          ? provider.returnFunds(i)
          : provider.queryReturn(i));
      }
    } catch {
      /* No synthetic success. Original identifiers and frozen receivers remain queryable. */
    }
    return this.recordChannel(org, id, action, job, result);
  }
  private async recordChannel(org: string, id: string, action: string, job: Row, result: any) {
    return this.transaction(async (c) => {
      await this.calendar(c, org, true);
      const { o, t } = await this.lockOrder(c, org, id);
      const batch = await this.batch(c, id, job.batch.id);
      if (action.endsWith('RETURN')) {
        const r = (
          await c.query('SELECT * FROM sponsor_return_items WHERE id=$1 FOR UPDATE', [
            job.returnItem.id,
          ])
        ).rows[0];
        if (r.fence !== job.fence) return { id, status: r.status, version: o.version };
        const valid =
          result &&
          result.outOrderNo === batch.out_order_no &&
          result.outReturnNo === r.out_return_no &&
          result.amountFen === r.amount_fen &&
          result.merchantId === job.returnItem.receiver_merchant_id &&
          ['SUCCESS', 'PROCESSING', 'FAILED'].includes(result.state) &&
          typeof result.returnId === 'string' &&
          result.returnId &&
          (!r.provider_return_id || r.provider_return_id === result.returnId);
        const next = !valid ? 'UNKNOWN' : result.state === 'SUCCESS' ? 'SUCCEEDED' : result.state;
        await c.query(
          'UPDATE sponsor_return_items SET status=$2,provider_return_id=$3,updated_at=clock_timestamp() WHERE id=$1',
          [r.id, next, valid ? result.returnId : (r.provider_return_id ?? null)],
        );
        if (next === 'FAILED') {
          await c.query(
            'INSERT INTO sponsor_recovery_cases(id,org_id,refund_plan_id,return_item_id,amount_fen) VALUES($1,$2,$3,$4,$5) ON CONFLICT(return_item_id) DO NOTHING',
            [randomUUID(), org, r.refund_plan_id, r.id, r.amount_fen],
          );
          await c.query(
            "UPDATE sponsor_refund_plans SET status='RECOVERY_REQUIRED',version=version+1 WHERE id=$1 AND status IN('APPROVED','RECOVERY_REQUIRED')",
            [r.refund_plan_id],
          );
        }
        if (
          !(
            await c.query(
              "SELECT 1 FROM sponsor_return_items WHERE refund_plan_id=$1 AND status NOT IN('NOT_REQUIRED','SUCCEEDED')",
              [r.refund_plan_id],
            )
          ).rowCount
        )
          await c.query(
            "UPDATE sponsor_refund_plans SET status='READY_FOR_REFUND',version=version+1 WHERE id=$1 AND status IN('APPROVED','RECOVERY_REQUIRED')",
            [r.refund_plan_id],
          );
      } else {
        if (batch.fence !== job.fence) return { id, status: batch.status, version: o.version };
        if (action === 'FINISH' || action === 'QUERY_FINISH' || action === 'REFUND_UNFREEZE') {
          const valid =
            result &&
            result.transactionId === batch.transaction_id &&
            result.outOrderNo === batch.out_order_no + 'F' &&
            result.state === 'FINISHED' &&
            typeof result.orderId === 'string' &&
            result.orderId;
          await c.query(
            'UPDATE sponsor_settlement_batches SET finished=$2,finish_status=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [batch.id, !!valid, valid ? 'SUCCEEDED' : 'UNKNOWN'],
          );
        } else {
          const expected = job.items.filter((x: Row) => !x.retained && x.amount_fen > 0),
            received = Array.isArray(result?.receivers) ? result.receivers : [];
          let valid =
            result &&
            result.transactionId === batch.transaction_id &&
            result.outOrderNo === batch.out_order_no &&
            (!batch.provider_order_id || batch.provider_order_id === result.orderId) &&
            (!expected.length ||
              (typeof result.orderId === 'string' &&
                result.orderId.length > 0 &&
                result.orderId.length <= 128)) &&
            ['PROCESSING', 'FINISHED'].includes(result.state) &&
            received.length === expected.length &&
            new Set(received.map((x: Row) => x.merchantId)).size === expected.length;
          for (const x of expected) {
            const r = received.find((y: Row) => y.merchantId === x.receiver_merchant_id);
            if (
              !r ||
              r.amountFen !== x.amount_fen ||
              !['PENDING', 'SUCCESS', 'CLOSED'].includes(r.result) ||
              (r.result === 'SUCCESS' && !(typeof r.detailId === 'string' && r.detailId))
            )
              valid = false;
          }
          if (valid) {
            // Once confirmed, stale or contradictory provider results cannot erase a successful item.
            for (const x of expected) {
              const r = received.find((y: Row) => y.merchantId === x.receiver_merchant_id),
                next =
                  r.result === 'SUCCESS'
                    ? 'SUCCEEDED'
                    : r.result === 'CLOSED'
                      ? 'FAILED'
                      : 'PROCESSING';
              const current = (
                await c.query('SELECT * FROM sponsor_settlement_items WHERE id=$1 FOR UPDATE', [
                  x.id,
                ])
              ).rows[0];
              if (current.status === 'SUCCEEDED') {
                if (next !== 'SUCCEEDED' || current.provider_detail_id !== r.detailId)
                  valid = false;
                continue;
              }
              await c.query(
                'UPDATE sponsor_settlement_items SET status=$2,provider_detail_id=$3,updated_at=clock_timestamp() WHERE id=$1',
                [x.id, next, r.detailId ?? null],
              );
            }
          }
          const items = (
            await c.query('SELECT * FROM sponsor_settlement_items WHERE batch_id=$1', [batch.id])
          ).rows;
          const next = !valid
            ? 'UNKNOWN'
            : items.some(
                  (x) =>
                    !x.retained && x.amount_fen > 0 && ['PENDING', 'PROCESSING'].includes(x.status),
                )
              ? 'PROCESSING'
              : items.some((x) => x.status === 'FAILED')
                ? 'PARTIAL'
                : 'SUCCEEDED';
          await c.query(
            'UPDATE sponsor_settlement_batches SET status=$2,provider_order_id=COALESCE(provider_order_id,$3),version=version+1,updated_at=clock_timestamp() WHERE id=$1',
            [batch.id, next, valid ? result.orderId : null],
          );
        }
      }
      if (t)
        await c.query('UPDATE trade_orders SET money_version=money_version+1 WHERE id=$1', [t.id]);
      await c.query(
        'UPDATE sponsor_orders SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      await this.audit(c, job.actorId, org, 'SPONSOR_CHANNEL_RESULT', 'sponsor_order', id, {
        action,
        fence: job.fence,
        confirmed: !!result,
      });
      return { id, version: o.version + 1, status: result ? 'RECORDED' : 'UNKNOWN' };
    });
  }
  async statements(cookie: string | undefined, rawOrg: string) {
    const org = sponsorId(rawOrg);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.govAdmin(c, a, org);
      // Beneficiary access never unlocks owner contracts, other recipients or payer identity.
      return {
        items: (
          await c.query(
            `SELECT i.id,i.amount_fen,i.status,i.retained,i.display_name,b.out_order_no,b.finished,
        COALESCE((SELECT sum(r.amount_fen) FROM sponsor_return_items r WHERE r.settlement_item_id=i.id AND r.status='SUCCEEDED'),0)::integer AS returned_fen
        FROM sponsor_settlement_items i JOIN sponsor_settlement_batches b ON b.id=i.batch_id WHERE i.beneficiary_org_id=$1 ORDER BY i.created_at DESC,i.id LIMIT 100`,
            [org],
          )
        ).rows,
      };
    });
  }
}
