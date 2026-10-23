import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  CircleHelp,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import type {
  ScoringCommandPayload,
  ScoringSide,
  ScoringStatKind,
  ScoreSnapshot,
  ScoringCollectionMode,
  MatchPlayerRoster,
} from '@small-city-basketball/contracts';
import type { RegistrationWorkspace } from '../registration/shared';
import { PageHeading, ResourceState } from '../registration/shared';
import { createScoringApi } from '../api/scoring';
import { useWorkbench } from './useWorkbench';
import { Scoreboard } from './Scoreboard';
import { RulesSummary, StaffPanel } from './Management';
import { ClockDialog, CorrectionDialog, Modal } from './Dialogs';
import { localMoment, matchStatusLabels, shortUser } from './shared';
import { clockRemaining } from './clock';
import { PlayerSelector, PlayerStatisticsPanel } from './PlayerStatistics';
export function MatchWorkbench({
  context,
  matchId,
}: {
  context: RegistrationWorkspace & { organizationId: string };
  matchId: string;
}) {
  const api = useMemo(
    () => createScoringApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const model = useWorkbench(api, matchId);
  const [dialog, setDialog] = useState<
      'clock' | 'correction' | 'confirm' | 'reopen' | 'resolve' | null
    >(null),
    [reason, setReason] = useState(''),
    [reasonError, setReasonError] = useState('');
  useEffect(() => {
    if (model.pending) setDialog(null);
  }, [model.pending]);
  const [reviewedSnapshot, setReviewedSnapshot] = useState<ScoreSnapshot | null>(null);
  const [collectionMode, setCollectionMode] = useState<ScoringCollectionMode>('TEAM_ONLY');
  const [selectedPlayers, setSelectedPlayers] = useState({ HOME: '', AWAY: '' });
  useEffect(() => {
    setCollectionMode('TEAM_ONLY');
    setSelectedPlayers({ HOME: '', AWAY: '' });
  }, [matchId]);
  const wb = model.data?.workbench,
    snapshot = wb?.snapshot;
  const confirmationExpired = Boolean(
    reviewedSnapshot && snapshot && reviewedSnapshot.version !== snapshot.version,
  );
  const blocked = model.busy || !model.online || model.stale || Boolean(model.pending),
    hasControl = Boolean(model.lease && model.leaseRemaining > 0);
  const record = Boolean(wb?.capabilities.canRecord && hasControl && !blocked),
    correct = Boolean(wb?.capabilities.canCorrect && hasControl && !blocked);
  const pausedAtZero = Boolean(
    snapshot &&
    !snapshot.clock.running &&
    clockRemaining(snapshot.clock, snapshot.serverTime, 0) === 0,
  );
  const tied = Boolean(snapshot && snapshot.totals.home.score === snapshot.totals.away.score),
    overtimeTie = Boolean(snapshot?.rules.tiePolicy === 'OVERTIME' && tied);
  const finalPeriod = Boolean(
    snapshot && snapshot.clock.period >= snapshot.rules.regulationPeriods,
  );
  const modalBusy = model.busy;
  async function send(command: ScoringCommandPayload, controlled = true, expectedVersion?: number) {
    return model.send(command, controlled, expectedVersion);
  }
  async function stat(side: ScoringSide, kind: ScoringStatKind, value: number) {
    const roster = side === 'HOME' ? wb?.playerRoster?.home : wb?.playerRoster?.away;
    const memberId = roster?.some((player) => player.memberId === selectedPlayers[side])
      ? selectedPlayers[side]
      : null;
    await send({
      type: 'RECORD_STAT',
      payload: {
        side,
        kind,
        value,
        ...(snapshot?.playerStatistics && kind !== 'TIMEOUT' ? { memberId } : {}),
      },
    });
  }
  function open(value: typeof dialog) {
    if (value === 'confirm') setReviewedSnapshot(snapshot ?? null);
    setReason('');
    setReasonError('');
    setDialog(value);
  }
  return (
    <div className="score-page">
      <Link className="back-link" to="/scoring">
        <ChevronLeft size={16} />
        返回记分与赛果
      </Link>
      <PageHeading
        eyebrow="ONE COURT. ONE AUTHORITATIVE RECORD."
        title={wb ? `${wb.match.home.teamName} vs ${wb.match.away.teamName}` : '记分工作台'}
        description={
          wb
            ? `${wb.event.name} · ${wb.match.courtName} · ${localMoment(wb.match.startsAt)}`
            : '正在读取本场授权及资料'
        }
      >
        <button
          className="button button-secondary"
          disabled={model.busy}
          onClick={() => void model.refresh()}
        >
          <RefreshCw size={16} />
          重新读取比赛
        </button>
      </PageHeading>
      {!model.online && (
        <div className="score-note score-error" role="alert">
          <WifiOff size={20} />
          <p>网络已断开，新记分已停止。恢复连接后先核对权威资料；比赛时钟不会自动暂停。</p>
        </div>
      )}
      {model.error && (
        <div className="score-note score-error" role="alert">
          <p>{model.error} 当前输入保留，请重新读取并核对；未确认的操作不会显示为成功。</p>
        </div>
      )}
      {model.notice && (
        <div className="success-notice" role="status">
          {model.notice}
        </div>
      )}
      {model.pending && (
        <section className="score-unknown" role="alert">
          <h2>结果待核对</h2>
          <p>
            上次提交没有收到完整确认。比分可能已保存，请先查询原命令收据，不要重复点分。待核对期间已停止新写入。
          </p>
          <p>
            提交时间 {localMoment(model.pending.envelope.capturedAt)} · 核对编号{' '}
            {model.pending.envelope.commandId.slice(0, 8)}
            <br />
            {model.pending.problem}
          </p>
          <div className="score-actions">
            <button
              className="button button-primary"
              disabled={model.busy || !model.online}
              onClick={() => void model.checkPending()}
            >
              核对提交结果
            </button>
            {model.pending.checkedAbsent && (
              <button
                className="button button-secondary"
                disabled={!model.canRetry || model.busy}
                onClick={() => void model.retryPending()}
              >
                按原命令重试
              </button>
            )}
            <button
              className="button button-secondary"
              disabled={model.busy || !model.online || !model.pending.checkedAbsent}
              onClick={() => open('resolve')}
            >
              已人工核对，恢复操作
            </button>
          </div>
          {model.pending.checkedAbsent && !model.canRetry && (
            <p>
              当前版本或控制权已变化，不能安全重发原命令。请与现场记录核对；此处不会创建新命令代替原提交。
            </p>
          )}
        </section>
      )}
      {model.loading || !wb ? (
        <ResourceState
          loading={model.loading}
          error={model.error}
          reload={() => void model.refresh()}
        />
      ) : (
        <>
          {snapshot ? (
            <Scoreboard snapshot={snapshot} />
          ) : (
            <section className="panel score-empty">
              <TrophyMark />
              <span className="status-badge neutral">
                {matchStatusLabels[wb.match.status] ?? wb.match.status}
              </span>
              <h2>比赛尚未准备</h2>
              <p>
                请先设置本届规则、明确分配有效记分员，再准备比赛。尚未初始化比分，不显示模拟分数。
              </p>
              {wb.capabilities.canManageStaff && (
                <Link className="button button-secondary" to={`/events/${wb.event.id}/scoring`}>
                  配置赛事记分规则
                </Link>
              )}
              {wb.capabilities.canPrepare && (
                <label className="score-field score-collection-mode">
                  统计采集模式
                  <select
                    aria-label="统计采集模式"
                    value={collectionMode}
                    disabled={blocked}
                    onChange={(event) =>
                      setCollectionMode(event.target.value as ScoringCollectionMode)
                    }
                  >
                    <option value="TEAM_ONLY">球队记分</option>
                    {wb.playerRoster?.home.length > 0 && wb.playerRoster?.away.length > 0 && (
                      <option value="PLAYER_BASIC">逐人基础统计（得分、犯规）</option>
                    )}
                  </select>
                  <span className="score-muted">
                    准备后本场模式不可更改；逐人模式未选择球员的记录计入未归属。
                  </span>
                </label>
              )}
              {wb.capabilities.canPrepare && (
                <button
                  className="button button-primary"
                  disabled={blocked}
                  onClick={() =>
                    void send(
                      {
                        type: 'PREPARE_MATCH',
                        payload: {
                          expectedEventVersion: wb.event.version,
                          ...(collectionMode === 'PLAYER_BASIC' ? { collectionMode } : {}),
                        },
                      },
                      false,
                    )
                  }
                >
                  准备比赛
                </button>
              )}
            </section>
          )}
          {snapshot && (
            <>
              <section className="panel score-control">
                <div className="score-control-icon">
                  <LockKeyhole size={24} />
                  <div>
                    <h2>
                      {hasControl
                        ? '本页持有记分控制权'
                        : wb.lease.held
                          ? '另一页面正持有记分控制权'
                          : '当前为只读快照'}
                    </h2>
                    <p>
                      {hasControl
                        ? `约 ${Math.ceil(model.leaseRemaining / 1000)} 秒后到期 · 每10秒续期 · 刷新后需重新取得`
                        : '仅显式分配的记分员可取得控制权。断网或租约失效后停止新写入。'}
                    </p>
                  </div>
                </div>
                <div className="score-actions">
                  {hasControl ? (
                    <button
                      className="button button-secondary"
                      disabled={blocked}
                      onClick={() => void model.release()}
                    >
                      释放记分控制权
                    </button>
                  ) : wb.capabilities.canAcquireControl ? (
                    <button
                      className="button button-primary"
                      disabled={blocked}
                      onClick={() => void model.acquire()}
                    >
                      取得记分控制权
                    </button>
                  ) : (
                    <span className="score-state-chip">无本场记分授权</span>
                  )}
                </div>
              </section>
              {wb.match.status === 'READY' && wb.capabilities.canAcquireControl && (
                <section className="panel score-panel">
                  <h2>开场前最后一步</h2>
                  <p>开始比赛后，时钟仍保持暂停；请另行启动权威时钟。</p>
                  <button
                    className="button button-primary"
                    disabled={blocked || !hasControl}
                    onClick={() =>
                      void send({
                        type: 'START_MATCH',
                        payload: { expectedEventVersion: wb.event.version },
                      })
                    }
                  >
                    开始比赛
                  </button>
                </section>
              )}
              {(wb.capabilities.canRecord || wb.match.status === 'LIVE') && (
                <section className="score-stat-grid" aria-label="球队统计录入">
                  {(['HOME', 'AWAY'] as const).map((side) => (
                    <article className="panel score-stat-side" key={side}>
                      <h3>
                        {side === 'HOME' ? '主队' : '客队'} ·{' '}
                        {side === 'HOME' ? snapshot.home.teamName : snapshot.away.teamName}
                      </h3>
                      {snapshot.playerStatistics && (
                        <PlayerSelector
                          label={`${side === 'HOME' ? '主队' : '客队'}球员归属`}
                          players={side === 'HOME' ? wb.playerRoster.home : wb.playerRoster.away}
                          value={selectedPlayers[side]}
                          disabled={!record}
                          onChange={(memberId) =>
                            setSelectedPlayers((current) => ({ ...current, [side]: memberId }))
                          }
                        />
                      )}
                      <div className="score-point-buttons">
                        {snapshot.rules.allowedScoreValues.map((value) => (
                          <button
                            key={value}
                            disabled={!record}
                            aria-label={`${side === 'HOME' ? '主队' : '客队'}加${value}分`}
                            onClick={() => void stat(side, 'SCORE', value)}
                          >
                            +{value}
                            <small> 分</small>
                          </button>
                        ))}
                      </div>
                      <div className="score-minor-buttons">
                        <button
                          className="button button-secondary"
                          disabled={!record}
                          aria-label={`${side === 'HOME' ? '主队' : '客队'}犯规加1`}
                          onClick={() => void stat(side, 'FOUL', 1)}
                        >
                          犯规 +1
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={!record}
                          aria-label={`${side === 'HOME' ? '主队' : '客队'}暂停加1`}
                          onClick={() => void stat(side, 'TIMEOUT', 1)}
                        >
                          暂停 +1
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              )}
              {wb.match.status === 'LIVE' && (
                <section className="panel score-panel">
                  <h2>比赛时钟与节次</h2>
                  <p>计时来自服务器锚点。归零不会自动换节、结束或确认赛果；归零后仍需显式暂停。</p>
                  <div className="score-actions">
                    <button
                      className="button button-primary"
                      disabled={!record || snapshot.clock.running}
                      onClick={() => void send({ type: 'CLOCK_START', payload: {} })}
                    >
                      启动时钟
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!record || !snapshot.clock.running}
                      onClick={() => void send({ type: 'CLOCK_PAUSE', payload: {} })}
                    >
                      暂停时钟
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!record}
                      onClick={() => open('clock')}
                    >
                      校正时钟
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!record || !pausedAtZero || finalPeriod}
                      onClick={() => void send({ type: 'NEXT_PERIOD', payload: {} })}
                    >
                      下一节
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!record || !pausedAtZero || !finalPeriod || !overtimeTie}
                      onClick={() => void send({ type: 'START_OVERTIME', payload: {} })}
                    >
                      开始加时
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!record || !pausedAtZero || !finalPeriod || overtimeTie}
                      onClick={() => void send({ type: 'END_MATCH', payload: {} })}
                    >
                      结束计分
                    </button>
                  </div>
                  {overtimeTie && finalPeriod && <p>当前规则要求加时，平分时不能结束计分。</p>}
                </section>
              )}
              <section className="panel score-panel">
                <div className="section-heading">
                  <div>
                    <h2>核对、修正与赛果</h2>
                    <p>确认者必须独立于全部历史记分和当前参赛队领队。最终权限由服务端核验。</p>
                  </div>
                </div>
                <div className="score-actions">
                  {wb.capabilities.canCorrect && (
                    <button
                      className="button button-secondary"
                      disabled={!correct}
                      onClick={() => open('correction')}
                    >
                      修正比赛记录
                    </button>
                  )}
                  {wb.capabilities.canConfirm && (
                    <button
                      className="button button-primary"
                      disabled={blocked || overtimeTie}
                      onClick={() => open('confirm')}
                    >
                      确认当前赛果
                    </button>
                  )}
                  {wb.capabilities.canReopen && (
                    <button
                      className="button button-secondary"
                      disabled={blocked}
                      onClick={() => open('reopen')}
                    >
                      重开赛果
                    </button>
                  )}
                </div>
                {wb.match.status === 'PENDING_CONFIRMATION' && overtimeTie && (
                  <div className="score-note score-warning">
                    <CircleHelp size={19} />
                    <p>
                      加时规则下，修正后平局不能确认。当前保持待处理；本卡不支持返回比赛中补打，请联系赛事负责人核对。
                    </p>
                  </div>
                )}
                {snapshot.requiresReconfirmation && (
                  <p className="score-reason">旧正式结果已保留，当前版本等待重新确认。</p>
                )}
                {!wb.capabilities.canCorrect &&
                  !wb.capabilities.canConfirm &&
                  !wb.capabilities.canReopen && (
                    <p>当前身份无可用赛果操作；历史记分者及当前参赛队领队不可确认。</p>
                  )}
              </section>
              <section className="panel score-panel">
                <h2>本场规则与已采集统计</h2>
                <RulesSummary rules={snapshot.rules} />
                <div className="score-periods">
                  {snapshot.periods.map((period) => (
                    <div className="score-period" key={period.period}>
                      <strong>第{period.period}节</strong>
                      <span>
                        {period.home.score} : {period.away.score}
                      </span>
                      <span>
                        犯规 {period.home.fouls} : {period.away.fouls}
                      </span>
                      <span>
                        暂停 {period.home.timeouts} : {period.away.timeouts}
                      </span>
                    </div>
                  ))}
                </div>
                <p>
                  球员篮板、助攻及其他个人统计：未统计。犯规和暂停只累计，不推定罚球、配额或剩余次数。
                </p>
              </section>
              <PlayerStatisticsPanel
                statistics={snapshot.playerStatistics ?? null}
                homeName={snapshot.home.teamName}
                awayName={snapshot.away.teamName}
                official={Boolean(
                  snapshot.latestConfirmation &&
                  snapshot.status === 'FINAL' &&
                  !snapshot.requiresReconfirmation,
                )}
                needsConfirmation={snapshot.requiresReconfirmation}
              />
            </>
          )}
          <StaffPanel data={wb} busy={blocked} onSave={model.staff} />
          <section className="panel score-panel">
            <h2>比赛操作记录</h2>
            <p>按服务端顺序保留原始事件，撤销和替换不会删除原记录。</p>
            {model.data!.events.length ? (
              <ol className="score-records">
                {model.data!.events.map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>
                        记录 {event.seq} · {eventLabel(event.type, event.payload, wb.playerRoster)}
                      </strong>
                      <small>
                        {localMoment(event.serverTime)} · 操作者 {shortUser(event.actorId)}
                      </small>
                      {typeof event.payload.reason === 'string' && (
                        <div className="score-reason">{event.payload.reason}</div>
                      )}
                    </div>
                    {event.type === 'STAT_VOIDED' && (
                      <span className="score-state-chip">已撤销原统计</span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p>暂无比赛操作记录。</p>
            )}
          </section>
          <section className="panel score-panel">
            <h2>正式赛果历史</h2>
            {model.data!.confirmations.length ? (
              <ol className="score-records">
                {model.data!.confirmations.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.home.score} : {item.away.score}
                      </strong>
                      <small>
                        {localMoment(item.confirmedAt)} · 确认人 {shortUser(item.confirmingUserId)}{' '}
                        · 核对版本 {item.sourceMatchVersion}
                      </small>
                      {item.playerStatistics && (
                        <details className="score-history-players">
                          <summary>查看确认时个人统计</summary>
                          <PlayerStatisticsPanel
                            statistics={item.playerStatistics}
                            homeName={wb.match.home.teamName}
                            awayName={wb.match.away.teamName}
                            title={`确认版本${item.sourceMatchVersion}个人统计`}
                            official
                          />
                        </details>
                      )}
                    </div>
                    <span className="score-state-chip">
                      {snapshot?.latestConfirmation?.id === item.id &&
                      !snapshot.requiresReconfirmation &&
                      wb.match.status === 'FINAL'
                        ? '当前正式结果'
                        : '历史确认 · 保留'}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>尚无正式确认。结束计分不等于确认赛果。</p>
            )}
          </section>
          <div className="score-note">
            <ShieldCheck size={19} />
            <p>
              此页为私有认证快照。当前不开放匿名观赛、正式榜单、可靠离线队列或OBS；页面销毁后不承诺恢复未确认命令，重新进入需核对权威记录。
            </p>
          </div>
        </>
      )}
      {snapshot && dialog === 'clock' && !model.pending && (
        <ClockDialog
          snapshot={snapshot}
          busy={modalBusy}
          disabled={!record}
          error={model.error}
          onSubmit={(command) => send(command)}
          onClose={() => setDialog(null)}
        />
      )}
      {snapshot && dialog === 'correction' && !model.pending && (
        <CorrectionDialog
          snapshot={snapshot}
          playerRoster={wb?.playerRoster}
          events={model.data!.events}
          busy={modalBusy}
          disabled={!correct}
          error={model.error}
          onSubmit={(command) => send(command)}
          onClose={() => setDialog(null)}
        />
      )}
      {snapshot && reviewedSnapshot && dialog === 'confirm' && !model.pending && (
        <Modal title="确认当前赛果" busy={modalBusy} onClose={() => setDialog(null)}>
          <p>
            确认精确当前版本。服务器会重放事件核对；历史记分者、当前主写者或当前参赛队领队均不可确认。
          </p>
          {model.error && (
            <div className="score-note score-error" role="alert">
              {model.error}
            </div>
          )}
          <div className="score-confirm-summary">
            <strong>
              {reviewedSnapshot.home.teamName} {reviewedSnapshot.totals.home.score} :{' '}
              {reviewedSnapshot.totals.away.score} {reviewedSnapshot.away.teamName}
            </strong>
            <span>
              资料版本 {reviewedSnapshot.version} · 规则版本 {reviewedSnapshot.rules.version}
            </span>
            <span>
              全场犯规 {reviewedSnapshot.totals.home.fouls} : {reviewedSnapshot.totals.away.fouls} ·
              全场暂停 {reviewedSnapshot.totals.home.timeouts} :{' '}
              {reviewedSnapshot.totals.away.timeouts}
            </span>
          </div>
          {reviewedSnapshot.playerStatistics && (
            <PlayerStatisticsPanel
              statistics={reviewedSnapshot.playerStatistics}
              homeName={reviewedSnapshot.home.teamName}
              awayName={reviewedSnapshot.away.teamName}
              title="本次核对的个人统计"
              needsConfirmation={reviewedSnapshot.requiresReconfirmation}
            />
          )}
          {confirmationExpired && (
            <div className="score-note score-warning" role="alert">
              待确认赛果版本已变化，请关闭后重新核对。此确认框保留打开时的比分，不会替换为新版本。
            </div>
          )}
          <div className="score-actions">
            <button
              className="button button-primary"
              disabled={
                blocked || overtimeTie || confirmationExpired || !wb?.capabilities.canConfirm
              }
              onClick={() =>
                void send(
                  { type: 'CONFIRM_RESULT', payload: {} },
                  false,
                  reviewedSnapshot.version,
                ).then((ok) => {
                  if (ok && model.isActive()) setDialog(null);
                })
              }
            >
              正式确认赛果
            </button>
            <button
              className="button button-secondary"
              disabled={model.busy}
              onClick={() => setDialog(null)}
            >
              取消确认
            </button>
          </div>
        </Modal>
      )}
      {snapshot && dialog === 'reopen' && !model.pending && (
        <Modal title="重开赛果" busy={modalBusy} onClose={() => setDialog(null)}>
          <p>原正式结果保留并标记待重新确认；不会回到比赛进行中。</p>
          <label className="score-field">
            重开理由
            <textarea
              aria-label="重开理由"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {(reasonError || model.error) && (
            <div className="score-note score-error" role="alert">
              {reasonError || model.error}
            </div>
          )}
          <div className="score-actions">
            <button
              className="button button-primary"
              disabled={blocked}
              onClick={() => {
                if (!reason.trim()) {
                  setReasonError('请填写重开理由');
                  return;
                }
                void send(
                  { type: 'REOPEN_RESULT', payload: { reason: reason.trim() } },
                  false,
                ).then((ok) => {
                  if (ok && model.isActive()) setDialog(null);
                });
              }}
            >
              确认重开赛果
            </button>
            <button
              className="button button-secondary"
              disabled={model.busy}
              onClick={() => setDialog(null)}
            >
              取消重开
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'resolve' && model.pending && (
        <Modal title="人工核对未确认命令" busy={model.busy} onClose={() => setDialog(null)}>
          <p>
            找不到收据不代表提交已永久失败。请与现场记录、最新比分及操作历史核对，确认不需要再发送原命令后恢复。此动作不增减分数，也不会自动重发。
          </p>
          <div className="score-actions">
            <button
              className="button button-primary"
              disabled={model.busy || !model.online}
              onClick={() =>
                void model.acknowledgePending().then(() => {
                  if (model.isActive()) setDialog(null);
                })
              }
            >
              确认已核对，恢复操作
            </button>
            <button
              className="button button-secondary"
              disabled={model.busy}
              onClick={() => setDialog(null)}
            >
              继续核对
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function TrophyMark() {
  return <ShieldCheck size={32} />;
}
function eventLabel(type: string, payload: Record<string, unknown>, roster?: MatchPlayerRoster) {
  const labels: Record<string, string> = {
    PREPARE_MATCH: '准备比赛',
    START_MATCH: '开始比赛',
    STAT_VOIDED: '撤销统计',
    CLOCK_START: '启动时钟',
    CLOCK_PAUSE: '暂停时钟',
    CLOCK_SET: '校正时钟',
    NEXT_PERIOD: '进入下一节',
    START_OVERTIME: '开始加时',
    END_MATCH: '结束计分',
    CONFIRM_RESULT: '确认赛果',
    REOPEN_RESULT: '重开赛果',
  };
  if (type === 'STAT_RECORDED') {
    const players = payload.side === 'HOME' ? roster?.home : roster?.away;
    const player = players?.find((item) => item.memberId === payload.memberId);
    const attribution = player
      ? ` · ${player.jerseyNo}号 ${player.name}`
      : payload.memberId === null
        ? ' · 未归属球员'
        : '';
    return `第${String(payload.period)}节 ${payload.side === 'HOME' ? '主队' : '客队'}${payload.kind === 'SCORE' ? '得分' : payload.kind === 'FOUL' ? '犯规' : '暂停'} +${String(payload.value)}${attribution}`;
  }
  return labels[type] ?? '比赛状态操作';
}
