import { useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CourtData, SchedulePolicy } from '@small-city-basketball/contracts';
import { localInput, offsetTime, timeLabel } from './shared';

export function PolicyForm({
  courts,
  initial,
  knockout = false,
  redraw,
  busy,
  onSave,
  onCancel,
}: {
  courts: CourtData[];
  initial?: SchedulePolicy;
  knockout?: boolean;
  redraw: boolean;
  busy: boolean;
  onSave: (policy: SchedulePolicy, reason?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [duration, setDuration] = useState(initial ? String(initial.slotDurationMinutes) : '');
  const [rest, setRest] = useState(initial ? String(initial.minRestMinutes) : '');
  const [dayGap, setDayGap] = useState(initial ? String(initial.minLocalDayGap) : '');
  const [windows, setWindows] = useState(() =>
    initial
      ? initial.courtWindows.map((window) => ({
          ...window,
          key: crypto.randomUUID(),
          startsAt: localInput(window.startsAt),
          endsAt: localInput(window.endsAt),
        }))
      : [{ key: crypto.randomUUID(), courtId: '', startsAt: '', endsAt: '' }],
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  function update(key: string, field: 'courtId' | 'startsAt' | 'endsAt', value: string) {
    setWindows((previous) =>
      previous.map((item) => (item.key === key ? { ...item, [field]: value } : item)),
    );
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const numbers = [duration, rest, dayGap];
      if (numbers.some((value) => !value.trim()))
        throw new Error('请明确填写占用时长、休息分钟和日期间隔；无间隔时请填写0。');
      const [slotDurationMinutes, minRestMinutes, minLocalDayGap] = numbers.map(Number);
      if (
        !Number.isInteger(slotDurationMinutes) ||
        slotDurationMinutes < 1 ||
        slotDurationMinutes > 1440
      )
        throw new Error('每场占用分钟需为1–1440的整数。');
      if (!Number.isInteger(minRestMinutes) || minRestMinutes < 0 || minRestMinutes > 43200)
        throw new Error('最少休息分钟需为0–43200的整数。');
      if (!Number.isInteger(minLocalDayGap) || minLocalDayGap < 0 || minLocalDayGap > 365)
        throw new Error('最小日期间隔需为0–365的整数。');
      if (!windows.length || windows.length > 200) throw new Error('请设置1–200个可用时间窗口。');
      const courtWindows = windows.map((window, index) => {
        if (!window.courtId) throw new Error(`请选择窗口${index + 1}场地。`);
        let startsAt: string, endsAt: string;
        try {
          startsAt = offsetTime(window.startsAt);
          endsAt = offsetTime(window.endsAt);
        } catch {
          throw new Error(`窗口${index + 1}的日期时间无效，请检查开始与结束时间。`);
        }
        if (Date.parse(startsAt) >= Date.parse(endsAt))
          throw new Error(`窗口${index + 1}结束时间必须晚于开始时间。`);
        return { courtId: window.courtId, startsAt, endsAt };
      });
      for (let i = 0; i < courtWindows.length; i++)
        for (let j = i + 1; j < courtWindows.length; j++) {
          const a = courtWindows[i]!,
            b = courtWindows[j]!;
          if (
            a.courtId === b.courtId &&
            Date.parse(a.startsAt) < Date.parse(b.endsAt) &&
            Date.parse(b.startsAt) < Date.parse(a.endsAt)
          )
            throw new Error(`同一场地的窗口${i + 1}与窗口${j + 1}重叠，请调整。`);
        }
      if (redraw && (!reason.trim() || Array.from(reason.trim()).length > 500))
        throw new Error('请填写1–500个字符的重新生成原因。');
      void onSave(
        {
          slotDurationMinutes: slotDurationMinutes,
          minRestMinutes: minRestMinutes,
          minLocalDayGap: minLocalDayGap,
          courtWindows,
        },
        redraw ? reason.trim() : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请核对排赛设置。');
    }
  }
  return (
    <section className="panel sc-panel">
      <div className="section-heading">
        <div>
          <h2>{redraw ? '重新生成对阵' : '设置排赛规则'}</h2>
          <p>
            {knockout
              ? '先明确使用条件，再生成固定淘汰赛签位和首轮实际对阵。后轮等待确认晋级后另行发布。'
              : '先明确使用条件，再生成完整单循环对阵。这里不会自动分配开赛时间。'}
          </p>
        </div>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="sc-policy-grid">
          <label>
            每场占用分钟
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={duration}
              disabled={busy}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            最少休息分钟
            <input
              type="number"
              min={0}
              max={43200}
              step={1}
              value={rest}
              disabled={busy}
              onChange={(event) => setRest(event.target.value)}
            />
          </label>
          <label>
            最小日期间隔
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              value={dayGap}
              disabled={busy}
              onChange={(event) => setDayGap(event.target.value)}
            />
          </label>
        </div>
        <p className="sc-hint">
          占用时长包含计划预留的整段场地时间。日期间隔按中国标准时间的开赛日期计算；填写2表示20日开赛后，下一场最早22日。
        </p>
        <div className="sc-window-heading">
          <h3>场地可用时间窗口</h3>
          <span>中国标准时间（UTC+8）</span>
        </div>
        {windows.map((window, index) => (
          <div className="sc-window-row" key={window.key}>
            <span className="sc-window-number">{String(index + 1).padStart(2, '0')}</span>
            <label>
              场地
              <select
                aria-label={`窗口${index + 1}场地`}
                value={window.courtId}
                disabled={busy}
                onChange={(event) => update(window.key, 'courtId', event.target.value)}
              >
                <option value="">请选择共享场地</option>
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
                aria-label={`窗口${index + 1}开始时间`}
                type="datetime-local"
                step="0.001"
                value={window.startsAt}
                disabled={busy}
                onChange={(event) => update(window.key, 'startsAt', event.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                aria-label={`窗口${index + 1}结束时间`}
                type="datetime-local"
                step="0.001"
                value={window.endsAt}
                disabled={busy}
                onChange={(event) => update(window.key, 'endsAt', event.target.value)}
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`移除窗口${index + 1}`}
              disabled={busy || windows.length === 1}
              onClick={() =>
                setWindows((previous) => previous.filter((item) => item.key !== window.key))
              }
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || windows.length >= 200}
          onClick={() =>
            setWindows((previous) => [
              ...previous,
              { key: crypto.randomUUID(), courtId: '', startsAt: '', endsAt: '' },
            ])
          }
        >
          <Plus size={16} />
          添加时间窗口
        </button>
        {redraw && (
          <>
            <label className="sc-redraw-reason">
              重新生成原因
              <textarea
                value={reason}
                rows={3}
                maxLength={500}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <p className="sc-hint">
              本次将重新抽取对阵顺序并建立新工作稿，旧稿只读保留。已有场地与时间安排不会自动转入新稿。
            </p>
          </>
        )}
        {error && (
          <div className="sc-error" role="alert">
            {error}
          </div>
        )}
        <div className="sc-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button className="button button-primary" disabled={busy || !courts.length}>
            {busy
              ? '正在生成…'
              : redraw
                ? '确认重新生成对阵'
                : knockout
                  ? '生成淘汰赛签位'
                  : '生成单循环对阵'}
          </button>
        </div>
      </form>
    </section>
  );
}
export function PolicySummary({ policy, courts }: { policy: SchedulePolicy; courts: CourtData[] }) {
  return (
    <section className="sc-policy-summary">
      <div>
        <span>每场占用</span>
        <strong>{policy.slotDurationMinutes}分钟</strong>
      </div>
      <div>
        <span>最少休息</span>
        <strong>{policy.minRestMinutes}分钟</strong>
      </div>
      <div>
        <span>最小日期间隔</span>
        <strong>{policy.minLocalDayGap}天</strong>
      </div>
      <details>
        <summary>{policy.courtWindows.length}个可用时间窗口</summary>
        {policy.courtWindows.map((window, index) => (
          <p key={`${window.courtId}:${index}`}>
            <strong>
              {courts.find((court) => court.id === window.courtId)?.name ?? '已记录场地'}
            </strong>
            <span>
              {timeLabel(window.startsAt)} — {timeLabel(window.endsAt)}
            </span>
          </p>
        ))}
      </details>
    </section>
  );
}
