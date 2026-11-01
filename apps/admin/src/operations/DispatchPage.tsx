import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DispatchOfferData,
  DispatchQuote,
  DispatchRequestData,
} from '@small-city-basketball/contracts';
import { createOperationsApi } from '../api/operations';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { chinaIso, commandId, fenText, reasonText, useEpoch, yuanToFen } from './shared';

const requestLabels: Record<string, string> = {
  DRAFT: '尚未发出邀请',
  INVITING: '正在分批邀请',
  PAUSED: '已暂停',
  REVIEWING: '待客户确认完整报价',
  NEEDS_MANUAL: '需要人工协调',
  SOURCE_REQUESTED: '已转真实预约，待服务方接单',
  SOURCE_CONFIRMED: '预约已确认',
  SOURCE_ENDED: '源预约已结束',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};
const offerLabels: Record<string, string> = {
  PENDING: '待服务方报价',
  TRAVEL_REVIEW: '待独立核验交通方案',
  READY: '交通已核验，待本人接单',
  ACCEPTED_HELD: '档期暂占，待客户确认',
  CONVERTED: '已转真实预约',
  DECLINED: '已拒绝',
  WITHDRAWN: '已撤回',
  EXPIRED: '已过期',
  SUPERSEDED: '本次邀请已结束',
};
const kinds = [
  ['REFEREE', '裁判'],
  ['SCORER', '计分员'],
  ['RECORDER', '记录员'],
  ['STREAMER', '直播人员'],
  ['PHOTOGRAPHER', '摄影师'],
] as const;

export function DispatchOperationsPage({ context }: { context: RegistrationWorkspace }) {
  const api = useMemo(() => createOperationsApi(context.client), [context.client]);
  const read = useCallback(() => api.dispatchWorkspace(), [api]);
  const resource = useResource(read);
  const action = useAction();
  const reads = useEpoch();
  const detailRef = useRef<{ kind: 'request' | 'offer'; id: string } | null>(null);
  const viewGen = useRef(0);
  const quoteAckRef = useRef<QuoteAck | null>(null);
  const [quoteAck, setQuoteAck] = useState<QuoteAck | null>(null);
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<DispatchRequestData | null>(null);
  const [offers, setOffers] = useState<DispatchOfferData[]>([]);
  const [offer, setOffer] = useState<DispatchOfferData | null>(null);
  const [regionQuery, setRegionQuery] = useState('');
  const [regionId, setRegionId] = useState('');
  const [catalogVersion, setCatalogVersion] = useState('');
  const [address, setAddress] = useState('');
  const [kind, setKind] = useState<(typeof kinds)[number][0]>('REFEREE');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [expiry, setExpiry] = useState('');
  const [serviceFee, setServiceFee] = useState('');
  const [travelFee, setTravelFee] = useState('');
  const [lodgingFee, setLodgingFee] = useState('');
  const [allow, setAllow] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('1');
  const [preferenceRegions, setPreferenceRegions] = useState('');
  const data = resource.data;

  function rememberQuote(next: QuoteAck | null) {
    quoteAckRef.current = next;
    setQuoteAck(next);
  }
  useEffect(() => {
    quoteAckRef.current = null;
    setQuoteAck(null);
  }, [context.userId]);
  function beginView(kind: 'request' | 'offer', id: string) {
    viewGen.current += 1;
    detailRef.current = { kind, id };
    rememberQuote(null);
    return viewGen.current;
  }
  function stillView(gen: number) {
    return viewGen.current === gen && action.isActive();
  }
  async function openRequest(id: string) {
    const gen = beginView('request', id);
    const token = reads.next();
    const detail = await api.dispatchRequest(id);
    if (viewGen.current !== gen || !reads.current(token)) return;
    setSelected(detail.request);
    setOffers(detail.offers);
    setOffer(null);
  }
  async function openOffer(id: string) {
    const gen = beginView('offer', id);
    const token = reads.next();
    const row = await api.dispatchOffer(id);
    if (viewGen.current !== gen || !reads.current(token)) return;
    setOffer(row);
    setSelected(null);
  }
  function sameDetail(kind: 'request' | 'offer', id: string) {
    return detailRef.current?.kind === kind && detailRef.current.id === id;
  }
  async function refreshRequest(id: string, gen: number) {
    if (viewGen.current !== gen) return;
    const detail = await api.dispatchRequest(id);
    if (viewGen.current !== gen || !sameDetail('request', id)) return;
    setSelected(detail.request);
    setOffers(detail.offers);
    setOffer(null);
  }
  async function refreshOffer(id: string, gen: number) {
    if (viewGen.current !== gen) return;
    const row = await api.dispatchOffer(id);
    if (viewGen.current !== gen || !sameDetail('offer', id)) return;
    setOffer(row);
    setSelected(null);
  }
  function submit(label: string, run: (gen: number) => Promise<void>) {
    const gen = viewGen.current;
    const viewed = detailRef.current;
    void action.run(async () => {
      const current = () =>
        viewGen.current === gen &&
        action.isActive() &&
        (viewed === null || sameDetail(viewed.kind, viewed.id));
      try {
        await run(gen);
      } catch (cause) {
        if (current()) throw cause;
        return false;
      }
      if (!current()) return false;
      if (viewed) resource.reloadPreserving();
      else resource.reload();
      await context.onSessionRefresh();
    }, label);
  }

  return (
    <div className="registration-page">
      <PageHeading
        eyebrow="CROSS-CITY DISPATCH"
        title="跨城调度"
        description="列表只属于当前登录账号发出的需求和收到的邀请，不是当前机构的全部派单。只有建立需求使用当前机构。付款与履约仍在原预约中办理。"
      />
      {resource.loading || resource.error || !data ? (
        <ResourceState loading={resource.loading} error={resource.error} reload={resource.reload} />
      ) : (
        <>
          <ActionNotice action={action} onReload={resource.reload} />
          {!data.capabilities.enabled && (
            <div className="registration-alert" role="status">
              <strong>跨城派单尚未开放</strong>
              <p>可以查看已有记录。新的邀请、报价和接单会由服务端拒绝。</p>
            </div>
          )}
          {data.truncated && <p>列表已达到单次上限，更早的记录请按单号打开。</p>}
          <section className="panel">
            <h2>我发出的需求</h2>
            {data.requests.length === 0 && <p>暂无跨城需求。</p>}
            <ul>
              {data.requests.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void openRequest(row.id).catch(() => resource.reload())}
                  >
                    {requestLabels[row.status] ?? row.status} · {row.serviceAddress}
                  </button>
                  <Version value={row.version} />
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>我收到的邀请</h2>
            {data.offers.length === 0 && <p>暂无跨城邀请。</p>}
            <ul>
              {data.offers.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void openOffer(row.id).catch(() => resource.reload())}
                  >
                    {row.listingTitle} · {offerLabels[row.status] ?? row.status}
                  </button>
                  <Version value={row.version} />
                </li>
              ))}
            </ul>
          </section>
          {selected && (
            <RequestPanel
              request={selected}
              offers={offers}
              reason={reason}
              setReason={setReason}
              busy={action.busy}
              enabled={data.capabilities.enabled}
              quoteAck={quoteAck}
              onQuoteAck={rememberQuote}
              viewerId={context.userId}
              onCommand={(type, extra) => {
                const requestId = selected.id;
                const version = selected.version;
                submit('需求操作已提交，请以重新读取的状态为准', async (gen) => {
                  const payload = typeof extra === 'function' ? extra() : (extra ?? {});
                  if (
                    type === 'CONFIRM_QUOTE' &&
                    !quoteStill(quoteAckRef.current, requestId, payload)
                  )
                    throw new Error('请重新核对当前报价后再确认');
                  if (!stillView(gen) || !sameDetail('request', requestId)) return;
                  await api.post(`/v1/dispatch/requests/${requestId}/commands`, {
                    commandId: commandId(),
                    expectedVersion: version,
                    type,
                    reason: reasonText(reason),
                    ...payload,
                  });
                  await refreshRequest(requestId, gen);
                });
              }}
            />
          )}
          {offer && (
            <OfferPanel
              offer={offer}
              reason={reason}
              setReason={setReason}
              busy={action.busy}
              enabled={data.capabilities.enabled}
              loadSlots={() => api.listingSlots(offer.listingId)}
              onCommand={(type, extra) => {
                const offerId = offer.id;
                const version = offer.version;
                submit('邀请操作已提交，请以重新读取的状态为准', async (gen) => {
                  const payload = typeof extra === 'function' ? extra() : extra;
                  if (!stillView(gen) || !sameDetail('offer', offerId)) return;
                  await api.post(`/v1/dispatch/offers/${offerId}/commands`, {
                    commandId: commandId(),
                    expectedVersion: version,
                    type,
                    reason: reasonText(reason),
                    ...payload,
                  });
                  await refreshOffer(offerId, gen);
                });
              }}
            />
          )}
          <section className="panel">
            <h2>接单偏好</h2>
            <p>范围只能落在已审核的人员服务覆盖内。关闭后停止新报价，已有预约仍走原单。</p>
            <label>
              每日邀请上限
              <input
                aria-label="每日邀请上限"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </label>
            <label>
              接单地区编号，用逗号分隔
              <input
                aria-label="接单地区编号"
                value={preferenceRegions}
                onChange={(e) => setPreferenceRegions(e.target.value)}
                placeholder={data.preference?.regionIds.join(',') ?? ''}
              />
            </label>
            <button
              type="button"
              disabled={action.busy || !data.capabilities.enabled}
              onClick={() =>
                submit('接单偏好已提交', async () => {
                  const ids = preferenceRegions
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean);
                  if (!ids.length) throw new Error('请至少明确选择一个接单地区');
                  await api.post('/v1/dispatch/preferences', {
                    commandId: commandId(),
                    expectedVersion: data.preference?.version ?? 0,
                    enabled: true,
                    regionIds: ids,
                    dailyLimit: Number(dailyLimit),
                  });
                })
              }
            >
              允许跨城邀请
            </button>
            <button
              type="button"
              disabled={action.busy || !data.capabilities.enabled}
              onClick={() =>
                submit('已停止新的跨城邀请', async () => {
                  const ids = (preferenceRegions || data.preference?.regionIds.join(',') || '')
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean);
                  if (!ids.length) throw new Error('请至少明确选择一个接单地区');
                  await api.post('/v1/dispatch/preferences', {
                    commandId: commandId(),
                    expectedVersion: data.preference?.version ?? 0,
                    enabled: false,
                    regionIds: ids,
                    dailyLimit: Number(dailyLimit),
                  });
                })
              }
            >
              停止跨城邀请
            </button>
          </section>
          <section className="panel">
            <h2>建立需求</h2>
            {!context.organizationId && <p>当前没有机构上下文，不能代替其他机构发单。</p>}
            <label>
              岗位
              <select
                aria-label="岗位"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                {kinds.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              搜索地区
              <input
                aria-label="搜索地区"
                value={regionQuery}
                onChange={(e) => setRegionQuery(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={action.busy || regionQuery.trim().length < 2}
              onClick={() =>
                void action.run(async () => {
                  const catalog = await api.regions();
                  const hit = catalog.regions.find((region) =>
                    region.name.includes(regionQuery.trim()),
                  );
                  if (!hit) throw new Error('地区目录中没有这个名称，请改用更完整的地名');
                  setRegionId(hit.id);
                  setCatalogVersion(catalog.catalogVersion);
                }, '已选择地区')
              }
            >
              从地区目录选择
            </button>
            {regionId && (
              <p>
                已选地区 {regionId} · 目录 {catalogVersion}
              </p>
            )}
            <label>
              服务地点
              <input
                aria-label="服务地点"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              开始（北京时间）
              <input
                aria-label="开始时间"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              结束（北京时间）
              <input
                aria-label="结束时间"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label>
              邀请截止（北京时间）
              <input
                aria-label="邀请截止"
                type="datetime-local"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </label>
            <label>
              服务费上限（元）
              <input
                aria-label="服务费上限"
                value={serviceFee}
                onChange={(e) => setServiceFee(e.target.value)}
              />
            </label>
            <label>
              交通上限（元）
              <input
                aria-label="交通上限"
                value={travelFee}
                onChange={(e) => setTravelFee(e.target.value)}
              />
            </label>
            <label>
              住宿上限（元）
              <input
                aria-label="住宿上限"
                value={lodgingFee}
                onChange={(e) => setLodgingFee(e.target.value)}
              />
            </label>
            <label>
              <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
              明确允许跨城邀请，并确认以上费用上限
            </label>
            <button
              type="button"
              disabled={action.busy || !data.capabilities.enabled || !context.organizationId}
              onClick={() =>
                submit('需求已建立，尚未开始邀请', async () => {
                  if (!context.organizationId) throw new Error('需要当前机构管理权限');
                  if (!allow) throw new Error('请明确勾选跨城邀请及费用上限');
                  if (!regionId || !catalogVersion) throw new Error('请从地区目录选择服务地区');
                  const budget = {
                    serviceMinor: yuanToFen(serviceFee),
                    travelMinor: yuanToFen(travelFee),
                    lodgingMinor: yuanToFen(lodgingFee),
                    platformMinor: 0,
                    totalMinor:
                      yuanToFen(serviceFee) + yuanToFen(travelFee) + yuanToFen(lodgingFee),
                  };
                  await api.post('/v1/dispatch/requests', {
                    commandId: commandId(),
                    orgId: context.organizationId,
                    kind,
                    people: 1,
                    serviceRegion: { catalogVersion, regionId },
                    serviceAddress: address.trim(),
                    servicePoint: null,
                    startsAt: chinaIso(start),
                    endsAt: chinaIso(end),
                    expiresAt: chinaIso(expiry),
                    budget,
                    inviteRegionIds: [regionId],
                    allowCrossCity: true,
                  });
                })
              }
            >
              建立跨城人员需求
            </button>
          </section>
        </>
      )}
    </div>
  );
}

interface QuoteAck {
  viewerId: string;
  requestId: string;
  offerId: string;
  quoteHash: string;
  offerVersion: number;
}

function quoteStill(ack: QuoteAck | null, requestId: string, payload: Record<string, unknown>) {
  return (
    !!ack &&
    ack.requestId === requestId &&
    ack.quoteHash === payload.quoteHash &&
    payload.chargeConsent === true &&
    payload.acceptedTermsId === payload.quoteHash
  );
}

function textOk(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function quoteReadyFor(row: DispatchOfferData) {
  const quote = row.quote;
  return !!(
    quote &&
    row.quoteHash &&
    quote.hash === row.quoteHash &&
    [
      quote.serviceMinor,
      quote.travelMinor,
      quote.lodgingMinor,
      quote.platformMinor,
      quote.totalMinor,
    ].every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
    textOk(quote.terms) &&
    textOk(quote.travelMethod) &&
    textOk(quote.travelEvidence) &&
    textOk(quote.departureAt) &&
    textOk(quote.arrivalAt) &&
    textOk(quote.returnAt)
  );
}

function QuoteFacts({ quote, quoteHash }: { quote: DispatchQuote; quoteHash: string }) {
  return (
    <div>
      <p>当前实际报价 {fenText(quote.totalMinor)}</p>
      <p>
        服务 {fenText(quote.serviceMinor)} · 交通 {fenText(quote.travelMinor)} · 住宿{' '}
        {fenText(quote.lodgingMinor)} · 平台 {fenText(quote.platformMinor)}
      </p>
      <p>
        出发 {quote.departureAt} · 报到 {quote.arrivalAt} · 返回 {quote.returnAt}
      </p>
      <p>
        交通方式 {quote.travelMethod} · 凭据 {quote.travelEvidence}
      </p>
      <p>服务约定：{quote.terms}</p>
      <p>报价版本 {quoteHash}</p>
    </div>
  );
}

function RequestPanel({
  request,
  offers,
  reason,
  setReason,
  busy,
  enabled,
  viewerId,
  quoteAck,
  onQuoteAck,
  onCommand,
}: {
  request: DispatchRequestData;
  offers: DispatchOfferData[];
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  enabled: boolean;
  viewerId: string;
  quoteAck: QuoteAck | null;
  onQuoteAck: (next: QuoteAck | null) => void;
  onCommand: (
    type: string,
    extra?: Record<string, unknown> | (() => Record<string, unknown>),
  ) => void;
}) {
  const winner = offers.find((row) => row.id === request.winnerOfferId);
  const quoteReady = !!winner && quoteReadyFor(winner);
  const ackReady =
    !!winner &&
    quoteReady &&
    !!quoteAck &&
    quoteAck.viewerId === viewerId &&
    quoteAck.requestId === request.id &&
    quoteAck.offerId === winner.id &&
    quoteAck.quoteHash === winner.quoteHash &&
    quoteAck.offerVersion === winner.version;
  return (
    <section className="panel" aria-label="需求详情">
      <h2>
        {requestLabels[request.status] ?? request.status} <Version value={request.version} />
      </h2>
      <p>
        {request.serviceAddress} · {request.startsAt} 至 {request.endsAt}
      </p>
      <p>
        需求预算 {fenText(request.budget.totalMinor)}。这是邀请时的费用上限，不是服务方的实际报价。
      </p>
      <p>
        预算构成：服务 {fenText(request.budget.serviceMinor)} · 交通{' '}
        {fenText(request.budget.travelMinor)} · 住宿 {fenText(request.budget.lodgingMinor)} · 平台{' '}
        {fenText(request.budget.platformMinor)}
      </p>
      {offers.map((row) => (
        <article key={row.id} aria-label={`${row.listingTitle}的报价`}>
          <h3>
            {row.listingTitle}
            {row.id === request.winnerOfferId ? ' · 当前待确认服务方' : ''}
          </h3>
          {row.quote && row.quoteHash ? (
            <QuoteFacts quote={row.quote} quoteHash={row.quoteHash} />
          ) : (
            <p>尚未提交可核对的报价。</p>
          )}
        </article>
      ))}
      <label>
        操作说明
        <textarea
          aria-label="需求操作说明"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {request.canManage && request.status === 'DRAFT' && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('START')}>
          开始分批邀请
        </button>
      )}
      {request.canManage && request.status === 'PAUSED' && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('RESUME')}>
          恢复邀请
        </button>
      )}
      {request.canManage && request.status === 'INVITING' && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('PAUSE')}>
          暂停邀请
        </button>
      )}
      {request.canManage && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('CANCEL')}>
          取消需求
        </button>
      )}
      {request.canConfirm && (
        <label>
          <input
            type="checkbox"
            aria-label="同意当前报价"
            checked={ackReady}
            disabled={busy || !enabled || !quoteReady}
            onChange={(event) => {
              if (!event.target.checked || !winner || !quoteReady || !winner.quoteHash) {
                onQuoteAck(null);
                return;
              }
              onQuoteAck({
                viewerId,
                requestId: request.id,
                offerId: winner.id,
                quoteHash: winner.quoteHash,
                offerVersion: winner.version,
              });
            }}
          />
          已核对当前服务、交通、住宿、平台费用及完整条款，同意本次报价
        </label>
      )}
      {request.canConfirm && !quoteReady && <p role="alert">当前报价不完整，不能确认预约。</p>}
      {request.canConfirm && winner?.quoteHash && (
        <button
          type="button"
          disabled={busy || !enabled || !ackReady}
          onClick={() => {
            if (!ackReady || !winner.quoteHash) return;
            onCommand('CONFIRM_QUOTE', () => ({
              quoteHash: winner.quoteHash,
              acceptedTermsId: winner.quoteHash,
              chargeConsent: true,
            }));
          }}
        >
          确认当前报价并创建真实预约
        </button>
      )}
      {request.canConfirm && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('REJECT_QUOTE')}>
          拒绝本次报价
        </button>
      )}
    </section>
  );
}

function OfferPanel({
  offer,
  reason,
  setReason,
  busy,
  enabled,
  loadSlots,
  onCommand,
}: {
  offer: DispatchOfferData;
  reason: string;
  setReason: (value: string) => void;
  busy: boolean;
  enabled: boolean;
  loadSlots: () => Promise<
    { id: string; startsAt?: string; endsAt?: string; available: boolean }[]
  >;
  onCommand: (
    type: string,
    extra?: Record<string, unknown> | (() => Record<string, unknown>),
  ) => void;
}) {
  const [slotId, setSlotId] = useState('');
  const [service, setService] = useState('');
  const [travel, setTravel] = useState('');
  const [lodging, setLodging] = useState('');
  const [method, setMethod] = useState('');
  const [evidence, setEvidence] = useState('');
  const [terms, setTerms] = useState('');
  const [departure, setDeparture] = useState('');
  const [arrival, setArrival] = useState('');
  const [back, setBack] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    setChecked(false);
  }, [offer.id, offer.quoteHash, offer.version]);
  const travelReady = quoteReadyFor(offer);
  return (
    <section className="panel" aria-label="邀请详情">
      <h2>
        {offer.listingTitle} · {offerLabels[offer.status] ?? offer.status}{' '}
        <Version value={offer.version} />
      </h2>
      <p>
        {offer.request.serviceAddress} · {offer.request.startsAt} 至 {offer.request.endsAt}
      </p>
      <p>需求预算 {fenText(offer.request.budget.totalMinor)}，不是本条实际报价。</p>
      {offer.quote && offer.quoteHash ? (
        <QuoteFacts quote={offer.quote} quoteHash={offer.quoteHash} />
      ) : (
        <p>尚未提交可核对的报价。</p>
      )}
      <label>
        操作说明
        <textarea
          aria-label="邀请操作说明"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {offer.canQuote && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void loadSlots().then((slots) => {
                const match = slots.find(
                  (slot) =>
                    slot.available &&
                    slot.startsAt === offer.request.startsAt &&
                    slot.endsAt === offer.request.endsAt,
                );
                setSlotId(match?.id ?? '');
                if (!match) setReason(reason);
              })
            }
          >
            读取覆盖该时段的档期
          </button>
          {slotId && <p>可用档期 {slotId}</p>}
          <input
            aria-label="服务费"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="服务费（元）"
          />
          <input
            aria-label="交通费"
            value={travel}
            onChange={(e) => setTravel(e.target.value)}
            placeholder="交通费（元）"
          />
          <input
            aria-label="住宿费"
            value={lodging}
            onChange={(e) => setLodging(e.target.value)}
            placeholder="住宿费（元）"
          />
          <input
            aria-label="出发时间"
            type="datetime-local"
            value={departure}
            onChange={(e) => setDeparture(e.target.value)}
          />
          <input
            aria-label="到达时间"
            type="datetime-local"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
          />
          <input
            aria-label="返回时间"
            type="datetime-local"
            value={back}
            onChange={(e) => setBack(e.target.value)}
          />
          <input
            aria-label="交通方式"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="交通方式"
          />
          <textarea
            aria-label="核验证据"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="核验证据"
          />
          <textarea
            aria-label="服务约定"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="服务约定"
          />
          <button
            type="button"
            disabled={busy || !enabled}
            onClick={() =>
              onCommand('SUBMIT_QUOTE', () => {
                if (!slotId) throw new Error('没有完全覆盖服务时间的有效档期');
                const serviceMinor = yuanToFen(service);
                const travelMinor = yuanToFen(travel);
                const lodgingMinor = yuanToFen(lodging);
                return {
                  quote: {
                    slotId,
                    serviceMinor,
                    travelMinor,
                    lodgingMinor,
                    platformMinor: 0,
                    totalMinor: serviceMinor + travelMinor + lodgingMinor,
                    departureAt: chinaIso(departure),
                    arrivalAt: chinaIso(arrival),
                    returnAt: chinaIso(back),
                    travelMethod: method.trim(),
                    travelEvidence: evidence.trim(),
                    terms: terms.trim(),
                  },
                };
              })
            }
          >
            提交不可修改的完整报价
          </button>
        </>
      )}
      {offer.canReviewTravel && !travelReady && (
        <p role="alert">行程或凭据不完整，不能记录核验结论。</p>
      )}
      {offer.canReviewTravel && (
        <label>
          <input
            type="checkbox"
            aria-label="已核对行程凭据"
            checked={checked}
            disabled={!travelReady}
            onChange={(e) => setChecked(e.target.checked)}
          />
          已通过真实凭据核对完整行程可行，报到早于服务开始，返回与休息保护充分
        </label>
      )}
      {offer.canReviewTravel && (
        <button
          type="button"
          disabled={busy || !enabled || !checked || !travelReady || !offer.quoteHash}
          onClick={() => {
            if (!checked || !travelReady || !offer.quoteHash) return;
            onCommand('VERIFY_TRAVEL', { quoteHash: offer.quoteHash, evidenceChecked: true });
          }}
        >
          记录独立核验结论
        </button>
      )}
      {offer.canAccept && (
        <button
          type="button"
          disabled={busy || !enabled || !offer.quoteHash}
          onClick={() => onCommand('ACCEPT', { quoteHash: offer.quoteHash })}
        >
          本人接单并暂占差旅档期
        </button>
      )}
      {offer.canWithdraw && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('WITHDRAW')}>
          撤回本次接单
        </button>
      )}
      {offer.status === 'PENDING' && (
        <button type="button" disabled={busy || !enabled} onClick={() => onCommand('DECLINE')}>
          拒绝服务邀请
        </button>
      )}
    </section>
  );
}
