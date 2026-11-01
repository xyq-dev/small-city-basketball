import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createOperationsApi, type SponsorList } from '../api/operations';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { OperationsFrame, commandId, fenText, reasonText, useEpoch, yuanToFen } from './shared';

const contractLabels: Record<string, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '待独立审核',
  APPROVED: '已审核',
  SIGNED: '已签署',
  REJECTED: '已退回',
  CLOSED: '已关闭',
};
const orderLabels: Record<string, string> = {
  WAITING_PAYMENT: '待收款',
  DELIVERING: '交付中',
  ACCEPTED: '已验收',
  DISPUTED: '交付争议',
  CLOSED: '已关闭',
};

export function SponsorOperationsPage({ context }: { context: RegistrationWorkspace }) {
  return (
    <OperationsFrame context={context}>
      {(orgId) => <SponsorDesk context={context} orgId={orgId} />}
    </OperationsFrame>
  );
}

function SponsorDesk({ context, orgId }: { context: RegistrationWorkspace; orgId: string }) {
  const api = useMemo(() => createOperationsApi(context.client), [context.client]);
  const [chosen, setChosen] = useState(orgId);
  const reads = useEpoch();
  const contractAckRef = useRef<ContractAck | null>(null);
  const [contractAck, setContractAck] = useState<ContractAck | null>(null);
  const [view, setView] = useState<'contracts' | 'orders' | 'statements'>('contracts');
  const read = useCallback(async () => {
    const inbox = await api.sponsorInbox();
    const list = await api.sponsorList(chosen);
    const statements = list.canManage ? await api.sponsorStatements(chosen) : { items: [] };
    return { inbox, list, statements };
  }, [api, chosen]);
  const resource = useResource(read);
  const action = useAction();
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const data = resource.data;
  function submit(label: string, run: () => Promise<void>) {
    void action.run(async () => {
      await run();
      if (action.isActive()) {
        resource.reload();
        await context.onSessionRefresh();
      }
    }, label);
  }
  return (
    <div className="registration-page">
      <PageHeading
        eyebrow="SPONSOR SETTLEMENT"
        title="广告结算"
        description="金额沿用合同与实收的分口径。本页做审核、交付和分配计划，不发送分账、不发起付款或退款。"
      />
      {resource.loading || resource.error || !data ? (
        <ResourceState loading={resource.loading} error={resource.error} reload={resource.reload} />
      ) : (
        <DeskBody
          data={data}
          chosen={chosen}
          setChosen={(id) => {
            reads.next();
            setOrder(null);
            contractAckRef.current = null;
            setContractAck(null);
            setChosen(id);
          }}
          contractAck={contractAck}
          onContractAck={(next) => {
            contractAckRef.current = next;
            setContractAck(next);
          }}
          view={view}
          setView={setView}
          reason={reason}
          setReason={setReason}
          evidence={evidence}
          setEvidence={setEvidence}
          order={order}
          busy={action.busy}
          notice={<ActionNotice action={action} onReload={resource.reload} />}
          onOpen={async (id) => {
            const token = reads.next();
            const detail = await api.sponsorOrder(chosen, id);
            if (!reads.current(token)) return;
            setOrder(detail);
            setView('orders');
          }}
          onContract={(id, command, extra) =>
            submit('合同操作已提交', async () => {
              const ack = contractAckRef.current;
              const signed = command === 'OWNER_SIGN' || command === 'ADVERTISER_SIGN';
              const reviewed = command === 'APPROVE' || signed;
              if (
                reviewed &&
                (!ack ||
                  ack.id !== id ||
                  ack.version !== extra.version ||
                  ack.hash !== extra.hash ||
                  ack.userId !== extra.userId ||
                  ack.orgId !== chosen)
              )
                throw new Error('请重新核对当前冻结合同后再操作');
              await api.post(
                `/v1/orgs/${encodeURIComponent(chosen)}/sponsor-commerce/contracts/${id}/commands`,
                {
                  commandId: commandId(),
                  expectedVersion: extra.version,
                  action: command,
                  ...extra.body,
                  ...(signed ? { acceptedContractHash: ack?.hash } : {}),
                },
              );
            })
          }
          onOrder={(id, version, command, body) =>
            submit('订单操作已提交，请以重新读取的状态为准', async () => {
              const token = reads.peek();
              const payload = { ...body };
              if (command === 'CLOSE_ORDER') payload.reason = reasonText(String(body.reason ?? ''));
              if (command === 'VERIFY_FEE') {
                payload.amountFen = yuanToFen(String(body.amount ?? ''));
                delete payload.amount;
              }
              await api.post(
                `/v1/orgs/${encodeURIComponent(chosen)}/sponsor-commerce/orders/${id}/commands`,
                { commandId: commandId(), expectedVersion: version, action: command, ...payload },
              );
              const detail = await api.sponsorOrder(chosen, id);
              if (action.isActive() && reads.current(token)) setOrder(detail);
            })
          }
          onCreate={(body) =>
            submit('合同草稿已建立', () =>
              api
                .post(`/v1/orgs/${encodeURIComponent(chosen)}/sponsor-commerce/contracts`, body)
                .then(() => undefined),
            )
          }
        />
      )}
    </div>
  );
}

function DeskBody({
  data,
  chosen,
  setChosen,
  view,
  setView,
  reason,
  setReason,
  evidence,
  setEvidence,
  order,
  busy,
  notice,
  contractAck,
  onContractAck,
  onOpen,
  onContract,
  onOrder,
  onCreate,
}: {
  data: {
    inbox: { organizations: { id: string; name: string }[] };
    list: SponsorList;
    statements: { items: Record<string, unknown>[] };
  };
  chosen: string;
  setChosen: (id: string) => void;
  view: 'contracts' | 'orders' | 'statements';
  setView: (view: 'contracts' | 'orders' | 'statements') => void;
  reason: string;
  setReason: (value: string) => void;
  evidence: string;
  setEvidence: (value: string) => void;
  order: Record<string, unknown> | null;
  busy: boolean;
  notice: ReactNode;
  contractAck: ContractAck | null;
  onContractAck: (next: ContractAck | null) => void;
  onOpen: (id: string) => Promise<void>;
  onContract: (
    id: string,
    action: string,
    extra: { version: number; hash: string; userId: string; body?: Record<string, unknown> },
  ) => void;
  onOrder: (id: string, version: number, action: string, body: Record<string, unknown>) => void;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const list = data.list;
  const orgs = [
    ...new Map(
      [...data.inbox.organizations, { id: chosen, name: '当前机构' }].map((org) => [org.id, org]),
    ).values(),
  ];
  return (
    <>
      {notice}
      {!list.enabled && (
        <div className="registration-alert" role="status">
          <strong>商业收款尚未开通</strong>
          <p>历史合同和收益记录仍可查看。新合同不会在这里假装已收款。</p>
        </div>
      )}
      <label>
        机构
        <select aria-label="广告机构" value={chosen} onChange={(e) => setChosen(e.target.value)}>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setView('contracts')}>
        合同
      </button>
      <button type="button" onClick={() => setView('orders')}>
        订单与交付
      </button>
      {list.canManage && (
        <button type="button" onClick={() => setView('statements')}>
          本机构收益明细
        </button>
      )}
      {view === 'statements' && (
        <section className="panel">
          <h2>收益明细</h2>
          {data.statements.items.length === 0 && <p>暂无本机构分成记录。</p>}
          <ul>
            {data.statements.items.map((item) => (
              <li key={String(item.id)}>
                {String(item.display_name ?? item.id)} · {fenText(Number(item.amount_fen ?? 0))} ·{' '}
                {String(item.status)} · 已回退 {String(item.returned_fen ?? 0)} 分
              </li>
            ))}
          </ul>
        </section>
      )}
      {view === 'contracts' && (
        <section className="panel">
          <h2>合同</h2>
          {list.contracts.length === 0 && <p>暂无合同。</p>}
          <ul>
            {list.contracts.map((row) => (
              <ContractRow
                key={String(row.id)}
                row={row}
                list={list}
                chosen={chosen}
                busy={busy}
                ack={contractAck}
                onAck={onContractAck}
                onCommand={(action) =>
                  onContract(String(row.id), action, {
                    version: Number(row.version),
                    hash: String(row.contractHash ?? ''),
                    userId: list.userId,
                  })
                }
              />
            ))}
          </ul>
          {list.canManage && list.enabled && (
            <ContractForm
              orgId={chosen}
              campaigns={list.campaignOptions}
              busy={busy}
              onCreate={onCreate}
            />
          )}
        </section>
      )}
      {view === 'orders' && (
        <section className="panel">
          <h2>订单</h2>
          {list.orders.length === 0 && <p>暂无广告订单。</p>}
          <ul>
            {list.orders.map((row) => (
              <li key={String(row.id)}>
                <button type="button" onClick={() => void onOpen(String(row.id))}>
                  {orderLabels[String(row.status)] ?? String(row.status)} ·{' '}
                  {fenText(Number(row.total_fen ?? 0))} · 实收 {String(row.paid_fen ?? 0)} 分
                </button>
              </li>
            ))}
          </ul>
          {order && objectOrder(order) && (
            <OrderDetail
              detail={order}
              list={list}
              busy={busy}
              reason={reason}
              evidence={evidence}
              setReason={setReason}
              setEvidence={setEvidence}
              onCommand={(command, body) => {
                const current = objectOrder(order);
                if (!current) return;
                onOrder(String(current.id), Number(current.version), command, body);
              }}
            />
          )}
        </section>
      )}
    </>
  );
}

function objectOrder(detail: Record<string, unknown>) {
  const order = detail.order;
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
  return order as Record<string, unknown>;
}

interface ContractAck {
  id: string;
  version: number;
  hash: string;
  userId: string;
  orgId: string;
}

function frozenContract(row: Record<string, unknown>) {
  const shares = Array.isArray(row.shares) ? row.shares.flatMap(shareLine) : [];
  if (
    typeof row.id !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.org_id !== 'string' ||
    typeof row.payer_user_id !== 'string' ||
    typeof row.terms !== 'string' ||
    row.terms.trim().length < 4 ||
    typeof row.contractHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(row.contractHash) ||
    !Number.isSafeInteger(row.total_fen) ||
    !Number.isSafeInteger(row.allowed_fee_fen) ||
    !Number.isSafeInteger(row.version) ||
    typeof row.starts_at !== 'string' ||
    typeof row.ends_at !== 'string' ||
    shares.length === 0
  )
    return null;
  return {
    id: row.id,
    title: row.title,
    orgId: row.org_id,
    payerId: row.payer_user_id,
    terms: row.terms.trim(),
    hash: row.contractHash,
    totalFen: Number(row.total_fen),
    feeFen: Number(row.allowed_fee_fen),
    version: Number(row.version),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    shares,
  };
}

function shareLine(share: unknown, index: number) {
  if (!share || typeof share !== 'object' || Array.isArray(share)) return [];
  const row = share as Record<string, unknown>;
  const name =
    typeof row.displayName === 'string'
      ? row.displayName
      : typeof row.beneficiaryOrgId === 'string'
        ? row.beneficiaryOrgId
        : '';
  if (!name || !Number.isSafeInteger(row.basisPoints)) return [];
  return [{ key: `${name}-${index}`, name, points: Number(row.basisPoints) }];
}

function ContractRow({
  row,
  list,
  chosen,
  busy,
  ack,
  onAck,
  onCommand,
}: {
  row: Record<string, unknown>;
  list: SponsorList;
  chosen: string;
  busy: boolean;
  ack: ContractAck | null;
  onAck: (next: ContractAck | null) => void;
  onCommand: (action: string) => void;
}) {
  const status = String(row.status);
  const frozen = frozenContract(row);
  const confirmed =
    !!frozen &&
    !!ack &&
    ack.id === frozen.id &&
    ack.version === frozen.version &&
    ack.hash === frozen.hash &&
    ack.userId === list.userId &&
    ack.orgId === chosen;
  const decisive = status === 'IN_REVIEW' || status === 'APPROVED';
  return (
    <li>
      <strong>
        {String(row.title ?? row.id)} · {contractLabels[status] ?? status}
      </strong>{' '}
      {fenText(Number(row.total_fen ?? 0))} <Version value={Number(row.version)} />
      {frozen ? (
        <article aria-label={`${frozen.title}的冻结合同`}>
          <p>
            签署机构 {frozen.orgId} · 付款人 {frozen.payerId}
          </p>
          <p>
            合同金额 {fenText(frozen.totalFen)} · 手续费上限 {fenText(frozen.feeFen)}
          </p>
          <p>
            投放时段 {frozen.startsAt} 至 {frozen.endsAt}
          </p>
          <p>完整条款：{frozen.terms}</p>
          <ul>
            {frozen.shares.map((share) => (
              <li key={share.key}>
                {share.name} {share.points} 基点
              </li>
            ))}
          </ul>
          <p>合同版本 {frozen.hash}</p>
          {decisive && (
            <label>
              <input
                type="checkbox"
                aria-label={`核对${frozen.title}`}
                checked={confirmed}
                disabled={busy}
                onChange={(event) =>
                  onAck(
                    event.target.checked
                      ? {
                          id: frozen.id,
                          version: frozen.version,
                          hash: frozen.hash,
                          userId: list.userId,
                          orgId: chosen,
                        }
                      : null,
                  )
                }
              />
              我已核对当前这份冻结合同的条款、时段、费用和分成
            </label>
          )}
        </article>
      ) : (
        <p role="alert">合同详情不完整，不能审核或签署。</p>
      )}
      {list.canManage && status === 'DRAFT' && (
        <button type="button" disabled={busy} onClick={() => onCommand('SUBMIT')}>
          送交独立审核
        </button>
      )}
      {list.canFinance &&
        status === 'IN_REVIEW' &&
        row.created_by !== list.userId &&
        row.payer_user_id !== list.userId && (
          <button type="button" disabled={busy || !confirmed} onClick={() => onCommand('APPROVE')}>
            审核合同
          </button>
        )}
      {list.canFinance && status === 'IN_REVIEW' && (
        <button type="button" disabled={busy} onClick={() => onCommand('REJECT')}>
          退回合同
        </button>
      )}
      {list.canManage &&
        status === 'APPROVED' &&
        !row.owner_signed_by &&
        row.reviewed_by !== list.userId && (
          <button
            type="button"
            disabled={busy || !confirmed}
            onClick={() => onCommand('OWNER_SIGN')}
          >
            机构确认签署
          </button>
        )}
      {row.payer_user_id === list.userId &&
        status === 'APPROVED' &&
        Boolean(row.owner_signed_by) && (
          <button
            type="button"
            disabled={busy || !confirmed}
            onClick={() => onCommand('ADVERTISER_SIGN')}
          >
            同意条款并签署
          </button>
        )}
      {list.canFinance && status === 'SIGNED' && (
        <button type="button" disabled={busy} onClick={() => onCommand('CLOSE_UNSTARTED')}>
          核验未建单并关闭合同
        </button>
      )}
    </li>
  );
}

function ContractForm({
  orgId,
  campaigns,
  busy,
  onCreate,
}: {
  orgId: string;
  campaigns: Record<string, unknown>[];
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [campaignId, setCampaignId] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [total, setTotal] = useState('');
  const [fee, setFee] = useState('');
  const [terms, setTerms] = useState('');
  const campaign = campaigns.find((row) => row.id === campaignId);
  return (
    <form
      aria-label="建立合同"
      onSubmit={(event) => {
        event.preventDefault();
        if (!campaign) throw new Error('请先选择已建立的广告投放');
        onCreate({
          commandId: commandId(),
          campaignId,
          payerEmail: email.trim(),
          title: title.trim(),
          totalFen: yuanToFen(total),
          allowedFeeFen: yuanToFen(fee),
          terms: terms.trim(),
          startsAt: campaign.starts_at,
          endsAt: campaign.ends_at,
          shares: [{ beneficiaryOrgId: orgId, basisPoints: 10000 }],
        });
      }}
    >
      <label>
        广告投放
        <select
          aria-label="广告投放"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">选择投放</option>
          {campaigns.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>
              {String(row.title ?? row.id)}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label="合同名称"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="合同名称"
      />
      <input
        aria-label="广告主邮箱"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="广告主邮箱"
      />
      <input
        aria-label="合同金额"
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        placeholder="合同金额（元）"
      />
      <input
        aria-label="手续费上限"
        value={fee}
        onChange={(e) => setFee(e.target.value)}
        placeholder="手续费上限（元）"
      />
      <textarea aria-label="合同条款" value={terms} onChange={(e) => setTerms(e.target.value)} />
      <button type="submit" disabled={busy || !campaignId}>
        建立合同草稿
      </button>
    </form>
  );
}

function OrderDetail({
  detail,
  list,
  busy,
  reason,
  evidence,
  setReason,
  setEvidence,
  onCommand,
}: {
  detail: Record<string, unknown>;
  list: SponsorList;
  busy: boolean;
  reason: string;
  evidence: string;
  setReason: (value: string) => void;
  setEvidence: (value: string) => void;
  onCommand: (action: string, body: Record<string, unknown>) => void;
}) {
  const [fee, setFee] = useState('');
  const order = objectOrder(detail);
  if (!order) return null;
  const status = String(order.status);
  const batches = Array.isArray(detail.batches) ? detail.batches : [];
  return (
    <article aria-label="订单详情">
      <h3>
        {orderLabels[status] ?? status} · {fenText(Number(order.total_fen ?? 0))}{' '}
        <Version value={Number(order.version)} />
      </h3>
      <p>分账发送、付款和退款仍留在原交易流程，本页不提供这些按钮。</p>
      <label>
        交付证据
        <textarea
          aria-label="交付证据"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        说明
        <textarea
          aria-label="订单说明"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {list.canManage && (status === 'WAITING_PAYMENT' || status === 'DELIVERING') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onCommand('DELIVERY', { evidence: evidence.trim() })}
        >
          提交交付证据
        </button>
      )}
      {list.canFinance && order.verified_fee_fen === null && (
        <>
          <label>
            实际手续费（元）
            <input aria-label="实际手续费" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => onCommand('VERIFY_FEE', { evidence: evidence.trim(), amount: fee })}
          >
            核验实际手续费并冻结凭据
          </button>
        </>
      )}
      {list.canManage && status === 'ACCEPTED' && (
        <button type="button" disabled={busy} onClick={() => onCommand('PROPOSE_SETTLEMENT', {})}>
          按实收生成分配计划
        </button>
      )}
      {list.canFinance && status !== 'CLOSED' && (
        <button type="button" disabled={busy} onClick={() => onCommand('CLOSE_ORDER', { reason })}>
          核对全部义务后关闭
        </button>
      )}
      <ul>
        {batches.map((batch) => {
          if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return null;
          const row = batch as Record<string, unknown>;
          return (
            <li key={String(row.id)}>
              分配 {String(row.status)} · 池 {String(row.pool_fen ?? 0)} 分
              {list.canFinance && row.status === 'IN_REVIEW' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onCommand('APPROVE_SETTLEMENT', { childId: row.id })}
                  >
                    独立审核通过
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onCommand('REJECT_SETTLEMENT', { childId: row.id })}
                  >
                    退回重建
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
