import { useEffect, useRef, useState } from 'react';
import type { CourtData, ScheduleRevisionData } from '@small-city-basketball/contracts';
import { suggestSchedule } from './auto-schedule';
import type { ScheduleSuggestion } from './auto-schedule';
import { fixtureLabel, offsetTime, timeLabel } from './shared';

export interface LocalAllocation {
  fixtureKey: string;
  courtId: string;
  localStart: string;
}
const reasons: Record<ScheduleSuggestion['unassigned'][number]['reason'], string> = {
  NO_WINDOW: '没有符合赛事日期的启用场地窗口',
  NO_SLOT: '本轮建议未找到满足时长、球队休息及日期间隔的安排，可手工调整后重试',
  LIMIT_REACHED: '计算已达上限，尚未完成此场搜索',
  CANCELLED: '计算已取消',
};

export function AutoScheduleSuggestions({
  revision,
  courts,
  allocations,
  eventDates,
  disabled,
  onBusyChange,
  onAdopt,
}: {
  revision: ScheduleRevisionData;
  courts: CourtData[];
  allocations: LocalAllocation[];
  eventDates: { startDate: string; endDate: string };
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdopt: (suggestion: ScheduleSuggestion['allocations']) => void;
}) {
  const [result, setResult] = useState<ScheduleSuggestion>();
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const base = useRef('');
  const source = JSON.stringify([
    revision.id,
    revision.version,
    revision.eventVersion,
    eventDates,
    allocations,
    courts.map(({ id, status }) => [id, status]),
  ]);
  useEffect(() => {
    setResult(undefined);
    setNotice('');
    setError('');
    return () => {
      controller.current?.abort();
    };
  }, [source]);
  useEffect(() => {
    if (disabled) controller.current?.abort();
  }, [disabled]);

  async function generate() {
    if (disabled || controller.current) return;
    const current = new AbortController();
    controller.current = current;
    base.current = source;
    setResult(undefined);
    setError('');
    setNotice('');
    setComputing(true);
    onBusyChange(true);
    try {
      const suggestion = await suggestSchedule(
        {
          fixtures: revision.fixtures,
          policy: revision.policy,
          courts,
          eventDates,
          allocations: allocations.map((item) => ({
            fixtureKey: item.fixtureKey,
            courtId: item.courtId || null,
            startsAt: item.localStart ? offsetTime(item.localStart) : null,
          })),
        },
        { signal: current.signal },
      );
      if (controller.current === current && !current.signal.aborted) setResult(suggestion);
    } catch (cause) {
      if (controller.current === current && !current.signal.aborted)
        setError(cause instanceof Error ? cause.message : '建议生成失败，请手工安排。');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setComputing(false);
        onBusyChange(false);
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    setResult(undefined);
    setNotice('已取消建议计算，原有安排未改变。');
  }
  const participants = new Map(revision.participants.map((item) => [item.entryId, item.teamName]));
  function label(key: string) {
    const fixture = revision.fixtures.find((item) => item.fixtureKey === key);
    return fixture
      ? `${fixtureLabel(fixture)} · ${participants.get(fixture.homeEntryId) ?? '已冻结球队'} VS ${participants.get(fixture.awayEntryId) ?? '已冻结球队'}`
      : '本版比赛';
  }
  return (
    <section className="sc-suggestions" aria-label="自动排时建议">
      <div className="section-heading">
        <div>
          <h3>自动排时建议</h3>
          <p>保留所有已填安排（含未保存修改），仅补未分配场次。生成和采用均不会自动保存或发布。</p>
        </div>
        {computing ? (
          <button className="button button-secondary" type="button" onClick={cancel}>
            取消计算
          </button>
        ) : (
          <button
            className="button button-secondary"
            type="button"
            disabled={disabled || allocations.every((item) => item.courtId && item.localStart)}
            onClick={() => void generate()}
          >
            生成排时建议
          </button>
        )}
      </div>
      <p className="sc-hint">
        按本版窗口、场地和球队休息规则生成有界建议；其他赛事占用仍须保存后交服务端检查。建议不保证最优或全部可排。
      </p>
      {computing && <p role="status">正在生成建议，可随时取消…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div className="sc-error" role="alert">
          {error}
        </div>
      )}
      {result && base.current === source && (
        <section className="sc-suggestion-preview" aria-label="排时建议预览">
          <h4>
            建议{result.allocations.length}场 · 保留{result.preservedCount}场 · 未排
            {result.unassigned.length}场
          </h4>
          {result.status === 'LIMIT_REACHED' && (
            <p role="status">
              已达计算上限，只提供已完成检查的建议；剩余场次尚未搜索完成，不代表无可行安排。
            </p>
          )}
          <div className="sc-suggestion-list">
            {result.allocations.map((item) => (
              <article key={item.fixtureKey}>
                <strong>{label(item.fixtureKey)}</strong>
                <span>
                  {courts.find((court) => court.id === item.courtId)?.name ?? '启用场地'} ·{' '}
                  {timeLabel(item.startsAt)}
                </span>
              </article>
            ))}
            {result.unassigned.map((item) => (
              <article key={item.fixtureKey} className="sc-suggestion-unassigned">
                <strong>{label(item.fixtureKey)}</strong>
                <span>{reasons[item.reason]}</span>
              </article>
            ))}
          </div>
          <div className="sc-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={disabled || computing || !result.allocations.length}
              onClick={() => {
                if (base.current === source) onAdopt(result.allocations);
              }}
            >
              采用{result.allocations.length}场建议到本地
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled || computing}
              onClick={() => setResult(undefined)}
            >
              放弃建议
            </button>
          </div>
          <p className="sc-hint">采用后请保存全部安排，再检查赛程冲突；检查通过后才可显式发布。</p>
        </section>
      )}
    </section>
  );
}
