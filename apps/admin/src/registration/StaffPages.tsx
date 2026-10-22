import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  CheckCheck,
  ChevronLeft,
  ClipboardCheck,
  LockKeyhole,
  Save,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import type {
  EntrySummary,
  EventRegistrationData,
  RegistrationCommandType,
} from '@small-city-basketball/contracts';
import type { EventRepository } from '../domain/types';
import { EVENT_STATUS_LABELS } from '../domain/types';
import { createRegistrationApi } from '../api/registration';
import {
  ActionNotice,
  EntryBadge,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from './shared';
import type { RegistrationWorkspace } from './shared';

export function RegistrationIndexPage({
  repository,
}: {
  context: RegistrationWorkspace;
  repository: EventRepository;
}) {
  const read = useCallback(() => repository.list(), [repository]);
  const resource = useResource(read);
  return (
    <>
      <PageHeading
        eyebrow="REGISTRATION DESK"
        title="报名审核"
        description="先设置规则，再开放报名；独立审核通过后，冻结本届参赛名单。"
      />
      <div className="registration-process">
        <span>01 保存报名规则</span>
        <span>02 领队提交名单</span>
        <span>03 独立审核</span>
        <span>04 关闭并冻结</span>
      </div>
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : resource.data.length === 0 ? (
        <section className="panel registration-state">
          <ClipboardCheck size={30} />
          <h2>暂无可见赛事</h2>
          <p>创建赛事后，在这里设置报名规则和处理名单。</p>
          <Link className="button button-secondary" to="/events">
            前往赛事管理
          </Link>
        </section>
      ) : (
        <div className="registration-card-grid">
          {resource.data.map((event) => (
            <Link
              className="panel registration-event-card"
              key={event.id}
              to={`/events/${event.id}/registration`}
            >
              <span className="registration-event-kicker">{EVENT_STATUS_LABELS[event.status]}</span>
              <h2>{event.name}</h2>
              <p>
                {event.startDate} — {event.endDate}
              </p>
              <div>
                <span>规则 · 审核 · 名单冻结</span>
                <strong>进入报名工作台 →</strong>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="registration-hint">
        每场赛事的可用操作由服务端核验授权。当前页面不包含身份证、保险凭证或支付信息。
      </p>
    </>
  );
}
export function EventRegistrationPage({ context }: { context: RegistrationWorkspace }) {
  const { eventId } = useParams();
  return <EventRegistrationPageContent key={eventId} context={context} />;
}
function EventRegistrationPageContent({ context }: { context: RegistrationWorkspace }) {
  const { eventId = '' } = useParams();
  const api = useMemo(
    () => createRegistrationApi(context.client, context.organizationId ?? ''),
    [context.client, context.organizationId],
  );
  const read = useCallback(async () => {
    const [registration, entries] = await Promise.all([
      api.registration(eventId),
      api.entries(eventId),
    ]);
    return { registration, entries };
  }, [api, eventId]);
  const resource = useResource(read);
  const action = useAction();
  return (
    <>
      <Link className="back-link" to="/registration">
        <ChevronLeft size={16} />
        返回报名审核
      </Link>
      <PageHeading
        eyebrow="EVENT REGISTRATION"
        title={resource.data?.registration.event.name ?? '赛事报名'}
        description="报名规则、球队审核与正式参赛快照，都在这一届独立保留。"
      />
      <ActionNotice action={action} onReload={resource.reload} />
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <RegistrationContent
          key={`${eventId}:${resource.data.registration.event.version}`}
          data={resource.data.registration}
          entries={resource.data.entries}
          action={action}
          onRules={(input) =>
            action.run(async () => {
              await api.rules(eventId, input);
              resource.reload();
            }, '报名规则已保存')
          }
          onCommand={(type) =>
            action.run(
              async () => {
                await api.registrationCommand(eventId, {
                  type,
                  expectedVersion: resource.data!.registration.event.version,
                });
                resource.reload();
              },
              type === 'OPEN_REGISTRATION'
                ? '报名已开放，当前规则已锁定'
                : type === 'CLOSE_REGISTRATION'
                  ? '报名已关闭'
                  : '参赛名单已冻结',
            )
          }
        />
      )}
    </>
  );
}
function RegistrationContent({
  data,
  entries,
  action,
  onRules,
  onCommand,
}: {
  data: EventRegistrationData;
  entries: EntrySummary[];
  action: ReturnType<typeof useAction>;
  onRules: (input: {
    expectedVersion: number;
    minPlayers: number;
    maxPlayers: number;
    zeroAndDoubleZeroDistinct: boolean;
    requireIdentity: boolean;
    requireInsurance: boolean;
  }) => Promise<void>;
  onCommand: (type: RegistrationCommandType) => Promise<void>;
}) {
  const [minPlayers, setMin] = useState(String(data.rules?.minPlayers ?? 5));
  const [maxPlayers, setMax] = useState(String(data.rules?.maxPlayers ?? 12));
  const [distinct, setDistinct] = useState(data.rules?.zeroAndDoubleZeroDistinct ?? true);
  const [identity, setIdentity] = useState(data.rules?.requireIdentity ?? false);
  const [insurance, setInsurance] = useState(data.rules?.requireInsurance ?? false);
  const [validation, setValidation] = useState('');
  const [command, setCommand] = useState<RegistrationCommandType>();
  const capabilities = data.capabilities;
  const rulesDirty =
    Number(minPlayers) !== (data.rules?.minPlayers ?? 5) ||
    Number(maxPlayers) !== (data.rules?.maxPlayers ?? 12) ||
    distinct !== (data.rules?.zeroAndDoubleZeroDistinct ?? true) ||
    identity !== (data.rules?.requireIdentity ?? false) ||
    insurance !== (data.rules?.requireInsurance ?? false);
  const excluded = data.counts.DRAFT + data.counts.REJECTED + data.counts.WITHDRAWN;
  function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const min = Number(minPlayers),
      max = Number(maxPlayers);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 60) {
      setValidation('人数需为整数，最少1人、最多60人，最大人数不能少于最小人数。');
      return;
    }
    setValidation('');
    void onRules({
      expectedVersion: data.event.version,
      minPlayers: min,
      maxPlayers: max,
      zeroAndDoubleZeroDistinct: distinct,
      requireIdentity: identity,
      requireInsurance: insurance,
    });
  }
  return (
    <>
      <section className="registration-status-bar">
        <span className="status-badge blue">{EVENT_STATUS_LABELS[data.event.status]}</span>
        <Version value={data.event.version} />
        <span>
          {data.freeze
            ? '名单已冻结'
            : data.rules
              ? `报名规则 v${data.rules.version}`
              : '尚未保存报名规则'}
        </span>
        <div className="registration-actions">
          {capabilities.canOpen && (
            <button
              className="button button-primary"
              disabled={action.busy || rulesDirty}
              onClick={() => setCommand('OPEN_REGISTRATION')}
            >
              开放报名
            </button>
          )}
          {capabilities.canClose && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setCommand('CLOSE_REGISTRATION')}
            >
              关闭报名
            </button>
          )}
        </div>
      </section>
      {command && (
        <section className="registration-confirm">
          <h2>
            {command === 'OPEN_REGISTRATION'
              ? '确认开放报名？'
              : command === 'CLOSE_REGISTRATION'
                ? '确认关闭报名？'
                : '确认冻结参赛名单？'}
          </h2>
          <p>
            {command === 'OPEN_REGISTRATION'
              ? '开放后将锁定当前规则，领队可开始报名。请先核对人数与0/00号码规则。'
              : command === 'CLOSE_REGISTRATION'
                ? '关闭后不能新报名或提交待提交草稿；已退回修改的报名仍可按规则重提。'
                : `将保存${data.counts.APPROVED}支已通过球队的不可变名单快照，并排除${excluded}支非通过报名。冻结后不能再更改报名或审核，不会自动发布赛程。`}
          </p>
          <div className="registration-actions">
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => setCommand(undefined)}
            >
              取消
            </button>
            <button
              className="button button-primary"
              disabled={action.busy || (command === 'OPEN_REGISTRATION' && rulesDirty)}
              onClick={() => {
                void onCommand(command);
              }}
            >
              {action.busy
                ? '正在处理…'
                : '确认' +
                  (command === 'OPEN_REGISTRATION'
                    ? '开放'
                    : command === 'CLOSE_REGISTRATION'
                      ? '关闭'
                      : '冻结')}
            </button>
          </div>
        </section>
      )}
      <div className="registration-two-column">
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>
                <Settings2 size={19} />
                报名规则
              </h2>
              <p>
                {capabilities.canManageRules
                  ? '仅草稿阶段可保存；每次保存形成新规则版本。'
                  : '当前规则只读，开放报名后不可更改。'}
              </p>
            </div>
            {data.rules && <span className="registration-version">规则 v{data.rules.version}</span>}
          </div>
          <form onSubmit={saveRules}>
            <div className="registration-form-grid">
              <label>
                最少参赛人数
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={minPlayers}
                  disabled={!capabilities.canManageRules || action.busy}
                  onChange={(event) => setMin(event.target.value)}
                />
              </label>
              <label>
                最多参赛人数
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={maxPlayers}
                  disabled={!capabilities.canManageRules || action.busy}
                  onChange={(event) => setMax(event.target.value)}
                />
              </label>
            </div>
            <label className="registration-check">
              <input
                type="checkbox"
                checked={distinct}
                disabled={!capabilities.canManageRules || action.busy}
                onChange={(event) => setDistinct(event.target.checked)}
              />
              <span>
                <strong>0 与 00 为不同球衣号码</strong>
                <small>
                  {distinct
                    ? '可由两名不同球员分别使用0和00。'
                    : '0和00视为同一号码，不能同时使用。'}
                </small>
              </span>
            </label>
            <label className="registration-check">
              <input
                type="checkbox"
                checked={identity}
                disabled={!capabilities.canManageRules || action.busy}
                onChange={(event) => setIdentity(event.target.checked)}
              />
              <span>
                <strong>要求身份核验</strong>
                <small>本阶段尚未接入，启用后会阻止开放报名。</small>
              </span>
            </label>
            <label className="registration-check">
              <input
                type="checkbox"
                checked={insurance}
                disabled={!capabilities.canManageRules || action.busy}
                onChange={(event) => setInsurance(event.target.checked)}
              />
              <span>
                <strong>要求保险凭证</strong>
                <small>本阶段尚未接入，启用后会阻止开放报名。</small>
              </span>
            </label>
            {validation && (
              <p role="alert" className="registration-alert">
                {validation}
              </p>
            )}
            {(identity || insurance) && (
              <p className="registration-alert">
                身份核验与保险凭证尚未接入。此规则可以保存，但不能开放报名，不会默认豁免。
              </p>
            )}
            {rulesDirty && (
              <p className="registration-hint">报名规则有未保存修改，请先保存后再开放报名。</p>
            )}
            {capabilities.canManageRules && (
              <button className="button button-primary" disabled={action.busy}>
                <Save size={16} />
                {action.busy ? '正在保存…' : '保存报名规则'}
              </button>
            )}
          </form>
        </section>
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>
                <LockKeyhole size={19} />
                名单冻结
              </h2>
              <p>冻结已通过版本，作为后续排赛的参赛依据。</p>
            </div>
          </div>
          <div className="registration-count-grid">
            <div>
              <strong>{data.counts.APPROVED}</strong>
              <span>审核通过</span>
            </div>
            <div>
              <strong>{data.counts.SUBMITTED}</strong>
              <span>等待审核</span>
            </div>
            <div>
              <strong>{data.counts.CHANGES_REQUESTED}</strong>
              <span>等待修改</span>
            </div>
            <div>
              <strong>{data.counts.DRAFT}</strong>
              <span>待提交 · 将排除</span>
            </div>
          </div>
          <ul className="registration-checklist">
            <li>报名已关闭：{data.event.status === 'REGISTRATION_CLOSED' ? '是' : '否'}</li>
            <li>至少2支审核通过：{data.counts.APPROVED >= 2 ? '已满足' : '尚未满足'}</li>
            <li>
              无待审核、待修改：
              {data.counts.SUBMITTED === 0 && data.counts.CHANGES_REQUESTED === 0
                ? '已满足'
                : '尚未满足'}
            </li>
          </ul>
          <p className="registration-hint">
            排除项：待提交 {data.counts.DRAFT}、已拒绝 {data.counts.REJECTED}、已撤回{' '}
            {data.counts.WITHDRAWN}；共 {excluded} 支。它们不会进入冻结快照。
          </p>
          {data.freeze ? (
            <div className="registration-note">
              <CheckCheck size={20} />
              <p>
                已冻结 {data.freeze.entries.length} 支球队 · 规则 v{data.freeze.rulesetVersion}
                。冻结后所有报名与审核写入均关闭。
              </p>
            </div>
          ) : capabilities.canFreeze ? (
            <button
              className="button button-primary"
              disabled={action.busy}
              onClick={() => setCommand('FREEZE_REGISTRATION')}
            >
              <LockKeyhole size={16} />
              冻结参赛名单
            </button>
          ) : (
            <p className="registration-muted">条件未满足或当前身份没有冻结权限。</p>
          )}
        </section>
      </div>
      <section className="panel registration-form-panel">
        <div className="section-heading">
          <div>
            <h2>球队报名</h2>
            <p>{entries.length} 支报名 · 审核必须由独立人员完成，机构负责人也不能自审。</p>
          </div>
          <ShieldCheck size={22} />
        </div>
        {entries.length === 0 ? (
          <div className="registration-state">
            <ClipboardCheck size={28} />
            <h3>等待领队提交报名</h3>
            <p>领队接受邀请后，从“我的球队”选择可报名赛事。</p>
          </div>
        ) : (
          <div className="registration-entry-list">
            {entries.map((entry) => (
              <Link to={`/entries/${entry.id}`} key={entry.id} className="registration-entry-row">
                <div>
                  <h3>{entry.teamName}</h3>
                  <p>{entry.latestReviewReason || '尚无审核意见'}</p>
                </div>
                <EntryBadge status={entry.status} />
                <span className="registration-link-text">查看名单 →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      {data.freeze && (
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>冻结快照</h2>
              <p>
                于{' '}
                {new Date(data.freeze.createdAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}{' '}
                保存。长期成员变化不会改写此快照。
              </p>
            </div>
            <LockKeyhole size={21} />
          </div>
          <p className="registration-hint">
            冻结时赛事 v{data.freeze.eventVersion} · 规则 v{data.freeze.rulesetVersion} ·
            参赛球员只读保留
          </p>
          {data.freeze.entries.map((entry) => (
            <details className="registration-freeze-team" key={entry.entryId}>
              <summary>
                {entry.teamName}
                <span>{entry.players.length}名球员</span>
              </summary>
              <p className="registration-hint">冻结名单只读，保留当时的姓名与号码。</p>
              <div className="registration-player-chips">
                {entry.players.map((player) => (
                  <span key={player.memberId}>
                    <b>#{player.jerseyNo}</b>
                    <span>{player.name}</span>
                  </span>
                ))}
              </div>
            </details>
          ))}
        </section>
      )}
    </>
  );
}
