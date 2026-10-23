import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ClipboardCheck,
  History,
  LockKeyhole,
  Save,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { EntryCommandType, EntryData, TeamData } from '@small-city-basketball/contracts';
import { createRegistrationApi } from '../api/registration';
import { EVENT_STATUS_LABELS } from '../domain/types';
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
import { EntryFilesPanel } from '../media/MediaPanels';

export function LeaderHomePage({ context }: { context: RegistrationWorkspace }) {
  const teamContext = context.teamContext;
  const api = useMemo(
    () => createRegistrationApi(context.client, teamContext?.orgId ?? ''),
    [context.client, teamContext?.orgId],
  );
  const read = useCallback(async () => {
    if (!teamContext) throw new Error('请先选择已获授权的球队');
    const [team, events] = await Promise.all([
      api.team(teamContext.teamId),
      api.registrationEvents(teamContext.teamId),
    ]);
    return { team, events };
  }, [api, teamContext]);
  const resource = useResource(read);
  const action = useAction();
  const navigate = useNavigate();
  return (
    <>
      <PageHeading
        eyebrow="YOUR TEAM, YOUR SEASON"
        title={teamContext?.teamName ?? '我的球队'}
        description={`${teamContext?.organizationName ?? ''} · 选择赛事，准备名单，带着你的球队上场。`}
      />
      <ActionNotice action={action} onReload={resource.reload} />
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <section className="registration-leader-banner">
            <span className="registration-team-icon">
              <UsersRound size={29} />
            </span>
            <div>
              <h2>{resource.data.team.name}</h2>
              <p>{resource.data.team.members.length}名当前成员 · 仅可管理本队报名</p>
            </div>
            {resource.data.team.capabilities.canManage && (
              <Link className="button button-secondary" to={`/teams/${resource.data.team.id}`}>
                管理长期成员
              </Link>
            )}
          </section>
          <div className="section-heading">
            <div>
              <h2>可报名赛事与我的报名</h2>
              <p>仅展示已开放赛事及本队已有报名，其他球队的名单不会显示。</p>
            </div>
          </div>
          {resource.data.events.length === 0 ? (
            <section className="panel registration-state">
              <ClipboardCheck size={32} />
              <h2>当前暂无可报名赛事</h2>
              <p>等待机构开放报名，或切换到其他已授权球队。</p>
            </section>
          ) : (
            <div className="registration-card-grid">
              {resource.data.events.map((item) => (
                <section className="panel registration-event-card" key={item.event.id}>
                  <span className="registration-event-kicker">
                    {EVENT_STATUS_LABELS[item.event.status]}
                  </span>
                  <h2>{item.event.name}</h2>
                  <p>
                    {item.event.startDate} — {item.event.endDate}
                  </p>
                  {item.rules && (
                    <p className="registration-hint">
                      {item.rules.minPlayers}–{item.rules.maxPlayers}人 ·{' '}
                      {item.rules.zeroAndDoubleZeroDistinct ? '0 与 00 不同号' : '0 与 00 视为同号'}
                    </p>
                  )}
                  {item.entry ? (
                    <>
                      <div>
                        <EntryBadge status={item.entry.status} />
                        <Link className="button button-secondary" to={`/entries/${item.entry.id}`}>
                          查看报名名单
                        </Link>
                      </div>
                      {item.entry.latestReviewReason && (
                        <p className="registration-review-reason">
                          审核意见：{item.entry.latestReviewReason}
                        </p>
                      )}
                      {(item.entry.status === 'REJECTED' || item.entry.status === 'WITHDRAWN') && (
                        <p className="registration-hint">
                          此报名已结束，本届不能再次新建本队报名。
                        </p>
                      )}
                    </>
                  ) : item.capabilities.canCreateEntry ? (
                    <button
                      className="button button-primary"
                      disabled={action.busy}
                      onClick={() => {
                        void action.run(async () => {
                          const entry = await api.createEntry(
                            item.event.id,
                            resource.data!.team.id,
                          );
                          if (action.isActive()) navigate(`/entries/${entry.id}`);
                        }, '报名草稿已创建');
                      }}
                    >
                      报名此赛事
                    </button>
                  ) : (
                    <p className="registration-muted">当前不能新建报名。</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
export function EntryDetailPage({ context }: { context: RegistrationWorkspace }) {
  const { entryId } = useParams();
  return <EntryDetailPageContent key={entryId} context={context} />;
}
function EntryDetailPageContent({ context }: { context: RegistrationWorkspace }) {
  const { entryId = '' } = useParams();
  const orgId = context.organizationId ?? context.teamContext?.orgId ?? '';
  const api = useMemo(() => createRegistrationApi(context.client, orgId), [context.client, orgId]);
  const read = useCallback(async () => {
    const entry = await api.entry(entryId);
    if (context.teamContext && entry.teamId !== context.teamContext.teamId)
      throw new Error('此报名不属于当前选择的球队，请返回我的球队。');
    const team = entry.capabilities.canEditRoster ? await api.team(entry.teamId) : undefined;
    return { entry, team };
  }, [api, entryId, context.teamContext?.teamId]);
  const resource = useResource(read);
  const action = useAction();
  const back = context.teamContext
    ? '/my-team'
    : resource.data
      ? `/events/${resource.data.entry.eventId}/registration`
      : '/registration';
  return (
    <>
      <Link className="back-link" to={back}>
        <ChevronLeft size={16} />
        {context.teamContext ? '返回我的球队' : '返回赛事报名'}
      </Link>
      <PageHeading
        eyebrow="ENTRY & ROSTER"
        title={resource.data ? `${resource.data.entry.teamName} · 报名名单` : '报名名单'}
        description="每次保存产生独立名单版本；长期成员变化不会改写已提交的姓名与号码。"
      />
      <ActionNotice action={action} onReload={resource.reload} />
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <EntryContent
          key={`${entryId}:${resource.data.entry.version}`}
          entry={resource.data.entry}
          team={resource.data.team}
          action={action}
          onRoster={(players) =>
            action.run(async () => {
              await api.roster(entryId, { expectedVersion: resource.data!.entry.version, players });
              resource.reload();
            }, '新名单版本已保存')
          }
          onCommand={(type, reason) =>
            action.run(
              async () => {
                await api.entryCommand(entryId, {
                  type,
                  expectedVersion: resource.data!.entry.version,
                  ...(reason ? { reason } : {}),
                });
                resource.reload();
              },
              type === 'SUBMIT'
                ? '报名已提交，等待独立审核'
                : type === 'APPROVE'
                  ? '报名已审核通过'
                  : type === 'REQUEST_CHANGES'
                    ? '报名已退回修改'
                    : type === 'REJECT'
                      ? '报名已拒绝'
                      : '报名已撤回',
            )
          }
        />
      )}
      {resource.data && !resource.error && !resource.loading && (
        <EntryFilesPanel context={context} entryId={entryId} />
      )}
    </>
  );
}
const commandLabels: Record<EntryCommandType, string> = {
  SUBMIT: '提交报名',
  WITHDRAW: '撤回报名',
  APPROVE: '审核通过',
  REQUEST_CHANGES: '退回修改',
  REJECT: '拒绝报名',
};
function canonical(players: { memberId: string; jerseyNo: string }[]) {
  return JSON.stringify([...players].sort((a, b) => a.memberId.localeCompare(b.memberId)));
}
function EntryContent({
  entry,
  team,
  action,
  onRoster,
  onCommand,
}: {
  entry: EntryData;
  team?: TeamData;
  action: ReturnType<typeof useAction>;
  onRoster: (players: { memberId: string; jerseyNo: string }[]) => Promise<void>;
  onCommand: (type: EntryCommandType, reason?: string) => Promise<void>;
}) {
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    Object.fromEntries(entry.players.map((player) => [player.memberId, player.jerseyNo])),
  );
  const [validation, setValidation] = useState('');
  const [command, setCommand] = useState<EntryCommandType>();
  const [reason, setReason] = useState('');
  const players = (team?.members ?? [])
    .filter((member) => Object.hasOwn(selection, member.id))
    .map((member) => ({ memberId: member.id, jerseyNo: selection[member.id] ?? '' }));
  const dirty =
    Boolean(team) &&
    canonical(Object.entries(selection).map(([memberId, jerseyNo]) => ({ memberId, jerseyNo }))) !==
      canonical(
        entry.players.map((player) => ({ memberId: player.memberId, jerseyNo: player.jerseyNo })),
      );
  const removed = team
    ? entry.players.filter(
        (player) => !team.members.some((member) => member.id === player.memberId),
      )
    : [];
  const cap = entry.capabilities;
  function saveRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const seen = new Set<string>();
    for (const player of players) {
      if (!/^(?:0|00|[1-9][0-9]?)$/.test(player.jerseyNo)) {
        setValidation('球衣号码仅允许0、00或1–99，请逐项核对。');
        return;
      }
      const key =
        !entry.rules.zeroAndDoubleZeroDistinct && player.jerseyNo === '00' ? '0' : player.jerseyNo;
      if (seen.has(key)) {
        setValidation(
          entry.rules.zeroAndDoubleZeroDistinct
            ? '同一名单内不能重复使用球衣号码。'
            : '球衣号码不能重复，当前规则下0与00视为同一号码。',
        );
        return;
      }
      seen.add(key);
    }
    setValidation('');
    void onRoster(players);
  }
  function confirmCommand() {
    if (!command) return;
    if (
      (command === 'REQUEST_CHANGES' || command === 'REJECT') &&
      (!reason.trim() || Array.from(reason.trim()).length > 500)
    ) {
      setValidation('退回或拒绝原因需为1–500个字符。');
      return;
    }
    setValidation('');
    void onCommand(command, reason.trim() || undefined);
  }
  return (
    <>
      <div className="registration-status-bar">
        <EntryBadge status={entry.status} />
        <Version value={entry.version} />
        <span>
          名单 {entry.players.length}人 · 要求{entry.rules.minPlayers}–{entry.rules.maxPlayers}人
        </span>
      </div>
      {entry.latestReviewReason && (
        <div className="registration-review-reason">
          <strong>最近审核意见</strong>
          <p>{entry.latestReviewReason}</p>
        </div>
      )}
      <div className="registration-note">
        <LockKeyhole size={19} />
        <p>
          规则 v{entry.rules.version}：
          {entry.rules.zeroAndDoubleZeroDistinct
            ? '0 与 00 是两个不同号码。'
            : '0 与 00 视为同一号码，不能同时使用。'}
          名单先保存再提交，保存不足人数的草稿不会自动提交。
        </p>
      </div>
      {validation && (
        <div className="registration-alert" role="alert">
          {validation}
        </div>
      )}
      {cap.canEditRoster && team && (
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>选择本届参赛球员</h2>
              <p>从本队当前成员中选择，并为每人填写本届号码。</p>
            </div>
            <span className="registration-version">已选{players.length}人</span>
          </div>
          {removed.length > 0 && (
            <p className="registration-alert">
              原名单中{removed.length}名成员已不在长期成员列表，保存新版本时将移出：
              {removed.map((player) => player.name).join('、')}。旧版本仍保留。
            </p>
          )}
          <form onSubmit={saveRoster}>
            <div className="registration-roster-editor">
              {team.members.length === 0 ? (
                <p className="registration-muted">球队暂无长期成员，请先在“管理长期成员”添加。</p>
              ) : (
                team.members.map((member, index) => {
                  const selected = Object.hasOwn(selection, member.id);
                  return (
                    <div
                      className={`registration-roster-row ${selected ? 'is-selected' : ''}`}
                      key={member.id}
                    >
                      <label className="registration-roster-select">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={action.busy}
                          aria-label={`选择${member.name}（成员${index + 1}）`}
                          onChange={(event) =>
                            setSelection((previous) => {
                              const next = { ...previous };
                              if (event.target.checked) next[member.id] = '';
                              else delete next[member.id];
                              return next;
                            })
                          }
                        />
                        <span>
                          <strong>{member.name}</strong>
                          <small>成员{index + 1}</small>
                        </span>
                      </label>
                      <label className="registration-jersey-label">
                        <span>球衣号码</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          placeholder="0 / 00 / 1–99"
                          value={selection[member.id] ?? ''}
                          disabled={!selected || action.busy}
                          aria-label={`球衣号码（${member.name}，成员${index + 1}）`}
                          onChange={(event) =>
                            setSelection((previous) => ({
                              ...previous,
                              [member.id]: event.target.value.trim(),
                            }))
                          }
                        />
                      </label>
                    </div>
                  );
                })
              )}
            </div>
            <div className="registration-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={action.busy || !dirty}
                onClick={() => {
                  setSelection(
                    Object.fromEntries(
                      entry.players.map((player) => [player.memberId, player.jerseyNo]),
                    ),
                  );
                  setValidation('');
                  action.clear();
                }}
              >
                取消修改
              </button>
              <button className="button button-primary" disabled={action.busy}>
                <Save size={16} />
                {action.busy ? '正在保存…' : '保存名单'}
              </button>
            </div>
            {dirty && (
              <p className="registration-hint">名单有未保存修改。请先保存新版本，再提交报名。</p>
            )}
          </form>
        </section>
      )}
      <section className="panel registration-form-panel">
        <div className="section-heading">
          <div>
            <h2>已保存的本届名单</h2>
            <p>
              {entry.rosterRevisionId
                ? '此名单版本独立保留，不能被长期成员更改覆盖。'
                : '尚未保存名单版本。'}
            </p>
          </div>
          <span className="registration-version">{entry.players.length}人</span>
        </div>
        {entry.players.length === 0 ? (
          <p className="registration-muted">暂无已保存球员。</p>
        ) : (
          <div className="registration-player-chips">
            {entry.players.map((player) => (
              <span key={player.memberId}>
                <b>#{player.jerseyNo}</b>
                <span>{player.name}</span>
              </span>
            ))}
          </div>
        )}
        <div className="registration-actions registration-entry-actions">
          {cap.canSubmit && (
            <button
              className="button button-primary"
              disabled={action.busy || dirty}
              onClick={() => {
                setCommand('SUBMIT');
                setReason('');
              }}
            >
              <Send size={16} />
              提交报名
            </button>
          )}
          {cap.canWithdraw && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => {
                setCommand('WITHDRAW');
                setReason('');
              }}
            >
              撤回报名
            </button>
          )}
          {cap.canApprove && (
            <button
              className="button button-primary"
              disabled={action.busy}
              onClick={() => {
                setCommand('APPROVE');
                setReason('');
              }}
            >
              <ClipboardCheck size={16} />
              审核通过
            </button>
          )}
          {cap.canRequestChanges && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => {
                setCommand('REQUEST_CHANGES');
                setReason('');
              }}
            >
              退回修改
            </button>
          )}
          {cap.canReject && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => {
                setCommand('REJECT');
                setReason('');
              }}
            >
              拒绝报名
            </button>
          )}
        </div>
        {!cap.canSubmit && (entry.status === 'DRAFT' || entry.status === 'CHANGES_REQUESTED') && (
          <p className="registration-hint">
            提交需满足{entry.rules.minPlayers}–{entry.rules.maxPlayers}
            人、有效名单和当前报名阶段；开放状态与具体权限由服务器核验。
          </p>
        )}
        {!cap.canReview && (
          <div className="registration-note">
            <ShieldCheck size={18} />
            <p>当前账号没有独立审核操作。领队与最近提交人不能审核本队报名，机构负责人也不例外。</p>
          </div>
        )}
        {!cap.canEditRoster && (
          <p className="registration-hint">
            当前名单只读。待审核时不可编辑；已通过名单需先由独立审核人退回修改。冻结后不能再修改或撤回。
          </p>
        )}
      </section>
      {command && (
        <section className="registration-confirm">
          <h2>确认{commandLabels[command]}？</h2>
          <p>
            {command === 'SUBMIT'
              ? '将提交上方已保存名单，等待独立审核。提交后不能直接编辑。'
              : command === 'WITHDRAW'
                ? '撤回后本届报名结束，不能重新创建同队报名。'
                : command === 'APPROVE'
                  ? '审核通过此名单版本，后续改名单须先退回修改。'
                  : command === 'REQUEST_CHANGES'
                    ? '领队将收到原因，并可保存新版本后重新提交。'
                    : '拒绝后本届报名结束，不能重新创建同队报名。'}
          </p>
          {(command === 'REQUEST_CHANGES' || command === 'REJECT') && (
            <label>
              审核原因
              <textarea
                value={reason}
                maxLength={500}
                rows={3}
                disabled={action.busy}
                onChange={(event) => setReason(event.target.value)}
                placeholder="请写明需要修改或无法通过的原因"
              />
            </label>
          )}
          <div className="registration-actions">
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() => {
                setCommand(undefined);
                setReason('');
                setValidation('');
              }}
            >
              取消
            </button>
            <button
              className="button button-primary"
              disabled={action.busy || (command === 'SUBMIT' && dirty)}
              onClick={confirmCommand}
            >
              {action.busy ? '正在处理…' : `确认${commandLabels[command]}`}
            </button>
          </div>
        </section>
      )}
      <section className="panel registration-form-panel">
        <div className="section-heading">
          <div>
            <h2>
              <History size={19} />
              操作记录
            </h2>
            <p>记录每次提交、审核与撤回对应的名单版本。</p>
          </div>
        </div>
        {entry.history.length === 0 ? (
          <p className="registration-muted">尚无提交或审核记录。</p>
        ) : (
          <div className="registration-history">
            {entry.history.map((item) => (
              <div key={item.id}>
                <span className="registration-history-dot" />
                <div>
                  <strong>{commandLabels[item.type]}</strong>
                  <time>
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                    })}
                  </time>
                  {item.reason && <p>{item.reason}</p>}
                  <small>操作账号：…{item.actorId.slice(-6)}</small>
                  {item.rosterRevisionId && <small>对应操作当时已保存的名单</small>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
