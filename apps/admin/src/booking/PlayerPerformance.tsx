import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { BookingPlayerData, BookingWorkspaceData } from './model';
import { commandId, fee, localTime, money, positionLabels } from './model';
import type {
  PlayerPerformanceData,
  PlayerPerformanceLinkData,
  PlayerPerformanceRepository,
  PlayerPerformanceWorkspaceData,
} from './performance-model';
import { metric, unavailablePerformanceRepository } from './performance-model';
import { useAction, useResource } from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import './performance.css';
type PerformanceContextData = {
  repository: PlayerPerformanceRepository;
  viewerUserId: string;
  demo: boolean;
  revision: number;
  invalidate: () => void;
};
const Context = createContext<PerformanceContextData>({
  repository: unavailablePerformanceRepository,
  viewerUserId: '',
  demo: false,
  revision: 0,
  invalidate: () => {},
});
export function PerformanceProvider({
  repository,
  viewerUserId,
  demo,
  children,
}: {
  repository: PlayerPerformanceRepository;
  viewerUserId: string;
  demo: boolean;
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const value = useMemo(
    () => ({
      repository,
      viewerUserId,
      demo,
      revision,
      invalidate: () => setRevision((n) => n + 1),
    }),
    [repository, viewerUserId, demo, revision],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePerformanceData(ids: string[]) {
  const { repository, viewerUserId, revision } = useContext(Context);
  const key = Array.from(new Set(ids)).sort().join(',');
  const read = useCallback(async () => {
    const profiles = key ? key.split(',') : [],
      result: Record<string, PlayerPerformanceData> = {};
    if (profiles.length > 20) throw new Error('每页最多展示20名球员，请翻页读取。');
    if (profiles.length) {
      const response = await repository.performances(profiles);
      for (const player of response.players) result[player.profileId] = player;
    }
    return result;
  }, [repository, viewerUserId, revision, key]);
  return useResource(read);
}
const formatLabels: Record<string, string> = {
  ROUND_ROBIN: '单循环',
  SINGLE_ELIMINATION: '单淘汰',
  GROUP_KNOCKOUT: '分组接淘汰',
};
const statusLabels: Record<string, string> = {
  NO_AUTHORIZED_SOURCE: '暂无授权来源',
  NO_PERSONAL_STATS: '尚无个人统计',
  AVAILABLE: '已有个人记录',
  PARTIAL: '部分个人记录',
};
export function PerformanceCardSummary({
  data,
  loading,
  error,
  demo,
}: {
  data?: PlayerPerformanceData;
  loading: boolean;
  error: string;
  demo: boolean;
}) {
  if (loading) return <div className="pf-card-status">正在读取授权记录…</div>;
  if (error || !data) return <div className="pf-card-status">统计暂不可读取</div>;
  return (
    <div className="pf-card-summary">
      <div className="pf-card-heading">
        <span>
          <Database size={12} />
          {demo ? '合成统计演示' : '已授权统计'}
        </span>
        <small>统计 {data.recordedMatchCount} 场</small>
      </div>
      <div className="pf-card-metrics">
        <div>
          <strong>{metric(data.pointsPerRecordedMatch)}</strong>
          <small>每场记录得分</small>
        </div>
        <div>
          <strong>{metric(data.foulsPerRecordedMatch)}</strong>
          <small>每场记录犯规</small>
        </div>
        <div>
          <strong>{data.completedServiceCount}</strong>
          <small>完成服务记录</small>
        </div>
      </div>
      {data.recordedMatchCount === 0 && <p>未统计不代表能力为0</p>}
    </div>
  );
}
export function PlayerPerformanceDetails({ profileId }: { profileId: string }) {
  const { demo } = useContext(Context);
  const state = usePerformanceData([profileId]),
    data = state.data?.[profileId];
  return (
    <section className="bk-panel pf-details">
      <div className="bk-section-head">
        <div>
          <span className="bk-eyebrow">AUTHORIZED MATCH RECORDS</span>
          <h2>已授权比赛记录</h2>
        </div>
        <button type="button" className="bk-button bk-outline bk-small" onClick={state.reload}>
          <RefreshCw size={15} />
          刷新记录
        </button>
      </div>
      {demo && <p className="pf-demo-note">合成统计演示，用于展示功能，不是真实球员表现。</p>}
      {state.loading ? (
        <p role="status" className="bk-muted">
          正在核对当前授权和有效独立确认…
        </p>
      ) : state.error ? (
        <div className="bk-error" role="alert">
          {state.error} 未以演示或0值替代。
        </div>
      ) : data ? (
        <>
          <div className="pf-data-header">
            <span className={`pf-status pf-status-${data.dataStatus.toLowerCase()}`}>
              {statusLabels[data.dataStatus]}
            </span>
            <span>
              {data.sourceCount} 个授权来源 · 数据更新 {localTime(data.asOf)}
            </span>
          </div>
          <div className="pf-stat-grid">
            <div>
              <strong>
                {data.recordedMatchCount}
                <small>场</small>
              </strong>
              <span>个人统计场次</span>
            </div>
            <div>
              <strong>{metric(data.pointsPerRecordedMatch)}</strong>
              <span>每场记录得分</span>
            </div>
            <div>
              <strong>{metric(data.foulsPerRecordedMatch)}</strong>
              <span>每场记录犯规</span>
            </div>
            <div>
              <strong>
                {data.completedServiceCount}
                <small>场</small>
              </strong>
              <span>完成服务记录 · 非付费成交</span>
            </div>
          </div>
          <p className="pf-denominator">
            <Info size={16} />
            {data.denominatorNotice}
          </p>
          <div className="pf-completeness">
            <h3>数据完整度</h3>
            <div>
              <span>
                已确认名单记录 <strong>{data.confirmedMatchCount}</strong>
              </span>
              <span>
                其中个人统计 <strong>{data.recordedMatchCount}</strong>
              </span>
              <span>
                仅球队数据 <strong>{data.teamOnlyMatchCount}</strong>
              </span>
              <span>
                个人归属未完整 <strong>{data.partialAttributionMatchCount}</strong>
              </span>
              <span>
                待确认 <strong>{data.pendingMatchCount}</strong>
              </span>
              <span>
                失效 / 待重确认 <strong>{data.invalidMatchCount}</strong>
              </span>
            </div>
            <p>{data.completenessNotice}</p>
            {data.truncated && (
              <p>当前为最新最多 {data.sampleLimit} 场的有限样本，较早记录未计入。</p>
            )}
          </div>
          <div className="pf-missing-metrics">
            <strong>尚未采集</strong>
            <span>助攻：未统计</span>
            <span>篮板：未统计</span>
            <span>上场时间：未统计</span>
            <span>投篮命中率：未统计</span>
          </div>
          <h3 className="pf-recent-title">最近5条有效确认记录</h3>
          {data.recentRecords.length ? (
            <div className="pf-recent-table-wrap">
              <table className="pf-recent-table">
                <thead>
                  <tr>
                    <th>赛事 / 日期</th>
                    <th>赛制</th>
                    <th>记录得分</th>
                    <th>记录犯规</th>
                    <th>来源口径</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRecords.map((r) => (
                    <tr key={r.recordKey}>
                      <td>
                        <strong>{r.eventName}</strong>
                        <small>{r.date.slice(0, 10)}</small>
                      </td>
                      <td>{formatLabels[r.format] ?? r.format}</td>
                      <td>{metric(r.points, 0)}</td>
                      <td>{metric(r.fouls, 0)}</td>
                      <td>
                        <span className="pf-record-source">
                          <CheckCircle2 size={12} />
                          有效独立确认
                        </span>
                        <small>
                          {r.collectionMode === 'PLAYER_BASIC'
                            ? 'PLAYER_BASIC · 名单记录'
                            : 'TEAM_ONLY · 仅球队数据'}
                        </small>
                        {r.attributionComplete === false && (
                          <small className="pf-attribution-warning">本队个人归属未完整</small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pf-no-stats">
              <Database size={24} />
              <h3>暂无可展示的个人比赛记录</h3>
              <p>需由主办方提名、球员本人同意公开，并有当前有效确认记录。没有数据不等于0分。</p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
export function PlayerComparison({ bookingData }: { bookingData: BookingWorkspaceData }) {
  const location = useLocation(),
    { demo } = useContext(Context);
  const ids = Array.from(
    new Set((new URLSearchParams(location.search).get('ids') ?? '').split(',').filter(Boolean)),
  );
  const players = ids
    .map((id) => bookingData.players.find((p) => p.id === id))
    .filter((p): p is BookingPlayerData => !!p);
  const valid = ids.length >= 2 && ids.length <= 3 && players.length === ids.length;
  const state = usePerformanceData(valid ? ids : []);
  if (!valid)
    return (
      <section className="bk-empty">
        <BarChart3 size={32} />
        <h1>请选择2至3名可查看的球员</h1>
        <p>从球员广场加入对比。已停用或不可查看的球员不能继续比较。</p>
        <Link className="bk-button bk-primary" to="/players">
          返回球员广场
        </Link>
      </section>
    );
  const metricRows: {
    label: string;
    value: (p: BookingPlayerData, s?: PlayerPerformanceData) => ReactNode;
  }[] = [
    {
      label: '参赛服务报价',
      value: (p) => (
        <strong className="pf-compare-price">
          {money(p.priceFen)}
          <small>/ 场或约定时段</small>
        </strong>
      ),
    },
    {
      label: `当前平台费（${bookingData.settings.feeBps / 100}%）`,
      value: (p) => money(fee(p.priceFen, bookingData.settings.feeBps)),
    },
    {
      label: '预计合计（含平台与交通食宿）',
      value: (p) => (
        <strong>
          {money(
            p.priceFen +
              fee(p.priceFen, bookingData.settings.feeBps) +
              p.travelFen +
              p.accommodationFen,
          )}
        </strong>
      ),
    },
    {
      label: '交通 / 食宿报价',
      value: (p) => (
        <span>
          {money(p.travelFen)} / {money(p.accommodationFen)}
        </span>
      ),
    },
    {
      label: '主打位置 / 身高',
      value: (p) => (
        <span>
          {positionLabels[p.position]} / {p.heightCm}cm
        </span>
      ),
    },
    {
      label: '完成服务记录',
      value: (_p, s) => (s ? `${s.completedServiceCount}场` : '暂不可读取'),
    },
    { label: '个人统计场次', value: (_p, s) => (s ? `${s.recordedMatchCount}场` : '暂不可读取') },
    {
      label: '每场记录得分',
      value: (_p, s) => (s ? metric(s.pointsPerRecordedMatch) : '暂不可读取'),
    },
    {
      label: '每场记录犯规',
      value: (_p, s) => (s ? metric(s.foulsPerRecordedMatch) : '暂不可读取'),
    },
    {
      label: '数据完整度',
      value: (_p, s) =>
        s ? (
          <span>
            {statusLabels[s.dataStatus]}
            <small>
              已确认{s.confirmedMatchCount}场 / 个人统计{s.recordedMatchCount}场 / 仅球队
              {s.teamOnlyMatchCount}场
            </small>
            {s.truncated && <small>最新最多{s.sampleLimit}场样本</small>}
          </span>
        ) : (
          '暂不可读取'
        ),
    },
    {
      label: '授权来源',
      value: (_p, s) =>
        s ? (
          <span>
            {s.sourceCount}个授权来源
            <small>
              {Array.from(new Set(s.recentRecords.map((r) => r.eventName))).join('、') ||
                '暂无可公开的比赛来源'}
            </small>
          </span>
        ) : (
          '暂不可读取'
        ),
    },
    {
      label: '最近5条记录',
      value: (_p, s) =>
        s?.recentRecords.length ? (
          <ul className="pf-compare-recent">
            {s.recentRecords.map((r) => (
              <li key={r.recordKey}>
                <span>
                  {r.date.slice(5, 10)} · {r.eventName}
                </span>
                <strong>
                  得分 {metric(r.points, 0)} / 犯规 {metric(r.fouls, 0)}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <span className="pf-missing">暂无可展示记录</span>
        ),
    },
    {
      label: '球员自述打法',
      value: (p) => (
        <span>
          {p.bio}
          <small>球员本人填写，不是平台能力结论</small>
        </span>
      ),
    },
    {
      label: '其他表现指标',
      value: () => <span className="pf-missing">助攻、篮板、上场时间、投篮命中率：均未统计</span>,
    },
  ];
  return (
    <>
      <Link className="bk-back" to="/players">
        ← 返回球员广场
      </Link>
      <div className="bk-heading">
        <div>
          <span className="bk-eyebrow">COMPARE WITH CONTEXT</span>
          <h1>同价，也要看记录与适配</h1>
          <p>最多3人并排比较。数据是有限的名单统计样本，选择适合球队角色的队友。</p>
        </div>
        <button className="bk-button bk-outline" onClick={state.reload}>
          <RefreshCw size={16} />
          刷新对比数据
        </button>
      </div>
      {demo && <p className="pf-demo-note">当前为合成球员和统计演示，不用于判断真实球员实力。</p>}
      <p className="pf-denominator">
        <Info size={16} />
        “每场记录”以已授权PLAYER_BASIC名单统计场次为分母，包含真实0值；不是按实际出场时间计算。不同样本数不可直接当成能力排名。
      </p>
      {state.error && (
        <p role="alert" className="bk-error">
          {state.error} 已停止展示旧统计，没有用0替代。
        </p>
      )}
      {state.loading && (
        <p role="status" className="bk-muted">
          正在核对授权统计…
        </p>
      )}
      <div className="pf-compare-scroll" role="region" aria-label="球员并排对比数据" tabIndex={0}>
        <table className="pf-compare-table">
          <thead>
            <tr>
              <th>比较项目</th>
              {players.map((p) => (
                <th key={p.id}>
                  <div className="pf-compare-avatar">{p.displayName.slice(0, 1)}</div>
                  <Link to={`/players/${encodeURIComponent(p.id)}`}>{p.displayName}</Link>
                  <small>
                    {positionLabels[p.position]} · {p.city}
                  </small>
                  <Link
                    className="bk-button bk-primary bk-small"
                    to={`/player-bookings/new?playerId=${encodeURIComponent(p.id)}`}
                  >
                    预约这位球员
                    <ArrowRight size={12} />
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {players.map((p) => (
                  <td key={p.id}>{row.value(p, state.data?.[p.id])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pf-scroll-hint">手机上可左右滑动查看全部球员。没有统计样本，不代表能力较差。</p>
    </>
  );
}
const linkStatus: Record<string, string> = {
  PENDING: '等待球员本人同意',
  APPROVED: '已同意公开',
  REVOKED: '已拒绝 / 撤销',
};
export function DataAuthorizations({
  bookingData,
  ownOnly = false,
}: {
  bookingData: BookingWorkspaceData;
  ownOnly?: boolean;
}) {
  const context = useContext(Context);
  const { repository, viewerUserId, revision, demo } = context;
  const read = useCallback(async () => {
    const value = await repository.workspace();
    if (value.viewerUserId !== viewerUserId) throw new Error('数据授权身份已变化，请重新读取。');
    return value;
  }, [repository, viewerUserId, revision]);
  const resource = useResource(read);
  const data = resource.data?.viewerUserId === viewerUserId ? resource.data : undefined;
  const [pending, setPending] = useState<{
      link: PlayerPerformanceLinkData;
      type: 'CONSENT' | 'REVOKE';
      commandId: string;
      viewerUserId: string;
    } | null>(null),
    [draft, setDraft] = useState(false);
  useEffect(() => {
    setPending(null);
    setDraft(false);
  }, [viewerUserId]);
  const links = data?.links.filter((l) => !ownOnly || l.profileId === data.ownProfileId) ?? [];
  return (
    <section className="bk-panel pf-authorizations">
      <div className="bk-section-head">
        <div>
          <span className="bk-eyebrow">CONSENTED DATA SHARING</span>
          <h2>{ownOnly ? '我的比赛数据授权' : '比赛数据授权与提名'}</h2>
        </div>
        <button
          className="bk-button bk-outline bk-small"
          disabled={Boolean(pending) || draft}
          onClick={resource.reload}
        >
          <RefreshCw size={15} />
          刷新数据授权
        </button>
      </div>
      {demo && <p className="pf-demo-note">合成授权演示，不关联真实赛事或个人。</p>}
      {resource.loading || Boolean(resource.data && !data) ? (
        <p role="status" className="bk-muted">
          正在读取本人及当前有权赛事的数据授权…
        </p>
      ) : resource.error ? (
        <p role="alert" className="bk-error">
          {resource.error}
        </p>
      ) : data ? (
        <>
          <p className="pf-denominator">
            <ShieldCheck size={16} />
            {data.disclosureNotice}
          </p>
          {!ownOnly &&
            (data.manageableEvents.length ? (
              <SourceNomination
                key={viewerUserId}
                data={data}
                players={bookingData.players}
                onDirty={setDraft}
                onDone={() => {
                  setDraft(false);
                  resource.reload();
                  context.invalidate();
                }}
              />
            ) : (
              <p className="bk-muted">
                当前没有可管理数据授权的赛事。机构身份或平台运营身份不会自动获得主办方发布权。
              </p>
            ))}
          {ownOnly && !data.ownProfileId ? (
            <p className="bk-muted">先建立本人球员档案，主办方才能向你的档案提名参赛记录。</p>
          ) : null}
          {data.linksHasMore && (
            <p className="bk-muted">当前展示最近一批授权记录，更早记录未列出。</p>
          )}
          {links.length ? (
            <div className="pf-link-list">
              {links.map((l) => (
                <article className="pf-link-card" key={l.id}>
                  <div className="pf-link-head">
                    <h3>{l.eventName}</h3>
                    <span className={`pf-status pf-link-${l.status.toLowerCase()}`}>
                      {linkStatus[l.status]}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>赛事名单成员</dt>
                      <dd>
                        {l.teamName} · {l.memberName}
                      </dd>
                    </div>
                    <div>
                      <dt>关联球员档案</dt>
                      <dd>{l.profileName}</dd>
                    </div>
                  </dl>
                  <p>{l.reason}</p>
                  {l.status === 'APPROVED' && !l.sourceCurrentlyAvailable && (
                    <p className="pf-source-unavailable">
                      当前来源不可展示；可能尚无有效确认、授权条件变化或原确认已失效。
                    </p>
                  )}
                  <div className="pf-link-actions">
                    {l.capabilities.canConsent && (
                      <button
                        className="bk-button bk-primary bk-small"
                        onClick={() =>
                          setPending({
                            link: l,
                            type: 'CONSENT',
                            commandId: commandId(),
                            viewerUserId,
                          })
                        }
                      >
                        核对本人记录并同意公开
                      </button>
                    )}
                    {l.capabilities.canRevoke && (
                      <button
                        className="bk-button bk-outline bk-small"
                        onClick={() =>
                          setPending({
                            link: l,
                            type: 'REVOKE',
                            commandId: commandId(),
                            viewerUserId,
                          })
                        }
                      >
                        {l.status === 'PENDING' ? '拒绝本次公开' : '撤销公开授权'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="pf-no-stats">
              <ClipboardCheck size={25} />
              <h3>暂无数据授权记录</h3>
              <p>主办方提名后，由球员本人核对并选择是否公开。不会按姓名自动匹配身份。</p>
            </div>
          )}
        </>
      ) : null}
      {pending && pending.viewerUserId === viewerUserId && (
        <ConsentDialog
          key={`${viewerUserId}:${pending.link.id}`}
          pending={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            resource.reload();
            context.invalidate();
          }}
        />
      )}
    </section>
  );
}
function SourceNomination({
  data,
  players,
  onDirty,
  onDone,
}: {
  data: PlayerPerformanceWorkspaceData;
  players: BookingPlayerData[];
  onDirty: (v: boolean) => void;
  onDone: () => void;
}) {
  const { repository, viewerUserId, revision } = useContext(Context);
  const [eventId, setEventId] = useState(data.manageableEvents[0]?.id ?? ''),
    [memberKey, setMemberKey] = useState(''),
    [profileId, setProfileId] = useState(''),
    [reason, setReason] = useState(''),
    [consent, setConsent] = useState(false),
    [validation, setValidation] = useState('');
  const selected = data.manageableEvents.find((e) => e.id === eventId);
  const read = useCallback(
    () => (selected ? repository.sources(selected.orgId, selected.id) : Promise.resolve(null)),
    [repository, selected?.id, selected?.orgId, viewerUserId, revision],
  );
  const source = useResource(read);
  const action = useAction(),
    id = useRef(commandId());
  useEffect(() => {
    onDirty(Boolean(memberKey || profileId || reason || consent));
  }, [memberKey, profileId, reason, consent, onDirty]);
  useEffect(() => {
    setMemberKey('');
  }, [eventId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    if (!selected || !source.data) {
      setValidation('请先选择当前有权管理的赛事并读取固定名单。');
      return;
    }
    const [teamId, memberId] = memberKey.split(':');
    if (!teamId || !memberId || !profileId || reason.trim().length < 2 || !consent) {
      setValidation('请核对名单成员、目标球员、原因，并明确同意提供这份赛事数据。');
      return;
    }
    await action.run(async () => {
      await repository.nominate({
        commandId: id.current,
        orgId: selected.orgId,
        eventId: selected.id,
        teamId,
        memberId,
        profileId,
        reason: reason.trim(),
        publisherConsent: true,
      });
      id.current = commandId();
      setConsent(false);
      setReason('');
      setMemberKey('');
      setProfileId('');
      onDone();
    }, '提名已提交，等待球员本人同意');
  }
  return (
    <form className="pf-nomination" onSubmit={(e) => void submit(e)}>
      <div className="pf-nomination-heading">
        <Database size={20} />
        <div>
          <h3>主办方提名本人参赛记录</h3>
          <p>仅当前有数据管理权的赛事可提名；不会授予球员原私有赛事接口权限。</p>
        </div>
      </div>
      <div className="bk-form-grid">
        <label>
          有权管理的赛事
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {data.manageableEvents.map((e) => (
              <option value={e.id} key={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          固定报名名单成员
          <select
            required
            value={memberKey}
            disabled={source.loading || !!source.error}
            onChange={(e) => setMemberKey(e.target.value)}
          >
            <option value="">请选择明确的球队与成员</option>
            {source.data?.teams.map((t) => (
              <optgroup label={t.name} key={t.id}>
                {t.members.map((m) => (
                  <option value={`${t.id}:${m.id}`} key={m.id}>
                    {t.name} · {m.name} · {m.jerseyNo}号
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="bk-span-2">
          提名到球员档案
          <select required value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">请核对本人身份后选择</option>
            {players.map((p) => (
              <option value={p.id} key={p.id}>
                {p.displayName} · {positionLabels[p.position]} · {p.city}
              </option>
            ))}
          </select>
        </label>
        <label className="bk-span-2">
          提名依据与原因
          <textarea
            required
            minLength={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="说明已如何核对名单成员与球员身份，不填写身份证或私密资料"
          />
        </label>
      </div>
      {source.loading && (
        <p role="status" className="bk-muted">
          正在读取本赛事固定报名名单…
        </p>
      )}
      {source.error && (
        <p role="alert" className="bk-error">
          {source.error}
        </p>
      )}
      <label className="bk-inline-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        我确认有权提供该赛事成员的有限统计，并已核对提名对象；还需球员本人同意公开
      </label>
      {(validation || action.error) && (
        <p role="alert" className="bk-error">
          {validation || action.error}
        </p>
      )}
      {action.success && (
        <p role="status" className="bk-muted">
          {action.success}
        </p>
      )}
      <button
        className="bk-button bk-primary"
        disabled={action.busy || source.loading || !!source.error}
        type="submit"
      >
        {action.busy ? '正在提交…' : '提名给球员本人确认'}
      </button>
    </form>
  );
}
function ConsentDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: { link: PlayerPerformanceLinkData; type: 'CONSENT' | 'REVOKE'; commandId: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { repository } = useContext(Context);
  const [consent, setConsent] = useState(false),
    [reason, setReason] = useState(''),
    [validation, setValidation] = useState('');
  const action = useAction();
  const l = pending.link;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    if (reason.trim().length < 2 || (pending.type === 'CONSENT' && !consent)) {
      setValidation('请填写至少2个字符的原因，并在同意公开时明确确认本人身份与公开范围。');
      return;
    }
    await action.run(async () => {
      await repository.command(l.id, {
        commandId: pending.commandId,
        expectedVersion: l.version,
        type: pending.type,
        reason: reason.trim(),
        ...(pending.type === 'CONSENT' ? { playerConsent: true as const } : {}),
      });
      onDone();
    });
  }
  return (
    <Modal
      title={
        pending.type === 'CONSENT'
          ? '核对并同意公开本人记录'
          : l.status === 'PENDING'
            ? '拒绝本次公开'
            : '撤销公开授权'
      }
      busy={action.busy}
      onClose={onClose}
    >
      <form className="bk-dialog-form" onSubmit={(e) => void submit(e)}>
        <p>
          <strong>
            {l.eventName} · {l.teamName}
          </strong>
        </p>
        <p>
          固定名单成员：{l.memberName} → 球员档案：{l.profileName}
        </p>
        <p className="pf-denominator">
          <Info size={16} />
          只公开该成员的有限赛事名称、日期、得分与犯规记录、样本口径和完整度；不公开其他球员名单、身份证、联系方式或私有接口。
        </p>
        {pending.type === 'CONSENT' && (
          <label className="bk-inline-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            我确认这是本人的参赛记录，并同意按上述有限范围公开展示
          </label>
        )}
        {pending.type === 'REVOKE' && (
          <p className="bk-muted">
            撤销后下次读取不再展示该来源，既有缓存页面需要刷新。重新公开需要主办方重新提名和本人再次同意。
          </p>
        )}
        <label>
          处理原因
          <textarea
            required
            minLength={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {(validation || action.error) && (
          <p role="alert" className="bk-error">
            {validation || action.error}
          </p>
        )}
        <div className="bk-dialog-actions">
          <button
            className="bk-button bk-outline"
            type="button"
            onClick={onClose}
            disabled={action.busy}
          >
            返回
          </button>
          <button className="bk-button bk-primary" type="submit" disabled={action.busy}>
            {action.busy ? '正在处理…' : '确认处理'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PlayerDataPage({ bookingData }: { bookingData: BookingWorkspaceData }) {
  return (
    <>
      <div className="bk-heading">
        <div>
          <span className="bk-eyebrow">CONTROL YOUR RECORDS</span>
          <h1>数据从哪里来，由双方说清楚</h1>
          <p>主办方准确提名，球员本人选择公开。未经双边授权的私有数据不会出现在球员广场。</p>
        </div>
      </div>
      <DataAuthorizations bookingData={bookingData} />
    </>
  );
}
