import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import type {
  EventStandingsData,
  StandingsTiebreaker,
  UpdateStandingsRulesInput,
} from '@small-city-basketball/contracts';
import { RuleSummary, tiebreakerLabels } from './StandingsTable';
export function StandingsRulesForm({
  data,
  busy,
  onSave,
  onDirtyChange,
}: {
  data: EventStandingsData;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (input: UpdateStandingsRulesInput) => Promise<void>;
}) {
  const [win, setWin] = useState(data.rules ? String(data.rules.winPoints) : ''),
    [loss, setLoss] = useState(data.rules ? String(data.rules.lossPoints) : ''),
    [draw, setDraw] = useState(data.rules ? String(data.rules.drawPoints) : ''),
    [order, setOrder] = useState<StandingsTiebreaker[]>(data.rules?.tiebreakers ?? []),
    [addition, setAddition] = useState(''),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  function points(value: string, label: string) {
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < 0 || n > 1000)
      throw new Error(`${label}需明确填写0–1000的整数`);
    return n;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await onSave({
        expectedEventVersion: data.event.version,
        winPoints: points(win, '胜场积分'),
        lossPoints: points(loss, '负场积分'),
        drawPoints: points(draw, '平局积分'),
        tiebreakers: order,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则保存失败');
    }
  }
  function reset() {
    setWin(data.rules ? String(data.rules.winPoints) : '');
    setLoss(data.rules ? String(data.rules.lossPoints) : '');
    setDraw(data.rules ? String(data.rules.drawPoints) : '');
    setOrder(data.rules?.tiebreakers ?? []);
    setAddition('');
    setError('');
    setDirty(false);
  }
  function move(index: number, direction: number) {
    const next = [...order];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setOrder(next);
    setDirty(true);
  }
  if (data.locked || !data.capabilities.canManageRules)
    return (
      <section className="panel view-panel">
        <div className="view-section-title">
          <h2>{data.locked ? '排名规则已正式发布并锁定' : '排名规则只读'}</h2>
          {data.rules && (
            <span className="status-badge neutral">规则版本 {data.rules.version}</span>
          )}
        </div>
        <p className="view-muted">
          {data.locked
            ? '本届规则永久锁定，不能另存草稿覆盖。'
            : '当前身份没有配置本届排名规则的权限。'}
        </p>
        {data.rules ? (
          <RuleSummary rules={data.rules} />
        ) : (
          <p className="view-muted">尚未配置排名规则，请联系赛事管理者。</p>
        )}
      </section>
    );
  return (
    <section className="panel view-panel">
      <div className="view-section-title">
        <div>
          <span className="view-eyebrow">DECLARE HOW THE TABLE WORKS</span>
          <h2>排名规则草稿</h2>
        </div>
        {dirty && <span className="status-badge amber">本地修改未保存</span>}
      </div>
      <p className="view-muted">
        显式填写胜、负、平局积分。先保存草稿预览，再单独发布；首次正式发布后永久锁定。
      </p>
      <form className="view-form" onSubmit={save} noValidate>
        <div className="view-fields">
          <label className="view-field">
            胜场积分
            <input
              disabled={busy}
              type="number"
              min="0"
              max="1000"
              value={win}
              onChange={(e) => {
                setWin(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="view-field">
            负场积分
            <input
              disabled={busy}
              type="number"
              min="0"
              max="1000"
              value={loss}
              onChange={(e) => {
                setLoss(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label className="view-field">
            平局积分
            <input
              disabled={busy}
              type="number"
              min="0"
              max="1000"
              value={draw}
              onChange={(e) => {
                setDraw(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        </div>
        <div>
          <h3>同分判定顺序</h3>
          <p className="view-muted">
            积分始终优先。可不添加额外判定；下列全部仍相同则共享名次，不用队名、ID或随机顺序决胜。
          </p>
          <ol className="view-rule-order">
            {order.map((key, index) => (
              <li key={key}>
                <strong>
                  {index + 1}. {tiebreakerLabels[key]}
                </strong>
                <div className="view-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy || index === 0}
                    aria-label={`上移${tiebreakerLabels[key]}`}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy || index === order.length - 1}
                    aria-label={`下移${tiebreakerLabels[key]}`}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busy}
                    aria-label={`移除${tiebreakerLabels[key]}`}
                    onClick={() => {
                      setOrder(order.filter((item) => item !== key));
                      setDirty(true);
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {!order.length && (
            <div className="view-note">未设置额外同分判定，积分相同即共享名次。</div>
          )}
        </div>
        <div className="view-add-rule">
          <label className="view-field">
            添加同分判定
            <select
              disabled={busy}
              aria-label="添加同分判定"
              value={addition}
              onChange={(e) => setAddition(e.target.value)}
            >
              <option value="">请选择判定项</option>
              {Object.entries(tiebreakerLabels).map(([key, label]) => (
                <option key={key} value={key} disabled={order.includes(key as StandingsTiebreaker)}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy || !addition || order.includes(addition as StandingsTiebreaker)}
            onClick={() => {
              setOrder([...order, addition as StandingsTiebreaker]);
              setAddition('');
              setDirty(true);
            }}
          >
            <Plus size={16} />
            添加判定项
          </button>
        </div>
        {error && (
          <div className="view-note error" role="alert">
            {error}
          </div>
        )}
        <div className="view-actions">
          <button className="button button-primary" disabled={busy} type="submit">
            保存排名规则草稿
          </button>
          <button className="button button-secondary" type="button" disabled={busy} onClick={reset}>
            取消规则修改
          </button>
        </div>
      </form>
    </section>
  );
}
