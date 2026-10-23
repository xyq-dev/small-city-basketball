import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ExternalLink,
  Globe,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { EventStandingsData } from '@small-city-basketball/contracts';
import type { EventRepository } from '../domain/types';
import { EVENT_FORMAT_LABELS } from '../domain/types';
import { createViewingApi } from '../api/viewing';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  message,
  useAction,
  useResource,
} from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import { StandingsRulesForm } from './RulesForm';
import { RuleSummary, StandingsTable } from './StandingsTable';
export function viewingOrganization(
  context: RegistrationWorkspace,
): context is RegistrationWorkspace & { organizationId: string } {
  return Boolean(context.organizationId?.trim() && !context.teamContext);
}
function ViewingAccessRequired() {
  return (
    <section className="panel view-empty">
      <ShieldCheck size={30} />
      <h1>请切换到机构工作台</h1>
      <p>球队授权不包含整届排名或公开观赛管理权限。</p>
      <Link className="button button-secondary" to="/my-team">
        返回我的球队
      </Link>
    </section>
  );
}
export function StandingsIndexPage({
  context,
  repository,
}: {
  context: RegistrationWorkspace;
  repository: EventRepository;
}) {
  return viewingOrganization(context) ? (
    <StandingsIndex key={context.organizationId} repository={repository} />
  ) : (
    <ViewingAccessRequired />
  );
}
function StandingsIndex({ repository }: { repository: EventRepository }) {
  const read = useCallback(() => repository.list(), [repository]);
  const resource = useResource(read);
  return (
    <div className="view-page">
      <PageHeading
        eyebrow="THE TABLE, OPEN ON YOUR TERMS"
        title="排名与观赛"
        description="明确每一分和同分判定，预览后正式发布；由主办方主动启用可撤销的公开观赛。"
      />
      <div className="view-note">
        <ShieldCheck size={20} />
        <p>
          支持单循环积分、分组循环接淘汰及单淘汰晋级名次，均只取当前有效独立确认赛果；公开观赛需要主办方显式授权。
        </p>
      </div>
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : !resource.data.length ? (
        <section className="panel view-empty">
          <Globe size={30} />
          <h2>暂无有权限的赛事</h2>
          <p>仅场次授权不包含整届私有排名。请联系机构负责人确认赛事授权。</p>
        </section>
      ) : (
        <div className="view-event-grid">
          {resource.data.map((event) => {
            const supported = ['ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'].includes(
              event.format,
            );
            const content = (
              <>
                <span className="status-badge neutral">{EVENT_FORMAT_LABELS[event.format]}</span>
                <h2>{event.name}</h2>
                <p>
                  {event.startDate} — {event.endDate}
                </p>
                {supported ? (
                  <strong>查看排名与公开观赛 →</strong>
                ) : (
                  <p>当前赛制暂不支持排名与公开观赛</p>
                )}
              </>
            );
            return supported ? (
              <Link
                key={event.id}
                to={`/events/${event.id}/standings`}
                className="panel view-event-card"
              >
                {content}
              </Link>
            ) : (
              <article key={event.id} className="panel view-event-card" aria-label={event.name}>
                {content}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
export function EventStandingsPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  return viewingOrganization(context) ? (
    <EventStandings
      key={`${context.organizationId}:${eventId}`}
      context={context}
      eventId={eventId}
    />
  ) : (
    <ViewingAccessRequired />
  );
}
function EventStandings({
  context,
  eventId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  eventId: string;
}) {
  const api = useMemo(
    () => createViewingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const [data, setData] = useState<EventStandingsData>(),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [dirty, setDirty] = useState(false),
    [decision, setDecision] = useState<{
      type: 'PUBLISH' | 'ENABLE' | 'ENABLE_HISTORY' | 'DISABLE';
      data: EventStandingsData;
    } | null>(null);
  const alive = useRef(true),
    generation = useRef(0);
  const action = useAction();
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoadError('');
    setLoading(true);
    try {
      const next = await api.event(eventId);
      if (alive.current && current === generation.current) setData(next);
    } catch (cause) {
      if (alive.current && current === generation.current) setLoadError(message(cause));
    } finally {
      if (alive.current && current === generation.current) setLoading(false);
    }
  }, [api, eventId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      ++generation.current;
    };
  }, [refresh]);
  async function write(run: () => Promise<EventStandingsData>, notice: string) {
    let succeeded = false;
    await action.run(async () => {
      const next = await run();
      if (!alive.current) return;
      ++generation.current;
      setData(next);
      setLoadError('');
      setLoading(false);
      succeeded = true;
    }, notice);
    return succeeded && alive.current;
  }
  async function confirm() {
    const current = decision;
    if (!current) return;
    const pinned = current.data;
    const succeeded = await write(
      () =>
        current.type === 'PUBLISH'
          ? api.publishRules(eventId, {
              type: 'PUBLISH_STANDINGS_RULES',
              rulesetId: pinned.rules!.id,
              expectedEventVersion: pinned.event.version,
            })
          : api.publicViewing(eventId, {
              type: current.type,
              expectedEventVersion: pinned.event.version,
            }),
      current.type === 'PUBLISH'
        ? '排名规则已正式发布并锁定'
        : current.type === 'ENABLE_HISTORY'
          ? '历史观赛已启用，使用全新链接'
          : current.type === 'ENABLE'
            ? '公开观赛已启用'
            : '公开观赛已撤销，旧链接已失效',
    );
    if (succeeded) setDecision(null);
  }
  const history = data?.event.status === 'COMPLETED' || data?.event.status === 'ARCHIVED';
  const activePublication = data?.publication?.status === 'ACTIVE';
  const publicPath = activePublication
    ? `/watch/${encodeURIComponent(data.publication!.publicEventId)}`
    : '';
  return (
    <div className="view-page">
      <Link className="back-link" to="/standings">
        <ChevronLeft size={16} />
        返回排名与观赛
      </Link>
      <PageHeading
        eyebrow="DECLARED RULES. CONFIRMED RESULTS."
        title={data?.event.name ?? '赛事排名与观赛'}
        description="只按当前有效确认赛果计算。规则与公开链接均需显式发布，未完赛排名只是暂列。"
      >
        <button
          className="button button-secondary"
          disabled={action.busy || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          刷新排名资料
        </button>
      </PageHeading>
      <ActionNotice action={action} onReload={() => void refresh()} />
      {loadError && data && (
        <div className="view-note error" role="alert">
          {loadError} 上次资料仍在；刷新后核对再操作。
        </div>
      )}
      {!data ? (
        <ResourceState loading={loading} error={loadError} reload={() => void refresh()} />
      ) : (
        <>
          {data.event.format === 'GROUP_KNOCKOUT' && (
            <section className="panel view-panel">
              <h2>分组循环与淘汰晋级</h2>
              <p>
                积分仅用于本组，每组前二按固定交叉席位晋级；影响晋级顺序的同分须独立保存抽签，不推造跨组第三名排名。
              </p>
              <p>
                在本页明确保存并锁定组内积分细则。资格首轮及后轮发布会撤销旧实时观赛链接，之后须显式启用新链接。
              </p>
              <Link
                className="button button-primary"
                to={`/events/${encodeURIComponent(eventId)}/groups`}
              >
                查看分组与晋级
              </Link>
            </section>
          )}
          {data.event.format === 'SINGLE_ELIMINATION' && (
            <section className="panel view-panel">
              <h2>淘汰赛晋级与名次</h2>
              <p>
                单淘汰不套用循环赛积分。固定签位、平分加时、首轮轮空无比赛，不设三四名赛；全部有效独立确认后形成最终名次。
              </p>
              <p>发布下一轮会撤销现有实时观赛链接，之后请在本页显式重新启用新链接。</p>
              <Link
                className="button button-primary"
                to={`/events/${encodeURIComponent(eventId)}/knockout`}
              >
                查看晋级与最终名次
              </Link>
            </section>
          )}
          {(data.event.format === 'ROUND_ROBIN' || data.event.format === 'GROUP_KNOCKOUT') && (
            <StandingsRulesForm
              key={`${data.rules?.id ?? 'none'}:${data.event.version}`}
              data={data}
              busy={action.busy || loading || Boolean(loadError)}
              onDirtyChange={setDirty}
              onSave={async (input) => {
                await write(() => api.saveRules(eventId, input), '排名规则草稿已保存');
              }}
            />
          )}
          {data.capabilities.canPublishRules && data.rules && (
            <section className="panel view-panel">
              <h2>
                <LockKeyhole size={20} /> 将已保存草稿正式锁定
              </h2>
              <p className="view-muted">先核对预览。发布后本届规则永久锁定，不能另存版本覆盖。</p>
              {dirty && <p className="view-muted">本地修改未保存，请先保存或取消后再发布。</p>}
              <button
                className="button button-primary"
                disabled={action.busy || loading || dirty || Boolean(loadError)}
                onClick={() => setDecision({ type: 'PUBLISH', data })}
              >
                发布排名规则
              </button>
            </section>
          )}
          {data.event.format === 'ROUND_ROBIN' &&
            (data.standings ? (
              <StandingsTable
                data={data.standings}
                preview={data.standings.mode === 'DRAFT_PREVIEW'}
              />
            ) : (
              <section className="panel view-panel">
                <h2>排名尚未读取</h2>
                <p className="view-muted">
                  {data.rules
                    ? '规则仍已保存。可刷新读取当前榜单；公开观赛撤销成功不依赖榜单计算。'
                    : '请先显式保存排名规则，再读取草稿预览。'}
                </p>
              </section>
            ))}
          <section className="panel view-panel view-publication">
            <div>
              <div className="view-eyebrow">A LINK YOU CONTROL</div>
              <h2>{history ? '历史观赛授权' : '公开观赛'}</h2>
              <p className="view-muted">
                {activePublication
                  ? data.publication?.purpose === 'HISTORY'
                    ? '主办方已显式授权历史观赛，仅公开有限赛事、正式赛程、比分和排名；名单、人员和控制凭据仍为私有。'
                    : '当前链接可匿名读取有限赛事、赛程、比分和排名；不会公开名单、人员或控制凭据。'
                  : data.publication?.status === 'REVOKED'
                    ? '公开观赛已撤销，原链接永久失效。再次启用将生成全新链接。'
                    : history
                      ? '本届已闭赛，历史默认不公开。必须显式启用历史观赛并使用全新链接，旧活动链接不会复活。'
                      : '当前未启用匿名观赛，私有记分不会自动公开。'}
              </p>
            </div>
            {data.capabilities.canDisablePublicViewing ? (
              <button
                className="button button-secondary"
                disabled={action.busy || loading || dirty}
                onClick={() => setDecision({ type: 'DISABLE', data })}
              >
                撤销公开观赛
              </button>
            ) : data.capabilities.canEnablePublicViewing ? (
              <button
                className="button button-primary"
                disabled={action.busy || loading || dirty || Boolean(loadError)}
                onClick={() => setDecision({ type: history ? 'ENABLE_HISTORY' : 'ENABLE', data })}
              >
                <Globe size={17} />
                {history ? '启用历史观赛' : '启用公开观赛'}
              </button>
            ) : (
              <span className="status-badge neutral">
                {activePublication ? '已启用 · 当前身份只读' : '当前不可启用'}
              </span>
            )}
            {!activePublication && (
              <p className="view-caption">
                {history
                  ? data.event.format === 'SINGLE_ELIMINATION'
                    ? '历史授权需本届已完赛或归档、全部晋级及决赛赛果当前有效确认；操作权限由赛事授权决定。'
                    : '历史授权需本届已完赛或归档、正式规则已锁定且全部赛果当前有效确认；操作权限由赛事授权决定。'
                  : data.event.format === 'SINGLE_ELIMINATION'
                    ? '启用需已正式发布单淘汰赛首轮；后轮发布会撤销旧链接，须再次显式启用。'
                    : data.event.format === 'GROUP_KNOCKOUT'
                      ? '启用需已锁定组内积分规则并发布组赛；资格首轮及后轮发布会撤销旧链接，须再次显式启用。'
                      : '启用需已正式锁定排名规则并发布单循环赛程；操作权限由当前赛事授权决定。'}
              </p>
            )}
            {activePublication && (
              <div className="view-share">
                <strong>公开观赛链接</strong>
                <a
                  className="view-share-url"
                  href={publicPath}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {window.location.origin}
                  {publicPath}
                </a>
                <div className="view-actions">
                  <a
                    className="button button-secondary"
                    href={publicPath}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={16} />
                    打开公开观赛
                  </a>
                </div>
                <p className="view-caption">
                  撤销后新读取立即不可用；已打开页面会在后续轮询时清除内容，不能保证无推送的零延迟。
                </p>
              </div>
            )}
          </section>
          <div className="view-note">
            <ShieldCheck size={19} />
            <p>
              仅当前有效确认计入榜单。重开后立即整场撤出，重确认只计最新一次；共享名次采用1、1、3，不使用隐藏判定。高级统计未统计，可靠离线与真实视频尚未接入；OBS授权独立管理。
            </p>
          </div>
        </>
      )}
      {decision && (
        <Modal
          title={
            decision.type === 'PUBLISH'
              ? '发布排名规则'
              : decision.type === 'ENABLE_HISTORY'
                ? '启用历史观赛'
                : decision.type === 'ENABLE'
                  ? '启用公开观赛'
                  : '撤销公开观赛'
          }
          busy={action.busy}
          onClose={() => setDecision(null)}
        >
          {decision.type === 'PUBLISH' ? (
            <>
              <p>即将正式发布以下已保存规则并永久锁定。本地未保存修改不在发布范围内。</p>
              <RuleSummary rules={decision.data.rules!} />
            </>
          ) : (
            <p>
              {decision.type === 'ENABLE_HISTORY'
                ? '将为已闭赛赛事生成全新的历史观赛链接，旧活动链接永久失效且不会复活。仅公开赛事、球队展示名、正式赛程、基础比分与排名，不含名单、工作人员或写入凭据；OBS仍须独立授权。'
                : decision.type === 'ENABLE'
                  ? '将生成可匿名打开的有限观赛链接，仅公开赛事、冻结球队展示名、正式赛程、基础比分／时钟和排名。不含名单、工作人员或写入凭据。'
                  : '撤销后原链接及其全部比赛链接永久不可用。再次启用必须使用新链接；已打开页面在后续读取时清除资料。'}
            </p>
          )}
          {action.error && (
            <div className="view-note error" role="alert">
              {action.error} 请关闭并刷新核对当前状态。
            </div>
          )}
          <div className="view-actions">
            <button
              className="button button-primary"
              disabled={action.busy}
              onClick={() => void confirm()}
            >
              {decision.type === 'PUBLISH'
                ? '正式发布排名规则'
                : decision.type === 'ENABLE_HISTORY'
                  ? '确认启用历史观赛'
                  : decision.type === 'ENABLE'
                    ? '确认启用公开观赛'
                    : '确认撤销公开观赛'}
            </button>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setDecision(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
