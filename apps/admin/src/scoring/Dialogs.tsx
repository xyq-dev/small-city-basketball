import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  ScoringEventData,
  ScoringCommandPayload,
  ScoreSnapshot,
  ScoringSide,
  ScoringStatKind,
} from '@small-city-basketball/contracts';
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="score-dialog-backdrop">
      <div
        className="score-dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
          if (event.key === 'Tab') {
            const nodes = ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
            );
            if (!nodes?.length) return;
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function activeStats(events: ScoringEventData[]) {
  const voided = new Set(
    events.filter((event) => event.type === 'STAT_VOIDED').map((event) => event.targetEventId),
  );
  return events.filter((event) => event.type === 'STAT_RECORDED' && !voided.has(event.id));
}
const statName = (kind: unknown) => (kind === 'SCORE' ? '得分' : kind === 'FOUL' ? '犯规' : '暂停');
export function CorrectionDialog({
  snapshot,
  events,
  busy,
  disabled = busy,
  error: serverError,
  onSubmit,
  onClose,
}: {
  snapshot: ScoreSnapshot;
  events: ScoringEventData[];
  busy: boolean;
  disabled?: boolean;
  error?: string;
  onSubmit: (command: ScoringCommandPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState('ADD_CORRECTION'),
    [kind, setKind] = useState<ScoringStatKind>('SCORE'),
    [side, setSide] = useState<ScoringSide>('HOME'),
    [value, setValue] = useState(''),
    [period, setPeriod] = useState(String(snapshot.clock.period)),
    [target, setTarget] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const active = activeStats(events),
    selected = active.find((event) => event.id === target),
    effectiveKind = mode === 'REPLACE_STAT' ? selected?.payload.kind : kind;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!reason.trim()) {
      setError('请填写修正理由');
      return;
    }
    let command: ScoringCommandPayload;
    if (mode === 'VOID_STAT') {
      if (!selected) {
        setError('请选择仍有效的原始统计记录');
        return;
      }
      command = { type: 'VOID_STAT', payload: { targetEventId: target, reason: reason.trim() } };
    } else {
      const amount = Number(value);
      if (
        !value ||
        !Number.isInteger(amount) ||
        amount < 1 ||
        (effectiveKind === 'SCORE'
          ? !snapshot.rules.allowedScoreValues.includes(amount as 1 | 2 | 3)
          : amount !== 1)
      ) {
        setError('请填写规则允许的得分；犯规和暂停每次为1');
        return;
      }
      if (mode === 'REPLACE_STAT') {
        if (!selected) {
          setError('请选择仍有效的原始统计记录');
          return;
        }
        command = {
          type: 'REPLACE_STAT',
          payload: { targetEventId: target, side, value: amount, reason: reason.trim() },
        };
      } else {
        const p = Number(period);
        if (!Number.isInteger(p) || p < 1 || p > snapshot.clock.period) {
          setError('统计节次需为已经存在的节次');
          return;
        }
        command = {
          type: 'ADD_CORRECTION',
          payload: { kind, side, value: amount, period: p, reason: reason.trim() },
        };
      }
    }
    if (await onSubmit(command)) onClose();
  }
  return (
    <Modal title="修正比赛记录" onClose={onClose} busy={busy}>
      <p>原记录始终保留。撤销或替换只能选择当前比赛仍有效的统计；待确认阶段不会回到比赛进行中。</p>
      <form className="score-form" onSubmit={submit} noValidate>
        <label className="score-field">
          修正方式
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setError('');
              setValue('');
            }}
          >
            <option value="ADD_CORRECTION">补录统计</option>
            <option value="VOID_STAT">撤销统计</option>
            <option value="REPLACE_STAT">替换统计</option>
          </select>
        </label>
        {mode !== 'ADD_CORRECTION' && (
          <label className="score-field">
            原始统计记录
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">请选择原始记录</option>
              {active.map((item) => (
                <option key={item.id} value={item.id}>
                  记录{item.seq} · 第{String(item.payload.period)}节 ·{' '}
                  {item.payload.side === 'HOME' ? '主队' : '客队'}
                  {statName(item.payload.kind)} {String(item.payload.value)}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === 'ADD_CORRECTION' && (
          <div className="score-fields">
            <label className="score-field">
              统计项目
              <select value={kind} onChange={(e) => setKind(e.target.value as ScoringStatKind)}>
                <option value="SCORE">得分</option>
                <option value="FOUL">犯规</option>
                <option value="TIMEOUT">暂停</option>
              </select>
            </label>
            <label className="score-field">
              统计节次
              <input
                type="number"
                min="1"
                max={snapshot.clock.period}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
          </div>
        )}
        {mode !== 'VOID_STAT' && (
          <div className="score-fields">
            <label className="score-field">
              所属球队
              <select value={side} onChange={(e) => setSide(e.target.value as ScoringSide)}>
                <option value="HOME">主队</option>
                <option value="AWAY">客队</option>
              </select>
            </label>
            <label className="score-field">
              统计数值
              <input
                type="number"
                min="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </div>
        )}
        <label className="score-field">
          修正理由
          <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        {(error || serverError) && (
          <div role="alert" className="score-note score-error">
            {error || serverError}
          </div>
        )}
        <div className="score-actions">
          <button className="button button-primary" disabled={disabled}>
            提交修正
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            取消修正
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function ClockDialog({
  snapshot,
  busy,
  disabled = busy,
  error: serverError,
  onSubmit,
  onClose,
}: {
  snapshot: ScoreSnapshot;
  busy: boolean;
  disabled?: boolean;
  error?: string;
  onSubmit: (command: ScoringCommandPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const amount = Number(value),
      max =
        (snapshot.clock.period > snapshot.rules.regulationPeriods
          ? (snapshot.rules.overtimeDurationSeconds ?? 0)
          : snapshot.rules.periodDurationSeconds) * 1000;
    if (!value.trim() || !Number.isInteger(amount) || amount < 0 || amount > max) {
      setError(`剩余毫秒需为0–${max}整数`);
      return;
    }
    if (!reason.trim()) {
      setError('请填写校时理由');
      return;
    }
    if (
      await onSubmit({ type: 'CLOCK_SET', payload: { remainingMs: amount, reason: reason.trim() } })
    )
      onClose();
  }
  return (
    <Modal title="校正时钟" busy={busy} onClose={onClose}>
      <p>校时保留当前运行／暂停状态，服务端保存理由和新的权威锚点。</p>
      <form onSubmit={submit} className="score-form" noValidate>
        <label className="score-field">
          剩余毫秒
          <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="score-field">
          校时理由
          <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </label>
        {(error || serverError) && (
          <div role="alert" className="score-note score-error">
            {error || serverError}
          </div>
        )}
        <div className="score-actions">
          <button disabled={disabled} className="button button-primary">
            提交校时
          </button>
          <button
            type="button"
            disabled={busy}
            className="button button-secondary"
            onClick={onClose}
          >
            取消校时
          </button>
        </div>
      </form>
    </Modal>
  );
}
