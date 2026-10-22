import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  Copy,
  Link2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  InvitationData,
  IssuedInvitationData,
  TeamData,
} from '@small-city-basketball/contracts';
import { createRegistrationApi } from '../api/registration';
import type { RegistrationApi } from '../api/registration';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from './shared';
import type { RegistrationWorkspace } from './shared';

export function TeamsPage({ context }: { context: RegistrationWorkspace }) {
  const api = useMemo(
    () => createRegistrationApi(context.client, context.organizationId ?? ''),
    [context.client, context.organizationId],
  );
  const read = useCallback(() => api.teams(), [api]);
  const resource = useResource(read);
  const action = useAction();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || Array.from(name.trim()).length > 80) return;
    await action.run(async () => {
      const team = await api.createTeam({ name: name.trim() });
      if (action.isActive()) navigate(`/teams/${team.id}`);
    }, '球队已创建');
  }
  return (
    <>
      <PageHeading
        eyebrow="TEAMS & PEOPLE"
        title="球队与球员"
        description="长期成员在这里维护，每届报名名单独立保存。"
      >
        {resource.data?.canCreateTeam && (
          <button
            className="button button-primary"
            onClick={() => {
              setCreating(true);
              action.clear();
            }}
          >
            <Plus size={17} />
            创建球队
          </button>
        )}
      </PageHeading>
      <ActionNotice action={action} onReload={resource.reload} />
      {creating && (
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>创建球队</h2>
              <p>先建立球队，再邀请指定账号成为领队。</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="registration-inline-form"
          >
            <label>
              球队名称
              <input
                required
                maxLength={80}
                value={name}
                disabled={action.busy}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：青峰篮球队"
              />
            </label>
            <div className="registration-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={action.busy}
                onClick={() => {
                  setCreating(false);
                  setName('');
                  action.clear();
                }}
              >
                取消
              </button>
              <button className="button button-primary" disabled={action.busy || !name.trim()}>
                {action.busy ? '正在创建…' : '保存球队'}
              </button>
            </div>
          </form>
        </section>
      )}
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <div className="registration-summary">
            <span>
              <strong>{resource.data.data.length}</strong>支球队
            </span>
            <span>
              <strong>
                {resource.data.data.reduce((sum, team) => sum + team.members.length, 0)}
              </strong>
              名当前成员
            </span>
            <p>姓名用于名单展示，不作为人员身份去重依据。</p>
          </div>
          {resource.data.data.length === 0 ? (
            <section className="panel registration-state">
              <UsersRound size={32} />
              <h2>还没有球队</h2>
              <p>
                {resource.data.canCreateTeam
                  ? '创建第一支球队，准备长期成员和领队授权。'
                  : '当前身份没有可访问的球队，请联系机构管理员。'}
              </p>
            </section>
          ) : (
            <div className="registration-card-grid">
              {resource.data.data.map((team) => (
                <Link
                  className="panel registration-team-card"
                  to={`/teams/${team.id}`}
                  key={team.id}
                >
                  <span className="registration-team-icon">
                    <UsersRound size={25} />
                  </span>
                  <div>
                    <h2>{team.name}</h2>
                    <p>
                      {team.members.length}名成员 · 资料 v{team.version}
                    </p>
                  </div>
                  <span className="registration-link-text">管理球队 →</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function invitationStatus(invitation: InvitationData) {
  if (invitation.revokedAt) return '已撤销';
  if (invitation.acceptedAt) return '已接受';
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return '已过期';
  return '待接受';
}
function IssuedInvitation({
  issued,
  onDismiss,
}: {
  issued: IssuedInvitationData;
  onDismiss: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const link = new URL('/', window.location.origin);
  link.hash = new URLSearchParams({
    invitation: issued.invitation.id,
    token: issued.token,
  }).toString();
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.href);
      setCopyStatus('邀请链接已复制');
    } catch {
      setCopyStatus('无法自动复制，请选择下方链接手动复制');
    }
  }
  return (
    <section className="registration-issued" aria-label="一次性领队邀请">
      <div className="section-heading">
        <div>
          <h2>
            <Link2 size={20} />
            领队邀请已生成
          </h2>
          <p>凭据只在本次创建时显示。请发送给对应账号本人，关闭后无法再次查看。</p>
        </div>
        <button className="icon-button" aria-label="关闭邀请凭据" onClick={onDismiss}>
          <X size={19} />
        </button>
      </div>
      <p>
        受邀用户 ID：<code>{issued.invitation.targetUserId}</code>
      </p>
      <label>
        邀请链接
        <textarea aria-label="邀请链接" readOnly value={link.href} rows={3} />
      </label>
      <div className="registration-actions">
        <button
          className="button button-primary"
          onClick={() => {
            void copy();
          }}
        >
          <Copy size={16} />
          复制邀请链接
        </button>
        <button className="button button-secondary" onClick={onDismiss}>
          我已保存，关闭凭据
        </button>
      </div>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <p className="registration-hint">
        链接凭据仅放在地址片段中。接收方页面读取后立即移除；系统不会发送邮件。
      </p>
    </section>
  );
}

export function TeamDetailPage({ context }: { context: RegistrationWorkspace }) {
  const { teamId } = useParams();
  return <TeamDetailContent key={teamId} context={context} />;
}
function TeamDetailContent({ context }: { context: RegistrationWorkspace }) {
  const { teamId = '' } = useParams();
  const orgId = context.organizationId ?? context.teamContext?.orgId ?? '';
  const api = useMemo(() => createRegistrationApi(context.client, orgId), [context.client, orgId]);
  const read = useCallback(async () => {
    if (context.teamContext && teamId !== context.teamContext.teamId)
      throw new Error('此页面不属于当前选择的球队，请返回我的球队。');
    const team = await api.team(teamId);
    return { team, invitations: team.capabilities.canInvite ? await api.invitations(teamId) : [] };
  }, [api, teamId, context.teamContext?.teamId]);
  const resource = useResource(read);
  const action = useAction();
  const [issued, setIssued] = useState<IssuedInvitationData>();
  useEffect(() => {
    setIssued(undefined);
  }, [teamId]);
  return (
    <>
      <Link className="back-link" to={context.teamContext ? '/my-team' : '/teams'}>
        <ChevronLeft size={16} />
        {context.teamContext ? '返回我的球队' : '返回球队列表'}
      </Link>
      <PageHeading
        eyebrow="TEAM PROFILE"
        title={resource.data?.team.name ?? '球队资料'}
        description="长期成员、领队邀请与授权。更改成员不会覆盖已保存的赛事名单。"
      />
      <ActionNotice action={action} onReload={resource.reload} />
      {issued?.invitation.teamId === teamId && (
        <IssuedInvitation issued={issued} onDismiss={() => setIssued(undefined)} />
      )}
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : (
        <TeamContent
          key={`${teamId}:${resource.data.team.version}`}
          team={resource.data.team}
          invitations={resource.data.invitations}
          api={api}
          action={action}
          onReload={resource.reload}
          onIssued={setIssued}
        />
      )}
    </>
  );
}

function TeamContent({
  team,
  invitations,
  api,
  action,
  onReload,
  onIssued,
}: {
  team: TeamData;
  invitations: InvitationData[];
  api: RegistrationApi;
  action: ReturnType<typeof useAction>;
  onReload: () => void;
  onIssued: (value: IssuedInvitationData) => void;
}) {
  const [name, setName] = useState(team.name);
  const [members, setMembers] = useState(
    team.members.map((member) => ({ ...member, key: member.id })),
  );
  const [editing, setEditing] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [expires, setExpires] = useState('24');
  const [validation, setValidation] = useState('');
  const [grantTarget, setGrantTarget] = useState<{
    userId: string;
    status: 'ACTIVE' | 'DISABLED';
  }>();
  function saveMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      members.some((member) => !member.name.trim() || Array.from(member.name.trim()).length > 80)
    ) {
      setValidation('每位成员的姓名需为1–80个字符。');
      return;
    }
    setValidation('');
    void action.run(async () => {
      await api.members(team.id, {
        expectedVersion: team.version,
        members: members.map((member) => ({
          ...(member.id ? { id: member.id } : {}),
          name: member.name.trim(),
        })),
      });
      onReload();
    }, '成员已保存');
  }
  return (
    <>
      {validation && (
        <p className="registration-alert" role="alert">
          {validation}
        </p>
      )}
      <div className="registration-two-column">
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>球队基本资料</h2>
              <p>长期档案，不自动授予机构权限。</p>
            </div>
            <Version value={team.version} />
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void action.run(async () => {
                await api.updateTeam(team.id, { name: name.trim(), expectedVersion: team.version });
                onReload();
              });
            }}
          >
            <label>
              球队名称
              <input
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!team.capabilities.canManage || action.busy}
                required
              />
            </label>
            {team.capabilities.canManage && (
              <button
                className="button button-secondary"
                disabled={action.busy || !name.trim() || name === team.name}
              >
                <Save size={16} />
                保存队名
              </button>
            )}
          </form>
          <div className="registration-note">
            <ShieldCheck size={18} />
            <p>球员只有姓名和系统成员 ID；身份证、保险及支付均未接入。</p>
          </div>
        </section>
        <section className="panel registration-form-panel">
          <div className="section-heading">
            <div>
              <h2>长期成员</h2>
              <p>{members.length} / 60人 · 同名成员可分别保留</p>
            </div>
            {team.capabilities.canManage && !editing && (
              <button className="button button-secondary" onClick={() => setEditing(true)}>
                编辑成员
              </button>
            )}
          </div>
          <form onSubmit={saveMembers}>
            <div className="registration-member-list">
              {members.length === 0 && (
                <p className="registration-muted">
                  暂无成员。添加成员后，领队可以从中选择赛事名单。
                </p>
              )}
              {members.map((member, index) => (
                <div className="registration-member-row" key={member.key}>
                  <span className="registration-row-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <label className="sr-only" htmlFor={`member-${member.key}`}>
                    成员{index + 1}姓名
                  </label>
                  <input
                    id={`member-${member.key}`}
                    value={member.name}
                    maxLength={80}
                    readOnly={!editing}
                    disabled={action.busy}
                    onChange={(event) =>
                      setMembers((previous) =>
                        previous.map((item) =>
                          item.key === member.key ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  {editing && (
                    <button
                      className="icon-button"
                      type="button"
                      disabled={action.busy}
                      aria-label={`移出成员${index + 1}`}
                      onClick={() =>
                        setMembers((previous) => previous.filter((item) => item.key !== member.key))
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editing && (
              <>
                <button
                  className="button registration-add-row"
                  type="button"
                  disabled={action.busy || members.length >= 60}
                  onClick={() =>
                    setMembers((previous) => [
                      ...previous,
                      { id: '', key: crypto.randomUUID(), name: '' },
                    ])
                  }
                >
                  <Plus size={16} />
                  添加成员
                </button>
                <p className="registration-hint">
                  移出成员会归档长期资料，已保存的报名快照仍保留原姓名。
                </p>
                <div className="registration-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      setMembers(team.members.map((member) => ({ ...member, key: member.id })));
                      setEditing(false);
                      setValidation('');
                      action.clear();
                    }}
                  >
                    取消
                  </button>
                  <button className="button button-primary" disabled={action.busy}>
                    <Save size={16} />
                    {action.busy ? '正在保存…' : '保存成员'}
                  </button>
                </div>
              </>
            )}
          </form>
        </section>
      </div>
      {team.capabilities.canInvite ? (
        <>
          <section className="panel registration-form-panel">
            <div className="section-heading">
              <div>
                <h2>邀请领队</h2>
                <p>请先让对方注册，将个人页面中的用户 ID 填入。邀请不会授予机构工作台权限。</p>
              </div>
              <UserPlus size={23} />
            </div>
            <form
              className="registration-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !targetUserId.trim() ||
                  !Number.isInteger(Number(expires)) ||
                  Number(expires) < 1 ||
                  Number(expires) > 168
                )
                  return;
                void action.run(async () => {
                  const issued = await api.invite(team.id, {
                    targetUserId: targetUserId.trim(),
                    expiresInHours: Number(expires),
                  });
                  onIssued(issued);
                  setTargetUserId('');
                  onReload();
                }, '邀请已创建');
              }}
            >
              <label>
                受邀用户 ID
                <input
                  value={targetUserId}
                  onChange={(event) => setTargetUserId(event.target.value)}
                  disabled={action.busy}
                  required
                  autoComplete="off"
                />
              </label>
              <label>
                有效小时数
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                  disabled={action.busy}
                  required
                />
              </label>
              <button
                className="button button-primary"
                disabled={action.busy || !targetUserId.trim()}
              >
                生成领队邀请
              </button>
            </form>
            <div className="registration-invitations">
              {invitations.length === 0 ? (
                <p className="registration-muted">尚未签发邀请。</p>
              ) : (
                invitations.map((invitation) => (
                  <div className="registration-invitation-row" key={invitation.id}>
                    <div>
                      <strong>{invitationStatus(invitation)}</strong>
                      <code>{invitation.targetUserId}</code>
                      <small>
                        到期：
                        {new Date(invitation.expiresAt).toLocaleString('zh-CN', {
                          timeZone: 'Asia/Shanghai',
                        })}
                      </small>
                    </div>
                    {invitation.capabilities.canRevoke && (
                      <button
                        className="button button-secondary"
                        disabled={action.busy}
                        onClick={() => {
                          void action.run(async () => {
                            await api.revoke(team.id, invitation.id);
                            onReload();
                          }, '邀请已撤销');
                        }}
                      >
                        撤销邀请
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="panel registration-form-panel">
            <div className="section-heading">
              <div>
                <h2>领队授权</h2>
                <p>撤销邀请不会撤销已接受的授权，请在此停用领队。</p>
              </div>
            </div>
            {team.grants.length === 0 ? (
              <p className="registration-muted">暂无领队授权。</p>
            ) : (
              team.grants.map((grant) => (
                <div className="registration-invitation-row" key={grant.userId}>
                  <div>
                    <code>{grant.userId}</code>
                    <span>{grant.status === 'ACTIVE' ? '领队 · 已启用' : '领队 · 已停用'}</span>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={action.busy}
                    onClick={() =>
                      setGrantTarget({
                        userId: grant.userId,
                        status: grant.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                  >
                    {grant.status === 'ACTIVE' ? '停用领队' : '恢复领队'}
                  </button>
                </div>
              ))
            )}
            {grantTarget && (
              <div className="registration-confirm">
                <h3>{grantTarget.status === 'DISABLED' ? '停用此领队？' : '恢复此领队？'}</h3>
                <p>
                  {grantTarget.status === 'DISABLED'
                    ? '停用后，对方现有登录会话也不能继续管理本队报名。'
                    : '恢复后，对方可管理本队报名，仍不能独立审核自己的报名。'}
                </p>
                <div className="registration-actions">
                  <button
                    className="button button-secondary"
                    disabled={action.busy}
                    onClick={() => setGrantTarget(undefined)}
                  >
                    取消
                  </button>
                  <button
                    className="button button-primary"
                    disabled={action.busy}
                    onClick={() => {
                      void action.run(async () => {
                        await api.grant(team.id, grantTarget.userId, grantTarget.status);
                        setGrantTarget(undefined);
                        onReload();
                      }, '领队授权已更新');
                    }}
                  >
                    确认{grantTarget.status === 'DISABLED' ? '停用' : '恢复'}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="registration-note">
          <ShieldCheck size={19} />
          <p>领队邀请与授权只能由机构负责人或管理员管理。</p>
        </div>
      )}
    </>
  );
}
