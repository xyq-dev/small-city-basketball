import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import type {
  CommerceOrderData,
  CommercePlanData,
  CommerceOrderCommandInput,
  PlatformCommerceOrderCommandInput,
  CreateCommercePlanInput,
  CreateCommerceOrderInput,
} from '@small-city-basketball/contracts';
import type { ApiClient } from '../api/client';
import { createCommerceApi } from '../api/commerce';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import './commerce.css';
const money = (fen: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(fen / 100);
const labels: Record<string, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '付款已核验',
  REFUND_PENDING: '退款待核验',
  REFUNDED: '已全额退款',
  CANCELLED: '已取消',
  EXPIRED: '报价已过期',
  REQUESTED: '待平台处理',
  PENDING_REVIEW: '待另一位操作员复核',
  PROCESSING: '退款处理中',
  SUCCEEDED: '退款已确认',
  REJECTED: '核验未通过',
  FAILED: '退款结果需核查',
  UNKNOWN: '结果待查询',
};
type Pending =
  | {
      kind: 'ORDER';
      order: CommerceOrderData;
      type: CommerceOrderCommandInput['type'] | PlatformCommerceOrderCommandInput['type'];
      title: string;
      commandId: string;
    }
  | { kind: 'BUY'; input: CreateCommerceOrderInput; plan: CommercePlanData; eventName: string }
  | { kind: 'PLAN'; input: CreateCommercePlanInput }
  | { kind: 'AVAILABILITY'; plan: CommercePlanData; commandId: string };
export function OrgCommercePage({ context }: { context: RegistrationWorkspace }) {
  if (!context.organizationId)
    return (
      <div className="panel registration-state">
        <h1>套餐与订单</h1>
        <p>请选择机构管理工作空间。球队授权不包含机构采购和财务资料。</p>
      </div>
    );
  return (
    <CommercePage
      key={`${context.organizationId}:${context.userId}`}
      client={context.client}
      orgId={context.organizationId}
      userId={context.userId}
    />
  );
}
export function PlatformCommercePage({ client, userId }: { client: ApiClient; userId: string }) {
  return <CommercePage key={`platform:${userId}`} client={client} userId={userId} />;
}
function CommercePage({
  client,
  orgId,
  userId,
}: {
  client: ApiClient;
  orgId?: string;
  userId: string;
}) {
  const api = useMemo(() => createCommerceApi(client, orgId), [client, orgId]);
  const read = useCallback(() => api.workspace(), [api]);
  const resource = useResource(read);
  const data = resource.data;
  const action = useAction();
  const [pending, setPending] = useState<Pending>();
  const [why, setWhy] = useState('');
  const [external, setExternal] = useState('');
  const [notice, setNotice] = useState('');
  const [eventId, setEventId] = useState('');
  const [planId, setPlanId] = useState('');
  const [planForm, setPlanForm] = useState({
    code: '',
    name: '',
    price: '',
    maxTeams: '32',
    maxMatches: '496',
    validDays: '365',
    reason: '',
  });
  const [csv, setCsv] = useState('');
  const [billDate, setBillDate] = useState('');
  const [billSource, setBillSource] = useState<'MANUAL' | 'WECHAT_NATIVE'>('MANUAL');
  const [billReason, setBillReason] = useState('');
  const [native, setNative] = useState<{ orderId: string; codeUrl: string }>();
  const [qr, setQr] = useState('');
  const [qrError, setQrError] = useState('');
  useEffect(() => {
    let active = true;
    setQr('');
    setQrError('');
    if (native)
      void QRCode.toDataURL(native.codeUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active) setQrError('二维码暂未生成，可复制付款链接后联系平台核验。');
        });
    return () => {
      active = false;
    };
  }, [native]);
  const reload = () => {
    setPending(undefined);
    resource.reload();
  };
  const open = (
    order: CommerceOrderData,
    type: Extract<Pending, { kind: 'ORDER' }>['type'],
    title: string,
  ) => {
    if (!action.conflict) {
      setWhy('');
      setExternal('');
    }
    action.clear();
    setPending({ kind: 'ORDER', order, type, title, commandId: crypto.randomUUID() });
  };
  async function execute() {
    if (!pending || action.busy) return;
    const selected = pending;
    await action.run(async () => {
      setNotice('');
      if (selected.kind === 'PLAN') await api.createPlan(selected.input);
      else if (selected.kind === 'AVAILABILITY')
        await api.planCommand(selected.plan.id, {
          commandId: selected.commandId,
          type: 'SET_AVAILABILITY',
          expectedCatalogVersion: selected.plan.catalogVersion,
          available: !selected.plan.available,
          reason: why,
        });
      else {
        const result =
          selected.kind === 'BUY'
            ? await api.createOrder(selected.input)
            : orgId
              ? await api.buyerCommand(selected.order.id, {
                  commandId: selected.commandId,
                  type: selected.type as CommerceOrderCommandInput['type'],
                  expectedOrderVersion: selected.order.version,
                  ...(['CANCEL', 'REQUEST_REFUND'].includes(selected.type) ? { reason: why } : {}),
                })
              : await api.platformCommand(selected.order.id, {
                  commandId: selected.commandId,
                  type: selected.type as PlatformCommerceOrderCommandInput['type'],
                  expectedOrderVersion: selected.order.version,
                  reason: why,
                  ...(external ? { externalReference: external } : {}),
                });
        if (result.nativePayment)
          setNative({ orderId: result.order.id, codeUrl: result.nativePayment.codeUrl });
        if (result.notice) setNotice(result.notice);
        if (result.order.paidAt || result.order.status !== 'PENDING_PAYMENT') setNative(undefined);
      }
      if (action.isActive()) {
        setPending(undefined);
        resource.reload();
      }
    }, '操作已登记，请以最新订单状态为准。');
  }
  function prepareBuy(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    const event = data.events.find((e) => e.id === eventId),
      plan = data.plans.find((p) => p.id === planId && p.available);
    if (!event || !plan) return;
    setPending({
      kind: 'BUY',
      input: {
        commandId: crypto.randomUUID(),
        eventId: event.id,
        planId: plan.id,
        expectedEventVersion: event.version,
      },
      plan,
      eventName: event.name,
    });
  }
  function preparePlan(e: FormEvent) {
    e.preventDefault();
    const parts = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(planForm.price);
    if (!parts) {
      setNotice('价格须为最多两位小数的人民币金额。');
      return;
    }
    const amountFen = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
    setPending({
      kind: 'PLAN',
      input: {
        commandId: crypto.randomUUID(),
        code: planForm.code,
        name: planForm.name,
        currency: 'CNY',
        amountFen,
        maxTeams: Number(planForm.maxTeams),
        maxMatches: Number(planForm.maxMatches),
        validDays: Number(planForm.validDays),
        reason: planForm.reason,
      },
    });
  }
  async function reconcile(e: FormEvent) {
    e.preventDefault();
    await action.run(async () => {
      if (billSource === 'MANUAL' && new TextEncoder().encode(csv).length > 65536)
        throw new Error('对账CSV最多64KiB');
      const result = await api.reconcile({
        commandId: crypto.randomUUID(),
        billDate,
        source: billSource,
        ...(billSource === 'MANUAL' ? { csv } : {}),
        reason: billReason,
      });
      if (action.isActive()) {
        setNotice(
          `对账已记录：${result.matchedCount}笔匹配，${result.issues.length}项差异。对账不会自动修改收款或权益。`,
        );
        resource.reload();
      }
    }, '对账记录已保存');
  }
  const title = orgId ? '套餐与订单' : '平台商业运营';
  return (
    <div className="commerce-page">
      <PageHeading
        eyebrow="小城市篮球"
        title={title}
        description="按届购买赛事软件服务。球队、球员与观众的基础查看不收费。"
      >
        <button className="button button-secondary" onClick={reload} disabled={action.busy}>
          刷新商业资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={reload} />
      {notice && (
        <div className="success-notice" role="status">
          {notice}
        </div>
      )}
      {!data ? (
        <ResourceState loading={resource.loading} error={resource.error} reload={resource.reload} />
      ) : (
        <>
          {data.mode === 'OFF' && (
            <div className="panel commerce-note">
              当前未启用收费权益限制；已有赛事继续使用。订单开通与正式收款不会由页面演示代替。
            </div>
          )}
          <section className="panel commerce-panel">
            <h2>按届软件套餐</h2>
            <div className="commerce-grid">
              {data.plans.map((plan) => (
                <article className="commerce-card" key={plan.id}>
                  <h3>
                    {plan.name} <small>v{plan.version}</small>
                  </h3>
                  <strong>{money(plan.amountFen)} / 届</strong>
                  <p>
                    最多{plan.maxTeams}队 · {plan.maxMatches}场 · 付款后{plan.validDays}天内激活
                  </p>
                  <p>{plan.available ? '可购买' : '已停售；原报价保留'}</p>
                  {!orgId && data.platformOperator && (
                    <button
                      className="button button-secondary"
                      disabled={action.busy}
                      onClick={() => {
                        setWhy('');
                        setPending({ kind: 'AVAILABILITY', plan, commandId: crypto.randomUUID() });
                      }}
                    >
                      {plan.available ? '停售此版本' : '重新上架此版本'}
                    </button>
                  )}
                </article>
              ))}
            </div>
            {!data.plans.length && <p>暂无可购买套餐，请联系平台。</p>}
            {orgId && data.canPurchase && (
              <form className="commerce-form" onSubmit={prepareBuy}>
                <label>
                  赛事
                  <select value={eventId} onChange={(e) => setEventId(e.target.value)} required>
                    <option value="">请选择待开通赛事</option>
                    {data.events
                      .filter(
                        (e) =>
                          !data.activations.some((a) => a.eventId === e.id) &&
                          !['CANCELLED', 'COMPLETED', 'ARCHIVED'].includes(e.status),
                      )
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  套餐版本
                  <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
                    <option value="">请选择明确报价</option>
                    {data.plans
                      .filter((p) => p.available)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} v{p.version} {money(p.amountFen)}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="button button-primary"
                  disabled={action.busy || !eventId || !planId}
                >
                  核对本届订单
                </button>
              </form>
            )}
          </section>
          {!orgId && data.platformOperator && (
            <section className="panel commerce-panel">
              <h2>创建套餐新版本</h2>
              <p>
                版本报价发布后不能改价；调整服务范围请新建版本。机构负责人不能自行开通平台权限。
              </p>
              <form className="commerce-form" onSubmit={preparePlan}>
                {(
                  [
                    ['code', '套餐代码'],
                    ['name', '套餐名称'],
                    ['price', '价格（元）'],
                    ['maxTeams', '最多球队'],
                    ['maxMatches', '最多比赛'],
                    ['validDays', '激活有效天数'],
                    ['reason', '发布原因'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      value={planForm[key]}
                      onChange={(e) => setPlanForm((v) => ({ ...v, [key]: e.target.value }))}
                      required
                      maxLength={key === 'reason' ? 500 : 80}
                      inputMode={
                        ['price', 'maxTeams', 'maxMatches', 'validDays'].includes(key)
                          ? 'decimal'
                          : undefined
                      }
                    />
                  </label>
                ))}
                <button className="button button-primary" disabled={action.busy}>
                  核对并发布套餐版本
                </button>
              </form>
            </section>
          )}
          <section className="panel commerce-panel">
            <h2>订单与核验</h2>
            <p>付款链接或二维码出现不代表付款成功。人工收款与退款须由两位不同平台操作员核验。</p>
            <div className="commerce-grid">
              {data.orders.map((order) => (
                <article
                  className="commerce-card"
                  key={order.id}
                  aria-label={`${order.eventName}订单`}
                >
                  <h3>{order.eventName}</h3>
                  <p>
                    {order.quote.name} v{order.quote.version} · {money(order.quote.amountFen)}
                  </p>
                  <strong>{labels[order.status] ?? order.status}</strong>
                  <p>
                    订单版本{order.version} · {order.activated ? '该届服务已激活' : '尚未激活服务'}
                  </p>
                  <p>报价截止 {new Date(order.expiresAt).toLocaleString('zh-CN')}</p>
                  {order.paymentReview && (
                    <p>
                      收款核验：{labels[order.paymentReview.status] ?? order.paymentReview.status}
                      {order.paymentReview.submittedByUserId === userId
                        ? '（你提交，需另一位操作员复核）'
                        : ''}
                    </p>
                  )}
                  {order.refund && (
                    <p>退款：{labels[order.refund.status] ?? order.refund.status}</p>
                  )}
                  <div className="commerce-actions">
                    {orgId ? (
                      <>
                        {order.capabilities.canCancel && (
                          <button
                            className="button button-secondary"
                            disabled={action.busy}
                            onClick={() => open(order, 'CANCEL', '取消未付款订单')}
                          >
                            取消订单
                          </button>
                        )}
                        {order.capabilities.canRequestRefund && (
                          <button
                            className="button button-secondary"
                            disabled={action.busy}
                            onClick={() => open(order, 'REQUEST_REFUND', '申请未使用订单全额退款')}
                          >
                            申请全额退款
                          </button>
                        )}
                        {order.capabilities.canCreateNative && (
                          <button
                            className="button button-primary"
                            disabled={action.busy}
                            onClick={() => open(order, 'CREATE_NATIVE', '发起微信付款')}
                          >
                            微信付款
                          </button>
                        )}
                        {order.capabilities.canQueryPayment && (
                          <button
                            className="button button-secondary"
                            disabled={action.busy}
                            onClick={() => open(order, 'QUERY_PAYMENT', '查询原微信订单')}
                          >
                            查询付款结果
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        {(
                          [
                            ['canSubmitPayment', 'SUBMIT_PAYMENT', '提交线下收款核验'],
                            ['canConfirmPayment', 'CONFIRM_PAYMENT', '独立确认线下到账'],
                            ['canRejectPayment', 'REJECT_PAYMENT', '驳回收款核验'],
                            ['canSubmitRefund', 'SUBMIT_REFUND', '提交全额退款复核'],
                            ['canConfirmRefund', 'CONFIRM_REFUND', '独立确认全额退款'],
                            ['canRejectRefund', 'REJECT_REFUND', '驳回退款复核'],
                          ] as const
                        ).map(
                          ([cap, type, label]) =>
                            order.capabilities[cap] && (
                              <button
                                key={type}
                                className="button button-secondary"
                                disabled={action.busy}
                                onClick={() => open(order, type, label)}
                              >
                                {label}
                              </button>
                            ),
                        )}
                        {data.realPaymentEnabled &&
                          order.channel === 'WECHAT_NATIVE' &&
                          order.refund &&
                          (['PROCESSING', 'UNKNOWN', 'FAILED'].includes(order.refund.status) ||
                            (order.refund.status === 'SUCCEEDED' &&
                              order.refund.acceptedAt === null)) && (
                            <button
                              className="button button-secondary"
                              disabled={action.busy}
                              onClick={() => open(order, 'QUERY_REFUND', '查询原微信退款')}
                            >
                              查询退款结果
                            </button>
                          )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
            {!data.orders.length && <p>暂无订单。</p>}
          </section>
          {native && (
            <section className="panel commerce-panel" aria-label="微信付款">
              <h2>微信付款</h2>
              {qr ? (
                <img className="commerce-qr" src={qr} alt="微信付款二维码" />
              ) : (
                <p role="status">{qrError || '正在生成付款二维码…'}</p>
              )}
              <label>
                原订单付款链接
                <textarea readOnly value={native.codeUrl} />
              </label>
              <p>
                请使用微信扫描二维码。付款后点击原订单的“查询付款结果”；本页不会根据扫码或页面跳转自动开通权益。
              </p>
            </section>
          )}
          {orgId && (
            <section className="panel commerce-panel">
              <h2>本届软件权益</h2>
              <p>首次发布赛程时激活，已激活赛事不会因到期突然停止记分、晋级或读取。</p>
              {data.entitlements.map((e) => (
                <article key={e.id} className="commerce-card">
                  <h3>{e.eventName}</h3>
                  <p>
                    {e.revokedAt
                      ? '退款后已撤销'
                      : e.activated
                        ? '已激活，赛事继续使用'
                        : `待激活，有效至 ${new Date(e.validUntil).toLocaleString('zh-CN')}`}
                  </p>
                  <p>
                    {e.maxTeams}队 / {e.maxMatches}场
                  </p>
                </article>
              ))}
              {!data.entitlements.length && (
                <p>
                  {data.activations.length
                    ? '已有旧版或免费模式激活记录，原赛事继续使用。'
                    : '暂无已核验的软件权益。'}
                </p>
              )}
            </section>
          )}
          {!orgId && data.platformOperator && (
            <section className="panel commerce-panel">
              <h2>交易对账</h2>
              <p>对账只记录差异，不自动把未付款订单改为已付款。</p>
              <form className="commerce-form" onSubmit={reconcile}>
                <label>
                  账单日期
                  <input
                    type="date"
                    required
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </label>
                <label>
                  账单来源
                  <select
                    value={billSource}
                    onChange={(e) => setBillSource(e.target.value as 'MANUAL' | 'WECHAT_NATIVE')}
                  >
                    <option value="MANUAL">人工核验账单</option>
                    {data.realPaymentEnabled && <option value="WECHAT_NATIVE">微信商户账单</option>}
                  </select>
                </label>
                {billSource === 'MANUAL' && (
                  <label className="commerce-wide">
                    账单CSV（最多64KiB）
                    <textarea
                      required
                      value={csv}
                      onChange={(e) => setCsv(e.target.value)}
                      placeholder="order_id,transaction_reference,amount,currency,status"
                    />
                    <small>每行：订单编号、实际交易引用、人民币元金额、CNY、PAID或REFUNDED。</small>
                  </label>
                )}
                <label>
                  对账原因
                  <input
                    required
                    minLength={4}
                    maxLength={500}
                    value={billReason}
                    onChange={(e) => setBillReason(e.target.value)}
                  />
                </label>
                <button className="button button-secondary" disabled={action.busy}>
                  记录对账结果
                </button>
              </form>
              {data.reconciliations.map((r) => (
                <article key={r.id} className="commerce-card">
                  <h3>
                    {r.billDate} {r.source === 'MANUAL' ? '人工' : '微信'}对账
                  </h3>
                  <p>
                    {r.matchedCount}笔匹配，{r.issues.length}项差异
                  </p>
                  {r.issues.map((issue, index) => (
                    <p key={index}>
                      {issue.code}：{issue.description}
                    </p>
                  ))}
                </article>
              ))}
            </section>
          )}
          {!data.realPaymentEnabled && (
            <p className="commerce-muted">
              微信在线支付尚未开通。线下收款仍须独立核验，不能以付款截图或页面跳转直接开通服务。
            </p>
          )}
        </>
      )}
      {pending && (
        <Modal
          title={
            pending.kind === 'ORDER'
              ? pending.title
              : pending.kind === 'BUY'
                ? '确认本届软件订单'
                : pending.kind === 'PLAN'
                  ? '发布不可变套餐版本'
                  : '确认套餐上下架'
          }
          busy={action.busy}
          onClose={() => setPending(undefined)}
        >
          {pending.kind === 'BUY' ? (
            <>
              <p>
                {pending.eventName} · {pending.plan.name} v{pending.plan.version}
              </p>
              <strong>{money(pending.plan.amountFen)}，仅本届软件服务费</strong>
              <p>订单价格由服务端冻结。下单不会自动标记付款。</p>
            </>
          ) : pending.kind === 'PLAN' ? (
            <>
              <p>
                {pending.input.name} · {money(pending.input.amountFen)}
              </p>
              <p>
                最多{pending.input.maxTeams}队 / {pending.input.maxMatches}场 /{' '}
                {pending.input.validDays}天激活有效期。发布后价格及额度不能修改。
              </p>
            </>
          ) : (
            <>
              {pending.kind === 'ORDER' && (
                <p>
                  {pending.order.eventName} · {money(pending.order.quote.amountFen)} · 订单版本
                  {pending.order.version}
                </p>
              )}
              <label>
                操作原因
                <textarea
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  minLength={4}
                  maxLength={500}
                  required
                />
              </label>
              {pending.kind === 'ORDER' &&
                ['SUBMIT_PAYMENT', 'SUBMIT_REFUND'].includes(pending.type) && (
                  <label>
                    实际线下交易引用
                    <input
                      aria-label="实际线下交易引用"
                      value={external}
                      onChange={(e) => setExternal(e.target.value)}
                      maxLength={128}
                    />
                    <small>
                      微信退款无需填写；线下须提供单行、无逗号的真实交易引用供另一人核验及对账。
                    </small>
                  </label>
                )}
              {pending.kind === 'ORDER' && pending.type === 'CONFIRM_REFUND' && (
                <p>
                  确认仅用于未激活订单的全额退款；微信渠道可能真实发起资金退回，请核对原订单与金额。
                </p>
              )}
            </>
          )}
          <ActionNotice action={action} onReload={reload} />
          <div className="commerce-actions">
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
            <button
              className="button button-primary"
              disabled={
                action.busy ||
                (((pending.kind === 'ORDER' &&
                  !['CREATE_NATIVE', 'QUERY_PAYMENT'].includes(pending.type)) ||
                  pending.kind === 'AVAILABILITY') &&
                  Array.from(why.trim()).length < 4)
              }
              onClick={() => void execute()}
            >
              确认操作
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
