import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { GovernanceService } from './governance-service.js';
import { forbidden, notFound } from './errors.js';
import { objectInput } from './validation.js';
import {
  govCheckVersion,
  govCommand,
  govFail,
  govId,
  govKey,
  govQuery,
  govText,
  govVersion,
  parseLedgerEntry,
} from './governance-domain.js';
import {
  governanceActiveOrg,
  governanceFinish,
  governanceReceipt,
} from './city-operations-service.js';
import { buildLedgerSnapshot, OFFLINE_LEDGER_NOTICE } from './public-ledger-domain.js';
import type { LedgerSnapshotSource } from './public-ledger-domain.js';
type Row = Record<string, any>;
const date = (v: Date | string) => new Date(v).toISOString();
export class PublicLedgerService extends GovernanceService {
  private async ledgerActor(c: PoolClient, cookie: string | undefined, orgId: string) {
    const actor = await this.lockActor(c, cookie);
    await this.govAdmin(c, actor, govId(orgId));
    return actor;
  }
  private async account(c: PoolClient, orgId: string, id: string, write = false) {
    await governanceActiveOrg(c, govId(orgId));
    const r = (
      await c.query<Row>(
        `SELECT * FROM public_ledger_accounts WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [orgId, govId(id)],
      )
    ).rows[0];
    if (!r) throw notFound();
    return r;
  }
  private entryDto(r: Row, actorId: string) {
    return {
      id: r.id,
      occurredOn: r.occurred_on,
      label: r.label,
      kind: r.kind,
      amountFen: r.amount_fen,
      reversesEntryId: r.reverses_entry_id,
      status: r.status,
      version: r.version,
      createdBy: r.created_by,
      reviewedBy: r.reviewed_by,
      reviewReason: r.review_reason,
      canReview: r.status === 'PENDING_REVIEW' && r.created_by !== actorId,
    };
  }
  private async ledgerDto(c: PoolClient, r: Row, actorId: string, details = true) {
    const pub = (
      await c.query<Row>(
        'SELECT public_key,created_at,snapshot FROM public_ledger_publications WHERE account_id=$1 AND revoked_at IS NULL',
        [r.id],
      )
    ).rows[0];
    const entries = details
      ? (
          await c.query<Row>(
            'SELECT e.*,e.occurred_on::text AS occurred_on FROM public_ledger_entries e WHERE account_id=$1 ORDER BY created_at,id LIMIT 1001',
            [r.id],
          )
        ).rows
      : [];
    if (entries.length > 1000) govFail('LEDGER_ENTRY_LIMIT', '账目超出公示安全上限');
    const net = Number(
      (
        await c.query<{ net: string }>(
          "SELECT coalesce(sum(amount_fen) FILTER(WHERE status='APPROVED'),0) AS net FROM public_ledger_entries WHERE account_id=$1",
          [r.id],
        )
      ).rows[0]!.net,
    );
    if (!Number.isSafeInteger(net)) govFail('LEDGER_AMOUNT_RANGE', '账面差额超出精确范围');
    return {
      id: r.id,
      orgId: r.org_id,
      teamId: r.team_id,
      title: r.title,
      description: r.description,
      status: r.status,
      version: r.version,
      createdBy: r.created_by,
      createdAt: date(r.created_at),
      publicKey: pub?.public_key ?? null,
      publishedAt: pub ? date(pub.created_at) : null,
      publishedEntryCount: pub?.snapshot.entryCount ?? null,
      approvedNetFen: net,
      entries: entries.map((e) => this.entryDto(e, actorId)),
      canPublish: r.status === 'ACTIVE' && r.created_by !== actorId,
      notice: OFFLINE_LEDGER_NOTICE,
    };
  }
  async selectionOptions(cookie: string | undefined, orgId: string, raw: unknown = {}) {
    const q = objectInput(raw, ['query']);
    const query = q.query === undefined ? '' : govText(q.query, 'query', 1, 80);
    return this.transaction(async (c) => {
      await this.ledgerActor(c, cookie, orgId);
      const teams = (
        await c.query(
          "SELECT id,name FROM teams WHERE org_id=$1 AND ($2='' OR position(lower($2) in lower(name))>0) ORDER BY name,id LIMIT 101",
          [orgId, query],
        )
      ).rows;
      return { teams: teams.slice(0, 100), truncated: teams.length > 100 };
    });
  }
  async list(cookie: string | undefined, orgId: string, raw: unknown) {
    const q = govQuery(raw);
    return this.transaction(async (c) => {
      const actor = await this.ledgerActor(c, cookie, orgId);
      const rows = (
        await c.query<Row>(
          'SELECT * FROM public_ledger_accounts WHERE org_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
          [orgId, q.before, q.limit + 1],
        )
      ).rows;
      return {
        items: await Promise.all(
          rows.slice(0, q.limit).map((r) => this.ledgerDto(c, r, actor.user.id, false)),
        ),
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    });
  }
  async get(cookie: string | undefined, orgId: string, id: string) {
    return this.transaction(async (c) => {
      const actor = await this.ledgerActor(c, cookie, orgId);
      return this.ledgerDto(c, await this.account(c, orgId, id), actor.user.id);
    });
  }
  async create(cookie: string | undefined, orgId: string, raw: unknown) {
    const o = objectInput(raw, [
      'commandId',
      'teamId',
      'title',
      'description',
      'authorizationConfirmed',
    ]);
    if (o.authorizationConfirmed !== true)
      govFail('VALIDATION_ERROR', '须确认仅记录已获授权的线下账目', 422);
    const input = {
      commandId: govCommand(o.commandId),
      teamId: o.teamId == null ? null : govId(o.teamId),
      title: govText(o.title, 'title', 1, 120),
      description: govText(o.description, 'description', 1, 1000),
      authorizationConfirmed: true,
    };
    await this.govThrottle(cookie, 'ledger-create', input.commandId, 20);
    return this.transaction(async (c) => {
      const actor = await this.ledgerActor(c, cookie, orgId);
      if (
        input.teamId &&
        !(
          await c.query('SELECT id FROM teams WHERE org_id=$1 AND id=$2 FOR SHARE', [
            orgId,
            input.teamId,
          ])
        ).rowCount
      )
        throw notFound();
      const request = { operation: 'LEDGER_CREATE', orgId, ...input };
      const old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      const row = (
        await c.query<Row>(
          'INSERT INTO public_ledger_accounts(id,org_id,team_id,title,description,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [randomUUID(), orgId, input.teamId, input.title, input.description, actor.user.id],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        orgId,
        'governance.ledger_created',
        'public_ledger',
        row.id,
      );
      const result = await this.ledgerDto(c, row, actor.user.id);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async addEntry(cookie: string | undefined, orgId: string, id: string, raw: unknown) {
    const input = parseLedgerEntry(raw);
    await this.govThrottle(cookie, 'ledger-entry', input.commandId, 100);
    return this.transaction(async (c) => {
      const actor = await this.ledgerActor(c, cookie, orgId),
        account = await this.account(c, orgId, id, true);
      const request = { operation: 'LEDGER_ENTRY', orgId, accountId: id, ...input };
      const old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(account.version, input.expectedVersion);
      if (account.status !== 'ACTIVE') govFail('LEDGER_CLOSED', '账本已永久关闭');
      const count = Number(
        (
          await c.query<{ count: string }>(
            'SELECT count(*) FROM public_ledger_entries WHERE account_id=$1',
            [id],
          )
        ).rows[0]!.count,
      );
      if (count >= 1000) govFail('LEDGER_ENTRY_LIMIT', '本账本已达1000条上限，请建立新的授权账本');
      if (input.reversesEntryId) {
        const original = (
          await c.query<Row>(
            'SELECT * FROM public_ledger_entries WHERE account_id=$1 AND id=$2 FOR SHARE',
            [id, input.reversesEntryId],
          )
        ).rows[0];
        if (
          !original ||
          original.status !== 'APPROVED' ||
          original.kind === 'REVERSAL' ||
          input.amountFen !== -original.amount_fen
        )
          govFail('LEDGER_REVERSAL_REFUSED', '冲销须精确对应本账本已审批原记录');
        if (
          (
            await c.query(
              "SELECT id FROM public_ledger_entries WHERE reverses_entry_id=$1 AND status IN ('PENDING_REVIEW','APPROVED')",
              [input.reversesEntryId],
            )
          ).rowCount
        )
          govFail('LEDGER_ALREADY_REVERSED', '原账目已有待审批或通过的冲销记录');
      }
      const entry = (
        await c.query<Row>(
          'INSERT INTO public_ledger_entries(id,account_id,occurred_on,label,kind,amount_fen,reverses_entry_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,occurred_on::text AS occurred_on',
          [
            randomUUID(),
            id,
            input.occurredOn,
            input.label,
            input.kind,
            input.amountFen,
            input.reversesEntryId,
            actor.user.id,
          ],
        )
      ).rows[0]!;
      await c.query('UPDATE public_ledger_accounts SET version=version+1 WHERE id=$1', [id]);
      await this.audit(
        c,
        actor.user.id,
        orgId,
        'governance.ledger_entry_added',
        'public_ledger',
        id,
        { entryId: entry.id, kind: input.kind },
      );
      const result = {
        id,
        accountId: id,
        version: account.version + 1,
        entry: this.entryDto(entry, actor.user.id),
      };
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async command(cookie: string | undefined, orgId: string, id: string, raw: unknown) {
    const o = objectInput(raw, [
      'commandId',
      'expectedVersion',
      'type',
      'reason',
      'entryId',
      'entryVersion',
      'publicConsent',
    ]);
    const type = String(o.type);
    if (!['APPROVE_ENTRY', 'REJECT_ENTRY', 'PUBLISH', 'REVOKE_PUBLICATION', 'CLOSE'].includes(type))
      govFail('VALIDATION_ERROR', '账本操作无效', 422);
    const reviewing = ['APPROVE_ENTRY', 'REJECT_ENTRY'].includes(type);
    if (
      (reviewing && (!o.entryId || !o.entryVersion)) ||
      (!reviewing && (o.entryId !== undefined || o.entryVersion !== undefined)) ||
      (type === 'PUBLISH' ? o.publicConsent !== true : o.publicConsent !== undefined)
    )
      govFail('VALIDATION_ERROR', '账目审批及公开确认参数不完整', 422);
    const input = {
      commandId: govCommand(o.commandId),
      expectedVersion: govVersion(o.expectedVersion),
      type,
      reason: govText(o.reason, 'reason', 4, 500),
      ...(reviewing ? { entryId: govId(o.entryId), entryVersion: govVersion(o.entryVersion) } : {}),
      ...(type === 'PUBLISH' ? { publicConsent: true } : {}),
    };
    await this.govThrottle(cookie, 'ledger-command', input.commandId, 100);
    return this.transaction(async (c) => {
      const actor = await this.ledgerActor(c, cookie, orgId),
        account = await this.account(c, orgId, id, true);
      const request = { operation: 'LEDGER_COMMAND', orgId, accountId: id, ...input };
      const old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(account.version, input.expectedVersion);
      if (account.status !== 'ACTIVE') govFail('LEDGER_CLOSED', '账本已永久关闭');
      if (reviewing) {
        const entry = (
          await c.query<Row>(
            'SELECT * FROM public_ledger_entries WHERE account_id=$1 AND id=$2 FOR UPDATE',
            [id, input.entryId],
          )
        ).rows[0];
        if (!entry) throw notFound();
        if (entry.created_by === actor.user.id) throw forbidden();
        govCheckVersion(entry.version, input.entryVersion!);
        if (entry.status !== 'PENDING_REVIEW')
          govFail('LEDGER_ENTRY_ALREADY_REVIEWED', '账目已审批，原事实不可更写');
        await c.query(
          'UPDATE public_ledger_entries SET status=$2,version=version+1,reviewed_by=$3,reviewed_at=clock_timestamp(),review_reason=$4 WHERE id=$1',
          [
            entry.id,
            type === 'APPROVE_ENTRY' ? 'APPROVED' : 'REJECTED',
            actor.user.id,
            input.reason,
          ],
        );
      } else if (type === 'PUBLISH') {
        if (account.created_by === actor.user.id)
          govFail('LEDGER_INDEPENDENT_PUBLISHER', '须由另一名当前授权管理员核对后公示', 403);
        const entries = (
          await c.query<LedgerSnapshotSource>(
            "SELECT e.*,e.occurred_on::text AS occurred_on FROM public_ledger_entries e WHERE account_id=$1 AND status='APPROVED' ORDER BY created_at,id LIMIT 1001",
            [id],
          )
        ).rows;
        if (!entries.length)
          govFail('LEDGER_NO_APPROVED_ENTRIES', '至少一条账目独立审批通过后才可公示');
        const snapshot = buildLedgerSnapshot(
          { title: account.title, description: account.description },
          entries,
          await this.now(c),
        );
        await c.query(
          'UPDATE public_ledger_publications SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE account_id=$1 AND revoked_at IS NULL',
          [id, actor.user.id, '重新公示：' + input.reason.slice(0, 490)],
        );
        await c.query(
          'INSERT INTO public_ledger_publications(id,account_id,public_key,snapshot,published_by) VALUES($1,$2,$3,$4::jsonb,$5)',
          [
            randomUUID(),
            id,
            randomBytes(32).toString('base64url'),
            JSON.stringify(snapshot),
            actor.user.id,
          ],
        );
      } else {
        const revoked = await c.query(
          'UPDATE public_ledger_publications SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE account_id=$1 AND revoked_at IS NULL RETURNING id',
          [id, actor.user.id, input.reason],
        );
        if (type === 'REVOKE_PUBLICATION' && !revoked.rowCount)
          govFail('LEDGER_NOT_PUBLIC', '当前没有可撤销的公示');
      }
      const updated = (
        await c.query<Row>(
          "UPDATE public_ledger_accounts SET version=version+1,status=CASE WHEN $2='CLOSE' THEN 'CLOSED' ELSE status END WHERE id=$1 RETURNING *",
          [id, type],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        orgId,
        'governance.ledger_' + type.toLowerCase(),
        'public_ledger',
        id,
        { ...('entryId' in input ? { entryId: input.entryId } : {}) },
      );
      const result = await this.ledgerDto(c, updated, actor.user.id);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async publicSnapshot(key: string) {
    return this.transaction(async (c) => {
      const ref = (
        await c.query<Row>(
          'SELECT a.org_id,a.id AS account_id FROM public_ledger_publications p JOIN public_ledger_accounts a ON a.id=p.account_id WHERE p.public_key=$1',
          [govKey(key)],
        )
      ).rows[0];
      if (!ref) throw notFound();
      await governanceActiveOrg(c, ref.org_id);
      const account = await this.account(c, ref.org_id, ref.account_id);
      if (account.status !== 'ACTIVE') throw notFound();
      const row = (
        await c.query<Row>(
          'SELECT p.public_key,p.snapshot,p.created_at FROM public_ledger_publications p WHERE p.public_key=$1 AND p.account_id=$2 AND p.revoked_at IS NULL FOR SHARE',
          [govKey(key), account.id],
        )
      ).rows[0];
      if (!row) throw notFound();
      return {
        publicKey: row.public_key,
        publishedAt: date(row.created_at),
        title: row.snapshot.title,
        description: row.snapshot.description,
        asOf: row.snapshot.asOf,
        entries: (row.snapshot.entries as Row[]).map((e) => ({
          seq: e.seq,
          occurredOn: e.occurredOn,
          label: e.label,
          kind: e.kind,
          amountFen: e.amountFen,
          reversesSeq: e.reversesSeq,
        })),
        approvedNetFen: row.snapshot.approvedNetFen,
        entryCount: row.snapshot.entryCount,
        notice: OFFLINE_LEDGER_NOTICE,
      };
    });
  }
}
