import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import type {
  SoftwareMembershipPlanData,
  SoftwareMembershipOrderData,
  SoftwareMembershipOrderCommandInput,
  PlatformSoftwareMembershipOrderCommandInput,
  SoftwareMembershipPeriodData,
  CreateSoftwareMembershipOrderInput,
  CreateSoftwareMembershipPlanInput,
} from '@small-city-basketball/contracts';
import type { ApiClient } from '../api/client';
import { ApiError } from '../api/client';
import { createMembershipApi } from '../api/membership';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import {
  MembershipNotice,
  MembershipPeriodTabs,
  membershipMoney as money,
  membershipTime as time,
} from './MembershipComponents';
import type { MembershipPeriodView } from './MembershipComponents';
import {
  membershipDraftFen,
  membershipDraftQuota,
  softwareMembershipPresets,
} from './membership-presets';
import type { MembershipPlanForm } from './membership-presets';
import './membership.css';

type OrderAction =
  SoftwareMembershipOrderCommandInput['type'] | PlatformSoftwareMembershipOrderCommandInput['type'];
type Pending =
  | { kind: 'BUY'; plan: SoftwareMembershipPlanData; input: CreateSoftwareMembershipOrderInput }
  | { kind: 'PLAN'; input: CreateSoftwareMembershipPlanInput }
  | { kind: 'PRESET'; preset: (typeof softwareMembershipPresets)[number] }
  | { kind: 'AVAILABILITY'; plan: SoftwareMembershipPlanData; commandId: string }
  | {
      kind: 'ORDER';
      order: SoftwareMembershipOrderData;
      type: OrderAction;
      commandId: string;
      title: string;
    };
const orderLabels: Record<SoftwareMembershipOrderData['status'], string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '付款已核验',
  REFUND_PENDING: '退款待核验',
  REFUNDED: '已全额退款',
  CANCELLED: '已取消',
  EXPIRED: '报价已过期',
};
const reviewLabels: Record<string, string> = {
  PENDING_REVIEW: '待另一位操作员复核',
  CONFIRMED: '已核验',
  REJECTED: '核验未通过',
  REQUESTED: '待平台处理',
  PROCESSING: '退款处理中',
  SUCCEEDED: '退款已确认',
  FAILED: '退款结果需核查',
  UNKNOWN: '结果待查询',
};
const periodLabels: Record<SoftwareMembershipPeriodData['state'], string> = {
  ACTIVE: '生效中',
  SCHEDULED: '下一购买期，尚未生效',
  EXPIRED: '购买期已到期',
  EXHAUSTED: '本期额度已用尽',
  REFUND_PENDING: '退款核验中，暂停新激活',
  REVOKED: '退款后已撤销',
  UNAVAILABLE: '当前不可新激活',
};
function tierLabel(tier: 'PRO' | 'BUSINESS') {
  return tier === 'PRO' ? '专业机构会员' : '商业机构会员';
}
function daysLabel(days: number) {
  return days === 365 ? '年付 · 365天' : '月付 · 30天';
}
function OrderButtons({
  order,
  platform,
  realPaymentEnabled,
  busy,
  onAction,
}: {
  order: SoftwareMembershipOrderData;
  platform: boolean;
  realPaymentEnabled: boolean;
  busy: boolean;
  onAction: (order: SoftwareMembershipOrderData, type: OrderAction, title: string) => void;
}) {
  const actions = platform
    ? ([
        ['canSubmitPayment', 'SUBMIT_PAYMENT', '提交线下收款核验'],
        ['canConfirmPayment', 'CONFIRM_PAYMENT', '独立确认线下到账'],
        ['canRejectPayment', 'REJECT_PAYMENT', '驳回收款核验'],
        ['canSubmitRefund', 'SUBMIT_REFUND', '提交全额退款复核'],
        ['canConfirmRefund', 'CONFIRM_REFUND', '独立确认全额退款'],
        ['canRejectRefund', 'REJECT_REFUND', '驳回退款复核'],
      ] as const)
    : ([
        ['canCancel', 'CANCEL', '取消订单'],
        ['canRequestRefund', 'REQUEST_REFUND', '申请全额退款'],
        ['canCreateNative', 'CREATE_NATIVE', '微信付款'],
        ['canQueryPayment', 'QUERY_PAYMENT', '查询付款结果'],
      ] as const);
  return (
    <div className="membership-actions">
      {actions.map(
        ([cap, type, label]) =>
          order.capabilities[cap] && (
            <button
              type="button"
              className={`button ${type === 'CREATE_NATIVE' ? 'button-primary' : 'button-secondary'}`}
              disabled={busy}
              key={type}
              onClick={() => onAction(order, type, label)}
            >
              {label}
            </button>
          ),
      )}
      {platform &&
        realPaymentEnabled &&
        order.channel === 'WECHAT_NATIVE' &&
        order.refund &&
        (['PROCESSING', 'UNKNOWN', 'FAILED'].includes(order.refund.status) ||
          (order.refund.status === 'SUCCEEDED' && order.refund.acceptedAt === null)) && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => onAction(order, 'QUERY_REFUND', '查询原退款结果')}
          >
            查询原退款结果
          </button>
        )}
    </div>
  );
}
function PeriodCard({
  period,
  showOrganization = false,
}: {
  period: SoftwareMembershipPeriodData;
  showOrganization?: boolean;
}) {
  return (
    <article className="membership-card" aria-label={`${period.planName}购买期`}>
      <h3>{period.planName}</h3>
      <strong>{periodLabels[period.state]}</strong>
      <p className="membership-counter">
        {period.remainingEvents}
        <small>
          {' '}
          / {period.eventLimit} 届{period.state === 'ACTIVE' ? '可用' : '未用额度'}
        </small>
      </p>
      <dl>
        {showOrganization && (
          <>
            <dt>机构ID</dt>
            <dd>{period.orgId}</dd>
          </>
        )}
        <dt>有效窗口</dt>
        <dd>
          {time(period.startsAt)} 至 {time(period.endsAt)}（北京时间）
        </dd>
        <dt>本期已用</dt>
        <dd>{period.usedEvents}届，来自服务端全期统计</dd>
        <dt>每届上限</dt>
        <dd>
          {period.maxTeams}队 / {period.maxMatches}场
        </dd>
        <dt>续费方式</dt>
        <dd>手动续费，不自动扣费</dd>
        {period.previousPeriodId && (
          <>
            <dt>续接来源</dt>
            <dd>接续上一购买期，额度独立</dd>
          </>
        )}
      </dl>
      {period.state !== 'ACTIVE' && (
        <p className="membership-muted">此状态不能新激活赛事；原已激活赛事继续使用。</p>
      )}
    </article>
  );
}
export function OrgMembershipPage({ context }: { context: RegistrationWorkspace }) {
  if (!context.organizationId)
    return (
      <div className="panel registration-state">
        <h1>会员与权益</h1>
        <p>
          请选择机构管理工作空间。球队、球员授权不包含机构会员采购与财务资料；基础观赛继续免费。
        </p>
      </div>
    );
  return (
    <MembershipPage
      key={`${context.organizationId}:${context.userId}`}
      client={context.client}
      orgId={context.organizationId}
      userId={context.userId}
    />
  );
}
export function PlatformMembershipPage({ client, userId }: { client: ApiClient; userId: string }) {
  return <MembershipPage key={`platform-membership:${userId}`} client={client} userId={userId} />;
}
function MembershipPage({
  client,
  orgId,
  userId,
}: {
  client: ApiClient;
  orgId?: string;
  userId: string;
}) {
  const api = useMemo(() => createMembershipApi(client, orgId), [client, orgId]);
  const alive = useRef(true);
  const [readStatus, setReadStatus] = useState<number>();
  const read = useCallback(async () => {
    try {
      const next = await api.workspace();
      if (alive.current) setReadStatus(undefined);
      return next;
    } catch (cause) {
      if (alive.current) setReadStatus(cause instanceof ApiError ? cause.status : 0);
      throw cause;
    }
  }, [api]);
  const resource = useResource(read),
    data = resource.data,
    action = useAction();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      api.abortPending();
    };
  }, [api]);
  const [periodView, setPeriodView] = useState<MembershipPeriodView>('YEAR');
  const [view, setView] = useState<'PLANS' | 'ORDERS' | 'USAGE'>('PLANS');
  const [pending, setPending] = useState<Pending>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [why, setWhy] = useState(''),
    [external, setExternal] = useState('');
  const [lastActionKey, setLastActionKey] = useState('');
  const [requiresRead, setRequiresRead] = useState(false),
    [unknownResult, setUnknownResult] = useState(false);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<MembershipPlanForm>({
    code: '',
    name: '',
    price: '',
    tier: 'PRO',
    durationDays: 365,
    reason: '',
  });
  const [presetCode, setPresetCode] = useState('');
  const [native, setNative] = useState<{ orderId: string; codeUrl: string }>();
  const [qr, setQr] = useState(''),
    [qrError, setQrError] = useState('');
  useEffect(() => {
    let active = true;
    setQr('');
    setQrError('');
    if (native)
      void QRCode.toDataURL(native.codeUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {
          if (active) setQrError('二维码暂未生成，可复制原付款链接后联系平台核对。');
        });
    return () => {
      active = false;
    };
  }, [native]);
  useEffect(() => {
    if (
      data &&
      native &&
      !data.orders.some(
        (o) => o.id === native.orderId && o.status === 'PENDING_PAYMENT' && !o.paidAt,
      )
    )
      setNative(undefined);
  }, [data, native]);
  const reload = () => {
    setPending(undefined);
    setAcknowledged(false);
    setRequiresRead(false);
    setUnknownResult(false);
    action.clear();
    resource.reload();
  };
  const blocked = action.busy || requiresRead || unknownResult;
  const platform = !orgId;
  const openOrder = (order: SoftwareMembershipOrderData, type: OrderAction, title: string) => {
    if (blocked) return;
    const key = `${order.id}:${type}`;
    if (lastActionKey !== key) {
      setWhy('');
      setExternal('');
    }
    setLastActionKey(key);
    action.clear();
    setPending({ kind: 'ORDER', order, type, title, commandId: crypto.randomUUID() });
  };
  const openBuy = (plan: SoftwareMembershipPlanData) => {
    if (!data || blocked || !data.canPurchase || !data.purchasablePlanIds.includes(plan.id)) return;
    action.clear();
    setAcknowledged(false);
    setPending({
      kind: 'BUY',
      plan,
      input: {
        commandId: crypto.randomUUID(),
        planId: plan.id,
        expectedMembershipVersion: data.membershipVersion,
      },
    });
  };
  async function execute() {
    if (!pending || blocked) return;
    if (pending.kind === 'PRESET') {
      const preset = pending.preset;
      setForm((current) => ({ ...preset, reason: current.reason }));
      setPending(undefined);
      setNotice('会员建议已载入本地草稿，尚未发布、收费或开通权益。请核对后独立发布。');
      return;
    }
    const selected = pending;
    await action.run(async () => {
      try {
        setNotice('');
        if (selected.kind === 'PLAN') {
          await api.createPlan(selected.input);
          if (!action.isActive()) return false;
          setPeriodView(selected.input.durationDays === 365 ? 'YEAR' : 'MONTH');
        } else if (selected.kind === 'AVAILABILITY')
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
                    type: selected.type as SoftwareMembershipOrderCommandInput['type'],
                    expectedOrderVersion: selected.order.version,
                    ...(['CANCEL', 'REQUEST_REFUND'].includes(selected.type)
                      ? { reason: why }
                      : {}),
                  })
                : await api.platformCommand(selected.order.id, {
                    commandId: selected.commandId,
                    type: selected.type as PlatformSoftwareMembershipOrderCommandInput['type'],
                    expectedOrderVersion: selected.order.version,
                    reason: why,
                    ...(external ? { externalReference: external } : {}),
                  });
          if (!action.isActive()) return false;
          if (result.nativePayment)
            setNative({ orderId: result.order.id, codeUrl: result.nativePayment.codeUrl });
          if (result.order.paidAt || result.order.status !== 'PENDING_PAYMENT')
            setNative(undefined);
          if (result.notice) setNotice(result.notice);
          setView('ORDERS');
        }
        if (action.isActive()) {
          setPending(undefined);
          setAcknowledged(false);
          resource.reload();
        }
      } catch (cause) {
        if (action.isActive()) {
          if (cause instanceof ApiError && [401, 403, 409].includes(cause.status))
            setRequiresRead(true);
          if (
            !(cause instanceof ApiError) ||
            cause.status === 0 ||
            cause.status >= 500 ||
            cause.apiCode === 'INVALID_RESPONSE'
          )
            setUnknownResult(true);
        }
        throw cause;
      }
    }, '操作已登记，请以服务端最新订单和购买期为准。');
  }
  function preparePlan(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const amountFen = membershipDraftFen(form.price);
    if (
      amountFen === null ||
      !/^[a-z][a-z0-9_-]{1,31}$/.test(form.code) ||
      !form.name.trim() ||
      Array.from(form.reason.trim()).length < 4
    ) {
      setNotice('请检查套餐代码、名称、至少0.01元的两位小数价格，以及不少于4字的发布原因。');
      return;
    }
    action.clear();
    setPending({
      kind: 'PLAN',
      input: {
        commandId: crypto.randomUUID(),
        code: form.code,
        name: form.name.trim(),
        currency: 'CNY',
        amountFen,
        tier: form.tier,
        durationDays: form.durationDays,
        reason: form.reason.trim(),
      },
    });
  }
  const current =
    data?.periods.find((p) => p.state === 'ACTIVE') ??
    data?.periods.find((p) => p.state === 'EXHAUSTED') ??
    data?.periods.find((p) => p.state === 'SCHEDULED') ??
    data?.periods[0];
  const needsWhy =
    pending?.kind === 'AVAILABILITY' ||
    (pending?.kind === 'ORDER' && !['CREATE_NATIVE', 'QUERY_PAYMENT'].includes(pending.type));
  return (
    <div className="membership-page">
      <PageHeading
        eyebrow="小城市篮球"
        title={platform ? '平台会员运营' : '会员与权益'}
        description="球迷免费使用，机构按需办赛。会员不改变管理、审核或记分权限。"
      >
        <button
          type="button"
          className="button button-secondary"
          disabled={action.busy}
          onClick={reload}
        >
          刷新会员资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={reload} />
      {notice && <MembershipNotice>{notice}</MembershipNotice>}
      {(requiresRead || unknownResult) && (
        <MembershipNotice
          tone="warning"
          role="alert"
          title={unknownResult ? '操作结果待核对' : '请重新读取后核对'}
        >
          保留了当前输入；请刷新会员资料核对原订单，不要重复付款或新建退款。
        </MembershipNotice>
      )}
      {!data ? (
        resource.loading ? (
          <ResourceState loading error="" reload={reload} />
        ) : (
          <MembershipNotice
            tone="error"
            role="alert"
            title={
              readStatus === 401
                ? '登录已失效'
                : readStatus === 403
                  ? '没有会员采购或管理权限'
                  : '暂时无法读取会员权益'
            }
          >
            {resource.error}
            <span className="membership-actions">
              <button type="button" className="button button-secondary" onClick={reload}>
                重新读取
              </button>
              {readStatus === 401 ? (
                <a
                  className="button button-secondary"
                  href={orgId ? '/membership' : '/platform/membership'}
                >
                  重新登录
                </a>
              ) : (
                <Link className="button button-secondary" to="/">
                  返回工作台
                </Link>
              )}
            </span>
          </MembershipNotice>
        )
      ) : (
        <>
          {data.mode === 'OFF' && (
            <MembershipNotice tone="warning" title="收费限制未启用">
              当前不会从此入口新建会员订单；原已激活赛事继续按原权益使用。计划展示不等于已经收款或开通。
            </MembershipNotice>
          )}
          {!platform && (
            <div className="membership-current">
              <ShieldCheck size={22} aria-hidden="true" />
              <div>
                <strong>
                  {current
                    ? `${current.planName} · ${periodLabels[current.state]}`
                    : '当前尚未开通机构会员'}
                </strong>
                <p>
                  {current
                    ? `${current.remainingEvents}/${current.eventLimit}届未消费；${current.state === 'ACTIVE' ? '本期可新激活赛事' : '请按本期状态核对，未消费不等于可使用'}`
                    : '基础观赛免费；需要办赛时可选择已发布会员或按届套餐。'}
                </p>
                <p className="membership-muted">
                  机构：{data.organizationName ?? data.orgId} · 核对时间 {time(data.serverTime)}
                  （北京时间）
                </p>
              </div>
            </div>
          )}
          <div className="membership-tabs" role="tablist" aria-label="会员工作空间">
            <button
              type="button"
              className="button button-secondary"
              role="tab"
              aria-selected={view === 'PLANS'}
              onClick={() => setView('PLANS')}
            >
              {platform ? '会员套餐' : '机构会员'}
            </button>
            <Link
              className="button button-secondary"
              to={platform ? '/platform/commerce' : '/commerce'}
            >
              按届套餐
            </Link>
            <button
              type="button"
              className="button button-secondary"
              role="tab"
              aria-selected={view === 'ORDERS'}
              onClick={() => setView('ORDERS')}
            >
              会员订单
            </button>
            <button
              type="button"
              className="button button-secondary"
              role="tab"
              aria-selected={view === 'USAGE'}
              onClick={() => setView('USAGE')}
            >
              购买期与用量
            </button>
          </div>
          {view === 'PLANS' && (
            <>
              <section className="panel membership-panel">
                <div className="membership-section-heading">
                  <h2>机构会员方案</h2>
                  <MembershipPeriodTabs value={periodView} onChange={setPeriodView} />
                </div>
                <div className="membership-plan-grid">
                  {!platform && (
                    <article className="membership-plan-card is-free">
                      <h3>球迷基础版</h3>
                      <div className="membership-price">¥0</div>
                      <p>基础查看免费</p>
                      <ul>
                        <li>
                          <Check size={16} />
                          比分、赛程与排名
                        </li>
                        <li>
                          <Check size={16} />
                          基础档案与关注
                        </li>
                        <li>
                          <Check size={16} />
                          报名与预约按原业务办理
                        </li>
                      </ul>
                      <span className="button button-secondary">基础使用免费</span>
                    </article>
                  )}
                  {data.plans
                    .filter(
                      (p) =>
                        p.durationDays === (periodView === 'YEAR' ? 365 : 30) &&
                        (platform || p.available),
                    )
                    .map((plan) => (
                      <article
                        key={plan.id}
                        className={`membership-plan-card ${plan.tier === 'PRO' ? 'is-featured' : ''}`}
                      >
                        <h3>{plan.name}</h3>
                        <div className="membership-price">
                          {money(plan.amountFen)}
                          <small>/ {plan.durationDays === 365 ? '年' : '30天'}</small>
                        </div>
                        <p>
                          {daysLabel(plan.durationDays)} ·{' '}
                          {plan.durationDays === 365 ? '全年总额度' : '本期总额度'} · v
                          {plan.version}
                        </p>
                        <ul>
                          <li>
                            <Check size={16} />
                            {plan.durationDays === 365 ? '全年' : '30天内'}
                            {plan.eventLimit}届赛事额度
                          </li>
                          <li>
                            <Check size={16} />
                            每届最多{plan.maxTeams}队 · {plan.maxMatches}场
                          </li>
                          <li>
                            <Check size={16} />
                            原有赛务工具与人员协作
                          </li>
                        </ul>
                        <small>手动续费，不自动扣费</small>
                        {platform ? (
                          <>
                            <p>{plan.available ? '已上架' : '已停售；原报价保留'}</p>
                            <button
                              type="button"
                              className="button button-secondary"
                              disabled={blocked}
                              onClick={() => {
                                setWhy('');
                                action.clear();
                                setPending({
                                  kind: 'AVAILABILITY',
                                  plan,
                                  commandId: crypto.randomUUID(),
                                });
                              }}
                            >
                              {plan.available ? '停售此会员版本' : '重新上架此会员版本'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={
                              blocked ||
                              !data.canPurchase ||
                              !data.purchasablePlanIds.includes(plan.id)
                            }
                            onClick={() => openBuy(plan)}
                          >
                            核对购买{tierLabel(plan.tier)}
                          </button>
                        )}
                      </article>
                    ))}
                </div>
                {data.historyTruncated.plans && (
                  <MembershipNotice tone="warning">
                    仅展示最近100条会员套餐版本，更早计划请联系平台核对；当前目录不代表全部历史。
                  </MembershipNotice>
                )}
                {!data.plans.some(
                  (p) =>
                    p.durationDays === (periodView === 'YEAR' ? 365 : 30) &&
                    (platform || p.available),
                ) && (
                  <MembershipNotice title="暂无该周期可售会员">
                    请联系平台发布真实套餐版本；不会用本地建议价格创建订单。
                  </MembershipNotice>
                )}
                {data.purchaseNotice && (
                  <div className="membership-actions">
                    <MembershipNotice tone="warning">{data.purchaseNotice}</MembershipNotice>
                  </div>
                )}
                {!platform && !data.canPurchase && data.mode === 'ENFORCED' && (
                  <div className="membership-actions">
                    <MembershipNotice>
                      当前身份仅可查看；会员由机构负责人采购，购买不会提升权限。
                    </MembershipNotice>
                  </div>
                )}
              </section>
              {platform && data.platformOperator && (
                <section className="panel membership-panel">
                  <h2>创建会员套餐新版本</h2>
                  <p>
                    先将建议填入本地草稿，再独立核对发布。已发布的价格和条件不能修改，调整时创建新版本。
                  </p>
                  <form className="membership-form" onSubmit={preparePlan}>
                    <label>
                      建议会员模板
                      <select value={presetCode} onChange={(e) => setPresetCode(e.target.value)}>
                        <option value="">请选择本地建议</option>
                        {softwareMembershipPresets.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.name} · {p.price}元
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={blocked || !presetCode}
                      onClick={() => {
                        const preset = softwareMembershipPresets.find((p) => p.code === presetCode);
                        if (preset) setPending({ kind: 'PRESET', preset });
                      }}
                    >
                      载入会员建议
                    </button>
                    <label>
                      套餐代码
                      <input
                        value={form.code}
                        maxLength={32}
                        required
                        onChange={(e) => setForm((v) => ({ ...v, code: e.target.value }))}
                      />
                    </label>
                    <label>
                      套餐名称
                      <input
                        value={form.name}
                        maxLength={80}
                        required
                        onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                      />
                    </label>
                    <label>
                      价格（元）
                      <input
                        value={form.price}
                        inputMode="decimal"
                        maxLength={16}
                        required
                        onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))}
                      />
                    </label>
                    <label>
                      会员等级
                      <select
                        value={form.tier}
                        onChange={(e) =>
                          setForm((v) => ({
                            ...v,
                            tier: e.target.value as MembershipPlanForm['tier'],
                          }))
                        }
                      >
                        <option value="PRO">专业机构</option>
                        <option value="BUSINESS">商业机构</option>
                      </select>
                    </label>
                    <label>
                      购买期
                      <select
                        value={form.durationDays}
                        onChange={(e) =>
                          setForm((v) => ({
                            ...v,
                            durationDays: Number(
                              e.target.value,
                            ) as MembershipPlanForm['durationDays'],
                          }))
                        }
                      >
                        <option value={30}>月付 · 30天</option>
                        <option value={365}>年付 · 365天</option>
                      </select>
                    </label>
                    <label className="membership-wide">
                      发布原因
                      <textarea
                        value={form.reason}
                        minLength={4}
                        maxLength={500}
                        required
                        onChange={(e) => setForm((v) => ({ ...v, reason: e.target.value }))}
                      />
                    </label>
                    <p className="membership-wide membership-muted">
                      固定额度：{membershipDraftQuota(form.tier, form.durationDays).eventLimit}届 /{' '}
                      {form.durationDays}天，每届
                      {membershipDraftQuota(form.tier, form.durationDays).maxTeams}队、
                      {membershipDraftQuota(form.tier, form.durationDays).maxMatches}
                      场。服务端派生额度，不由表单提交。
                    </p>
                    <button className="button button-primary" disabled={blocked}>
                      核对并发布会员套餐
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          {view === 'ORDERS' && (
            <section className="panel membership-panel">
              <h2>会员订单与核验</h2>
              <p>创建订单或显示二维码不代表付款成功。人工收款及退款仍需两位不同平台操作员核验。</p>
              <div className="membership-period-grid">
                {data.orders.map((order) => (
                  <article
                    className="membership-card"
                    key={order.id}
                    aria-label={`${order.quote.name}会员订单`}
                  >
                    <h3>
                      {order.quote.name} v{order.quote.version}
                    </h3>
                    <strong>{orderLabels[order.status]}</strong>
                    <dl>
                      <dt>订单金额</dt>
                      <dd>{money(order.quote.amountFen)}</dd>
                      <dt>购买期与额度</dt>
                      <dd>
                        {order.quote.durationDays}天 / {order.quote.eventLimit}届，每届
                        {order.quote.maxTeams}队、{order.quote.maxMatches}场
                      </dd>
                      <dt>付费机构</dt>
                      <dd>{orgId ? (data.organizationName ?? order.orgId) : order.orgId}</dd>
                      <dt>订单编号</dt>
                      <dd>
                        {order.id} · v{order.version}
                      </dd>
                      <dt>报价截止</dt>
                      <dd>{time(order.expiresAt)}（北京时间）</dd>
                      <dt>额度履约</dt>
                      <dd>{order.activated ? '本期已消耗赛事额度' : '尚未消耗赛事额度'}</dd>
                      {order.quote.previousPeriodId && (
                        <>
                          <dt>续费安排</dt>
                          <dd>接续上一购买期结束，不提前借用新额度</dd>
                        </>
                      )}
                    </dl>
                    {order.paymentReview && (
                      <p>
                        收款核验：{reviewLabels[order.paymentReview.status]}
                        {order.paymentReview.submittedByUserId === userId
                          ? '（你提交，需另一位操作员复核）'
                          : ''}
                      </p>
                    )}
                    {order.refund && <p>退款：{reviewLabels[order.refund.status]}</p>}
                    <OrderButtons
                      order={order}
                      platform={platform}
                      realPaymentEnabled={data.realPaymentEnabled}
                      busy={blocked}
                      onAction={openOrder}
                    />
                  </article>
                ))}
              </div>
              {!data.orders.length && <p>暂无会员订单。未读取到的订单不会被显示成已付款。</p>}
              {data.historyTruncated.orders && (
                <MembershipNotice tone="warning">
                  仅展示最近100笔会员订单，更早记录请联系平台核对；当前列表不代表全部交易。
                </MembershipNotice>
              )}
              {native && (
                <section className="membership-card" aria-label="原订单微信付款">
                  <h3>原订单微信付款</h3>
                  {qr ? (
                    <img className="membership-qr" src={qr} alt="会员订单微信付款二维码" />
                  ) : (
                    <p role="status">{qrError || '正在生成原订单二维码…'}</p>
                  )}
                  <label>
                    原订单付款链接
                    <textarea value={native.codeUrl} readOnly />
                  </label>
                  <p>请用微信扫码。付款后查询原订单结果；本页不会因扫码或页面跳转自动开通会员。</p>
                </section>
              )}
            </section>
          )}
          {view === 'USAGE' && (
            <section className="panel membership-panel">
              <h2>购买期与用量</h2>
              <p>
                首次正式发布一届赛事消耗1届额度，草稿、报名和预演不扣额；已购按届权益优先。已激活赛事不因会员到期中断。
              </p>
              <div className="membership-period-grid">
                {data.periods.map((period) => (
                  <PeriodCard key={period.id} period={period} showOrganization={platform} />
                ))}
              </div>
              {!data.periods.length && (
                <p>暂无已核验的会员购买期；待付订单不会提前生成可用额度。</p>
              )}
              {data.historyTruncated.periods && (
                <MembershipNotice tone="warning">
                  购买期历史只展示最近100条；每期已用与剩余是服务端全期统计，不从列表估算。
                </MembershipNotice>
              )}
              <h3>{platform ? '各机构赛事额度记录' : '本机构赛事额度记录'}</h3>
              <div className="membership-usage-list">
                {data.allocations.map((item) => (
                  <article className="membership-usage-row" key={item.eventId}>
                    <h3>
                      <Link to={`/events/${encodeURIComponent(item.eventId)}`}>
                        {item.eventName}
                      </Link>
                    </h3>
                    <p>
                      {item.participantCount}队 / 整届预计{item.expectedMatchCount}场 · 消耗1届
                    </p>
                    <p className="membership-muted">
                      首次发布 {time(item.activatedAt)}（北京时间）· 购买期 {item.periodId}
                    </p>
                  </article>
                ))}
              </div>
              {!data.allocations.length && <p>暂无已消耗赛事额度的记录。</p>}
              {data.historyTruncated.allocations && (
                <MembershipNotice tone="warning">
                  仅展示最近100条赛事记录；不能将当前显示条数当作已用总额。
                </MembershipNotice>
              )}
            </section>
          )}
          {!platform && (
            <section className="panel membership-panel">
              <div className="membership-section-heading">
                <h2>偶尔办赛，按届购买</h2>
                <Link className="button button-secondary" to="/commerce">
                  查看按届套餐
                </Link>
              </div>
              <p>
                基础、专业和商业按届建议分别99、299、599元；真实售价与额度以原按届页面的已发布套餐为准。
              </p>
            </section>
          )}
          <footer className="membership-footnote">
            <span>云直播流量、录像存储和人工服务另计</span>
            <span>会员不改变管理、审核或记分权限</span>
          </footer>
          {!data.realPaymentEnabled && (
            <MembershipNotice>
              微信在线支付尚未开通。待付订单可由平台登记线下收款后独立复核，不会以付款截图或页面跳转开通权益。
            </MembershipNotice>
          )}
        </>
      )}
      {pending && (
        <Modal
          title={
            pending.kind === 'BUY'
              ? '会员订单核对'
              : pending.kind === 'PLAN'
                ? '发布不可变会员套餐'
                : pending.kind === 'PRESET'
                  ? '确认覆盖本地会员草稿'
                  : pending.kind === 'AVAILABILITY'
                    ? '确认会员套餐上下架'
                    : pending.title
          }
          busy={action.busy}
          onClose={() => setPending(undefined)}
        >
          {pending.kind === 'BUY' ? (
            <>
              <h3>
                {pending.plan.name} v{pending.plan.version}
              </h3>
              <strong className="membership-price">{money(pending.plan.amountFen)}</strong>
              <dl className="membership-quote">
                <dt>付费机构</dt>
                <dd>{data?.organizationName ?? orgId}</dd>
                <dt>购买期</dt>
                <dd>{pending.plan.durationDays}天，续费接续上一期结束</dd>
                <dt>总额度</dt>
                <dd>{pending.plan.eventLimit}届（全期总额）</dd>
                <dt>每届上限</dt>
                <dd>
                  {pending.plan.maxTeams}队 / {pending.plan.maxMatches}场
                </dd>
                <dt>续费方式</dt>
                <dd>手动续费，不自动扣款</dd>
              </dl>
              <p>服务端将再次核对可购资格和不可变报价；创建待付订单不代表付款成功或开通。</p>
              <label className="membership-checkbox">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                我已核对付费机构、金额、购买期和额度
              </label>
            </>
          ) : pending.kind === 'PLAN' ? (
            <>
              <h3>{pending.input.name}</h3>
              <strong>{money(pending.input.amountFen)}</strong>
              <p>
                {tierLabel(pending.input.tier)} · {pending.input.durationDays}天 ·{' '}
                {membershipDraftQuota(pending.input.tier, pending.input.durationDays).eventLimit}
                届。发布后报价和条件不可修改；调整须创建新版本。
              </p>
              <p>此操作只发布目录版本，不收款或替任何机构开通会员。</p>
            </>
          ) : pending.kind === 'PRESET' ? (
            <>
              <h3>
                {pending.preset.name} · {pending.preset.price}元
              </h3>
              <p>确认后覆盖本地代码、名称、价格、等级和周期，保留发布原因；取消保留全部原输入。</p>
              <p>此操作不会发布套餐、扣费或开通会员。载入后仍须独立核对并发布。</p>
            </>
          ) : (
            <>
              {pending.kind === 'ORDER' ? (
                <>
                  <h3>{pending.order.quote.name}</h3>
                  <p>
                    {money(pending.order.quote.amountFen)} · 订单 {pending.order.id} · v
                    {pending.order.version}
                  </p>
                </>
              ) : (
                <p>
                  {pending.plan.name} v{pending.plan.version}：
                  {pending.plan.available ? '停售此版本' : '重新上架此版本'}，历史订单报价保留。
                </p>
              )}
              {needsWhy && (
                <label>
                  操作原因
                  <textarea
                    value={why}
                    minLength={4}
                    maxLength={500}
                    required
                    onChange={(e) => setWhy(e.target.value)}
                  />
                </label>
              )}
              {pending.kind === 'ORDER' &&
                ['SUBMIT_PAYMENT', 'SUBMIT_REFUND'].includes(pending.type) && (
                  <label>
                    实际线下交易引用
                    <input
                      aria-label="实际线下交易引用"
                      value={external}
                      maxLength={128}
                      onChange={(e) => setExternal(e.target.value)}
                    />
                    <small>
                      仅线下交易填写单行真实流水引用；微信退款无需填写。由另一位操作员核验，不能只凭截图。
                    </small>
                  </label>
                )}
              {pending.kind === 'ORDER' && pending.type === 'CONFIRM_REFUND' && (
                <p>
                  仅未消耗的完整购买期可全额退款；请核对原订单、资金渠道与金额。微信渠道可能实际发起原路退款。
                </p>
              )}
            </>
          )}
          <ActionNotice action={action} onReload={reload} />
          {(requiresRead || unknownResult) && (
            <MembershipNotice tone="warning">
              请先刷新核对原订单；此核对框不会自动重发请求。
            </MembershipNotice>
          )}
          <div className="membership-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={
                blocked ||
                (pending.kind === 'BUY' && !acknowledged) ||
                (needsWhy && Array.from(why.trim()).length < 4)
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
