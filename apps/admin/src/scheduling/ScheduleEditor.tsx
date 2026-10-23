import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, LockKeyhole, Save, Search, X } from 'lucide-react';
import type {
  CourtData,
  ScheduleConflict,
  ScheduleConflictCode,
  ScheduleRevisionData,
  ScheduleValidationData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { scheduleConflicts } from '../api/scheduling';
import type { SchedulingApi } from '../api/scheduling';
import type { useAction } from '../registration/shared';
import { fixtureLabel, localInput, offsetTime, timeLabel } from './shared';
import { PolicySummary } from './PolicyForm';
import { AutoScheduleSuggestions } from './AutoScheduleSuggestions';

type Allocation = { fixtureKey: string; courtId: string; localStart: string };
export const conflictTitles: Record<ScheduleConflictCode, string> = {
  UNASSIGNED: '尚未安排场地和时间',
  OUTSIDE_WINDOW: '比赛未完整落在可用窗口',
  OUTSIDE_EVENT_DATES: '比赛超出赛事日期',
  COURT_DISABLED: '使用了已停用场地',
  COURT_OVERLAP: '场地时间重叠',
  TEAM_OVERLAP: '球队比赛时间重叠',
  MIN_REST: '球队休息时间不足',
  MIN_LOCAL_DAY_GAP: '球队开赛日期间隔不足',
};
function snapshot(allocations: Allocation[]) {
  return JSON.stringify(
    allocations.map((item) => [item.fixtureKey, item.courtId, item.localStart]),
  );
}
export function ScheduleEditor({
  revision,
  courts,
  api,
  action,
  onReload,
  published,
  historical,
  eventDates,
}: {
  revision: ScheduleRevisionData;
  courts: CourtData[];
  api: SchedulingApi;
  action: ReturnType<typeof useAction>;
  onReload: () => void;
  published: boolean;
  historical: boolean;
  eventDates: { startDate: string; endDate: string };
}) {
  const original = useMemo(
    () =>
      revision.fixtures.map((fixture) => ({
        fixtureKey: fixture.fixtureKey,
        courtId: fixture.courtId ?? '',
        localStart: localInput(fixture.startsAt),
      })),
    [revision],
  );
  const [allocations, setAllocations] = useState(original);
  const [round, setRound] = useState('all');
  const [validation, setValidation] = useState<ScheduleValidationData>();
  const [publishConflicts, setPublishConflicts] = useState<ScheduleConflict[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const busy = action.busy || suggesting;
  const cards = useRef<Record<string, HTMLElement | null>>({});
  const dirty = snapshot(allocations) !== snapshot(original);
  const editable = revision.isCurrent && revision.status === 'DRAFT' && !published && !historical;
  const canEdit = editable && revision.capabilities.canEditAllocations;
  const canValidate = editable && revision.capabilities.canValidate;
  const canPublish = editable && revision.capabilities.canPublish;
  const valid =
    !publishConflicts.length &&
    validation?.valid === true &&
    validation.revisionId === revision.id &&
    validation.expectedEventVersion === revision.eventVersion &&
    validation.expectedRevisionVersion === revision.version &&
    !dirty;
  const conflicts = publishConflicts.length ? publishConflicts : (validation?.conflicts ?? []);
  const participants = new Map(revision.participants.map((item) => [item.entryId, item.teamName]));
  const assigned = allocations.filter((item) => item.courtId && item.localStart).length;
  const versions = {
    expectedEventVersion: revision.eventVersion,
    expectedRevisionVersion: revision.version,
  };
  function change(key: string, update: Partial<Allocation>) {
    setAllocations((previous) =>
      previous.map((item) => (item.fixtureKey === key ? { ...item, ...update } : item)),
    );
    setValidation(undefined);
    setPublishConflicts([]);
    setConfirming(false);
    setError('');
    action.clear();
  }
  function reset() {
    setAllocations(original);
    setValidation(undefined);
    setPublishConflicts([]);
    setConfirming(false);
    setError('');
    action.clear();
  }
  async function save() {
    setError('');
    try {
      const input = allocations.map((item) => {
        if (!item.courtId && !item.localStart)
          return { fixtureKey: item.fixtureKey, courtId: null, startsAt: null };
        const fixture = revision.fixtures.find(
          (fixture) => fixture.fixtureKey === item.fixtureKey,
        )!;
        if (!item.courtId || !item.localStart)
          throw new Error(`${fixtureLabel(fixture)}需同时填写场地和开始时间，或取消该场分配。`);
        let startsAt: string;
        try {
          startsAt = offsetTime(item.localStart);
        } catch {
          throw new Error(`${fixtureLabel(fixture)}开始时间无效，请核对日历日期。`);
        }
        return { fixtureKey: item.fixtureKey, courtId: item.courtId, startsAt };
      });
      await action.run(async () => {
        await api.allocations(revision.id, { ...versions, allocations: input });
        onReload();
      }, '全部安排已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请检查场地和时间。');
    }
  }
  async function check() {
    setValidation(undefined);
    setPublishConflicts([]);
    setConfirming(false);
    await action.run(async () => {
      const result = await api.validate(revision.id, versions);
      if (
        result.revisionId !== revision.id ||
        result.expectedEventVersion !== revision.eventVersion ||
        result.expectedRevisionVersion !== revision.version
      )
        throw new ApiError(409, 'VERSION_CONFLICT', '检查结果对应的资料已变化，请重新读取后再检查');
      if (action.isActive()) setValidation(result);
    }, '赛程检查已完成');
  }
  async function publish() {
    if (!valid || dirty || !canPublish) return;
    setPublishConflicts([]);
    await action.run(async () => {
      try {
        await api.publish(revision.id, versions);
        onReload();
      } catch (cause) {
        setValidation(undefined);
        if (cause instanceof ApiError) {
          const found = scheduleConflicts(cause.details?.conflicts);
          if (found) setPublishConflicts(found);
        }
        setConfirming(false);
        throw cause;
      }
    }, '正式赛程已发布');
  }
  function locate(key: string) {
    const fixture = revision.fixtures.find((item) => item.fixtureKey === key);
    if (!fixture) return;
    setRound(String(fixture.roundNo));
    window.requestAnimationFrame(() => {
      const card = cards.current[key];
      card?.scrollIntoView?.({ block: 'center' });
      card?.focus({ preventScroll: true });
    });
  }
  function projectedEnd(value: string) {
    if (!value) return '尚未安排';
    try {
      return timeLabel(
        new Date(
          Date.parse(offsetTime(value)) + revision.policy.slotDurationMinutes * 60000,
        ).toISOString(),
      );
    } catch {
      return '请填写有效开赛时间';
    }
  }
  const starts = revision.fixtures.flatMap((item) => (item.startsAt ? [item.startsAt] : [])).sort();
  const ends = revision.fixtures.flatMap((item) => (item.endsAt ? [item.endsAt] : [])).sort();
  return (
    <>
      <PolicySummary policy={revision.policy} courts={courts} />
      <section className="panel sc-panel">
        <div className="section-heading">
          <div>
            <h2>{published ? '原始发布快照' : historical ? '历史对阵与安排' : '按轮安排比赛'}</h2>
            <p>
              {revision.algorithmVersion === 'SE_SEEDED_V1'
                ? '首轮实际比赛'
                : `${revision.rounds.length}轮`}{' '}
              · {revision.fixtures.length}场 · {assigned}场
              {dirty ? '已在本地配置，尚未保存' : '已有保存安排'}。时间统一为中国标准时间。
            </p>
          </div>
          <label className="sc-round-select">
            查看轮次
            <select value={round} onChange={(event) => setRound(event.target.value)}>
              <option value="all">全部轮次</option>
              {revision.rounds.map((item) => (
                <option key={item.roundNo} value={String(item.roundNo)}>
                  第{item.roundNo}轮
                </option>
              ))}
            </select>
          </label>
        </div>
        {dirty && (
          <div className="sc-unsaved" role="status">
            <AlertTriangle size={18} />
            <span>
              本地修改未保存。请保存全部安排后再检查或发布；切换页面或重新生成对阵会丢失未保存内容。
            </span>
          </div>
        )}
        {error && (
          <div className="sc-error" role="alert">
            {error}
          </div>
        )}
        {canEdit && (
          <AutoScheduleSuggestions
            revision={revision}
            courts={courts}
            allocations={allocations}
            eventDates={eventDates}
            disabled={action.busy}
            onBusyChange={setSuggesting}
            onAdopt={(suggestions) => {
              const proposed = new Map(suggestions.map((item) => [item.fixtureKey, item]));
              setAllocations((previous) =>
                previous.map((item) => {
                  const suggestion = proposed.get(item.fixtureKey);
                  return !item.courtId && !item.localStart && suggestion
                    ? {
                        fixtureKey: item.fixtureKey,
                        courtId: suggestion.courtId,
                        localStart: localInput(suggestion.startsAt),
                      }
                    : item;
                }),
              );
              setValidation(undefined);
              setPublishConflicts([]);
              setConfirming(false);
              setError('');
              action.clear();
            }}
          />
        )}
        {revision.rounds
          .filter(
            (item) =>
              (round === 'all' || String(item.roundNo) === round) &&
              (revision.algorithmVersion !== 'SE_SEEDED_V1' ||
                revision.fixtures.some((f) => f.roundNo === item.roundNo) ||
                Boolean(item.byeEntryIds?.length)),
          )
          .map((item) => (
            <section className="sc-round" key={item.roundNo}>
              <div className="sc-round-heading">
                <h3>第{item.roundNo}轮</h3>
                {item.byeEntryIds && item.byeEntryIds.length > 0 && (
                  <span>
                    {item.byeEntryIds.map((id) => participants.get(id) ?? '已冻结球队').join('、')}{' '}
                    本轮轮空（无比赛）
                  </span>
                )}
                {!item.byeEntryIds && item.byeEntryId && (
                  <span>{participants.get(item.byeEntryId) ?? '已冻结球队'} 本轮轮空</span>
                )}
              </div>
              <div className="sc-fixture-grid">
                {revision.fixtures
                  .filter((fixture) => fixture.roundNo === item.roundNo)
                  .map((fixture) => {
                    const allocation = allocations.find(
                      (item) => item.fixtureKey === fixture.fixtureKey,
                    )!;
                    const label = fixtureLabel(fixture);
                    return (
                      <article
                        key={fixture.fixtureKey}
                        className={`sc-fixture ${conflicts.some((conflict) => conflict.fixtureKeys.includes(fixture.fixtureKey)) ? 'has-conflict' : ''}`}
                        ref={(element) => {
                          cards.current[fixture.fixtureKey] = element;
                        }}
                        tabIndex={-1}
                      >
                        <div className="sc-fixture-heading">
                          <span>{label}</span>
                          <strong>
                            {allocation.courtId && allocation.localStart ? '已安排' : '未分配'}
                          </strong>
                        </div>
                        <div className="sc-matchup">
                          <strong>{participants.get(fixture.homeEntryId) ?? '已冻结球队'}</strong>
                          <span>VS</span>
                          <strong>{participants.get(fixture.awayEntryId) ?? '已冻结球队'}</strong>
                        </div>
                        {canEdit ? (
                          <>
                            <div className="sc-allocation-fields">
                              <label>
                                比赛场地
                                <select
                                  aria-label={`${label} 场地`}
                                  value={allocation.courtId}
                                  disabled={busy}
                                  onChange={(event) =>
                                    change(
                                      fixture.fixtureKey,
                                      event.target.value
                                        ? { courtId: event.target.value }
                                        : { courtId: '', localStart: '' },
                                    )
                                  }
                                >
                                  <option value="">暂不分配</option>
                                  {courts.map((court) => (
                                    <option key={court.id} value={court.id}>
                                      {court.name}
                                      {court.status === 'DISABLED' ? '（已停用）' : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                开始时间
                                <input
                                  aria-label={`${label} 开始时间`}
                                  type="datetime-local"
                                  step="0.001"
                                  value={allocation.localStart}
                                  disabled={busy}
                                  onChange={(event) =>
                                    change(fixture.fixtureKey, { localStart: event.target.value })
                                  }
                                />
                              </label>
                            </div>
                            <div className="sc-fixture-end">
                              <span>预计结束：{projectedEnd(allocation.localStart)}</span>
                              <button
                                type="button"
                                className="button sc-clear-allocation"
                                disabled={busy || (!allocation.courtId && !allocation.localStart)}
                                onClick={() =>
                                  change(fixture.fixtureKey, { courtId: '', localStart: '' })
                                }
                                aria-label={`${label} 取消分配`}
                              >
                                <X size={14} />
                                取消分配
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="sc-readonly-allocation">
                            <span>
                              {courts.find((court) => court.id === fixture.courtId)?.name ??
                                (fixture.courtId ? '已记录场地' : '未分配场地')}
                            </span>
                            <strong>{timeLabel(fixture.startsAt)}</strong>
                            <small>预计结束：{timeLabel(fixture.endsAt)}</small>
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </section>
          ))}
        {canEdit && (
          <div className="sc-actions sc-editor-actions">
            <button className="button button-secondary" disabled={busy || !dirty} onClick={reset}>
              取消本地修改
            </button>
            <button
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                void save();
              }}
            >
              <Save size={16} />
              {action.busy ? '正在处理…' : '保存全部安排'}
            </button>
          </div>
        )}
      </section>
      {(canValidate || conflicts.length > 0 || validation) && (
        <section className="panel sc-panel">
          <div className="section-heading">
            <div>
              <h2>赛程冲突检查</h2>
              <p>检查已保存的安排，同时核对机构内其他正式赛程的场地和球队占用。</p>
            </div>
            {canValidate && (
              <button
                className="button button-secondary"
                disabled={busy || dirty}
                onClick={() => {
                  void check();
                }}
              >
                <Search size={16} />
                检查赛程冲突
              </button>
            )}
          </div>
          {dirty ? (
            <p className="sc-hint">安排尚未保存，原检查结果已失效，请先保存全部安排。</p>
          ) : valid ? (
            <div className="sc-check-passed" role="status">
              <CheckCheck size={23} />
              <div>
                <strong>当前版本检查通过</strong>
                <p>
                  检查于{timeLabel(validation!.checkedAt)}完成。正式发布时仍会再次核验最新占用。
                </p>
              </div>
            </div>
          ) : conflicts.length ? (
            <div className="sc-conflict-list" role="alert">
              <h3>发现{conflicts.length}项待解决问题</h3>
              {conflicts.map((conflict, index) => (
                <div className="sc-conflict" key={`${conflict.code}:${index}`}>
                  <AlertTriangle size={19} />
                  <div>
                    <strong>{conflictTitles[conflict.code]}</strong>
                    {conflict.external && <p>与机构内其他已发布比赛的占用冲突，请调整本方安排。</p>}
                    <div className="sc-conflict-links">
                      {conflict.fixtureKeys.map((key) => {
                        const fixture = revision.fixtures.find((item) => item.fixtureKey === key);
                        return fixture ? (
                          <button
                            key={key}
                            className="button button-secondary"
                            onClick={() => locate(key)}
                          >
                            定位{fixtureLabel(fixture)}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="sc-hint">
              尚未检查当前版本。未分配、时间越界、场地或球队重叠、休息不足都会阻止发布。
            </p>
          )}
        </section>
      )}
      {canPublish && (
        <section className="sc-publish-panel">
          <LockKeyhole size={25} />
          <div>
            <h2>发布正式赛程</h2>
            <p>
              发布后将锁定本次安排，生成{revision.fixtures.length}场正式比赛。此版本将只读保留。
            </p>
          </div>
          <button
            className="button button-primary"
            disabled={busy || dirty || !valid}
            onClick={() => setConfirming(true)}
          >
            发布正式赛程
          </button>
        </section>
      )}
      {confirming && valid && (
        <section className="sc-confirm" aria-label="正式发布确认">
          <h2>确认发布这份赛程？</h2>
          <div className="sc-confirm-summary">
            <span>
              <strong>{revision.participants.length}</strong>支冻结球队
            </span>
            <span>
              {revision.algorithmVersion === 'SE_SEEDED_V1' ? (
                <strong>淘汰赛首轮</strong>
              ) : (
                <>
                  <strong>{revision.rounds.length}</strong>轮单循环
                </>
              )}
            </span>
            <span>
              <strong>{revision.fixtures.length}</strong>场正式比赛
            </span>
            <span>
              <strong>{new Set(revision.fixtures.map((item) => item.courtId)).size}</strong>
              个共享场地
            </span>
          </div>
          <p>
            {timeLabel(starts[0] ?? null)} 至 {timeLabel(ends.at(-1) ?? null)} · 中国标准时间
          </p>
          <p>
            每场占用{revision.policy.slotDurationMinutes}分钟，最少休息
            {revision.policy.minRestMinutes}分钟，最小日期间隔{revision.policy.minLocalDayGap}
            天。名单以已冻结版本为准。
          </p>
          <p>
            {revision.algorithmVersion === 'SE_SEEDED_V1'
              ? '本次只发布首轮实际比赛。之后须在晋级页核对当前独立确认赛果，再显式发布下一轮。轮空不生成比赛。'
              : '发布会使赛事进入待开赛状态。发布后本版本只读，不能重新生成或重复发布；符合条件的单场改期由独立记录追踪。'}
          </p>
          <div className="sc-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              className="button button-primary"
              disabled={busy || dirty || !valid}
              onClick={() => {
                void publish();
              }}
            >
              {action.busy ? '正在发布…' : '确认发布正式赛程'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
