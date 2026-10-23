import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  EventScoringData,
  UpdateScoringRulesInput,
  ScoringRulesetData,
  ScoringWorkbenchData,
  UpdateMatchStaffInput,
} from '@small-city-basketball/contracts';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
export function RulesSummary({ rules }: { rules: ScoringRulesetData }) {
  return (
    <div className="score-rule-summary">
      <span>
        规则版本 <strong>{rules.version}</strong>
      </span>
      <span>
        <strong>{rules.regulationPeriods}</strong> 节 ×{' '}
        <strong>{rules.periodDurationSeconds}</strong> 秒
      </span>
      <span>
        允许得分 <strong>{rules.allowedScoreValues.join(' / ')} 分</strong>
      </span>
      <span>
        {rules.tiePolicy === 'ALLOW_DRAW'
          ? '允许平局'
          : `平局加时 · 每节${rules.overtimeDurationSeconds}秒`}
      </span>
    </div>
  );
}
export function RulesForm({
  data,
  busy,
  onSave,
}: {
  data: EventScoringData;
  busy: boolean;
  onSave: (input: UpdateScoringRulesInput) => Promise<void>;
}) {
  const [periods, setPeriods] = useState(data.rules ? String(data.rules.regulationPeriods) : '');
  const [seconds, setSeconds] = useState(
    data.rules ? String(data.rules.periodDurationSeconds) : '',
  );
  const [scores, setScores] = useState<(1 | 2 | 3)[]>(data.rules?.allowedScoreValues ?? []);
  const knockout =
    data.event.format === 'SINGLE_ELIMINATION' || data.event.format === 'GROUP_KNOCKOUT';
  const [tie, setTie] = useState(knockout ? 'OVERTIME' : (data.rules?.tiePolicy ?? ''));
  const [overtime, setOvertime] = useState(
    data.rules?.overtimeDurationSeconds ? String(data.rules.overtimeDurationSeconds) : '',
  );
  const [error, setError] = useState('');
  function integer(value: string, min: number, max: number, label: string) {
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`${label}需为${min}–${max}的整数`);
    return n;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const regulationPeriods = integer(periods, 1, 8, '常规节数'),
        periodDurationSeconds = integer(seconds, 1, 3600, '每节时长');
      if (!scores.length) throw new Error('请至少选择一种允许得分');
      if (knockout && tie !== 'OVERTIME') throw new Error('含淘汰阶段的赛事必须平局进入加时');
      if (tie !== 'ALLOW_DRAW' && tie !== 'OVERTIME') throw new Error('请明确选择平局处理');
      const overtimeDurationSeconds =
        tie === 'OVERTIME' ? integer(overtime, 1, 1800, '加时时长') : null;
      await onSave({
        expectedEventVersion: data.event.version,
        regulationPeriods,
        periodDurationSeconds,
        allowedScoreValues: [...scores].sort(),
        tiePolicy: tie,
        overtimeDurationSeconds,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '规则未能保存');
    }
  }
  if (data.locked || !data.capabilities.canManageRules)
    return (
      <section className="panel score-panel">
        <h2>
          <LockKeyhole size={19} /> {data.locked ? '记分规则已锁定' : '记分规则只读'}
        </h2>
        <p>
          {data.locked
            ? '首场准备后，本届规则永久锁定。预计场地占用分钟不代表节长。'
            : '当前身份没有修改本届记分规则的权限。'}
        </p>
        {data.rules ? (
          <RulesSummary rules={data.rules} />
        ) : (
          <p>尚未设置规则，请联系有赛事管理权限的人员。</p>
        )}
      </section>
    );
  return (
    <section className="panel score-panel">
      <h2>显式设置记分规则</h2>
      <p>不预设竞赛规则。首场准备后，本届规则永久锁定；犯规和暂停只累计，不推定罚球或剩余配额。</p>
      {knockout && (
        <p className="score-note">
          {data.event.format === 'GROUP_KNOCKOUT'
            ? '分组接淘汰赛事的组内赛和淘汰赛均必须分出胜负，平分持续加时；请明确填写每次加时时长。'
            : '单淘汰赛必须分出胜负，平分持续加时；请明确填写每次加时时长。'}
        </p>
      )}
      <form className="score-form" onSubmit={submit} noValidate>
        <div className="score-fields">
          <label className="score-field">
            常规节数
            <input
              type="number"
              min="1"
              max="8"
              value={periods}
              onChange={(e) => setPeriods(e.target.value)}
            />
          </label>
          <label className="score-field">
            每节时长（秒）
            <input
              type="number"
              min="1"
              max="3600"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
          </label>
        </div>
        <fieldset>
          <legend>允许得分值</legend>
          <div className="score-checks">
            {([1, 2, 3] as const).map((value) => (
              <label key={value}>
                <input
                  type="checkbox"
                  checked={scores.includes(value)}
                  onChange={(e) =>
                    setScores(
                      e.target.checked ? [...scores, value] : scores.filter((n) => n !== value),
                    )
                  }
                />
                允许{value}分
              </label>
            ))}
          </div>
        </fieldset>
        <div className="score-fields">
          <label className="score-field">
            平局处理
            <select
              aria-label="平局处理"
              value={tie}
              disabled={knockout}
              onChange={(e) => setTie(e.target.value)}
            >
              <option value="">请选择平局处理</option>
              {!knockout && <option value="ALLOW_DRAW">允许平局</option>}
              <option value="OVERTIME">平局进入加时</option>
            </select>
          </label>
          {tie === 'OVERTIME' && (
            <label className="score-field">
              加时时长（秒）
              <input
                type="number"
                min="1"
                max="1800"
                value={overtime}
                onChange={(e) => setOvertime(e.target.value)}
              />
            </label>
          )}
        </div>
        {error && (
          <div className="score-note score-error" role="alert">
            {error}
          </div>
        )}
        <div className="score-actions">
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? '正在保存…' : '保存记分规则'}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setPeriods(data.rules ? String(data.rules.regulationPeriods) : '');
              setSeconds(data.rules ? String(data.rules.periodDurationSeconds) : '');
              setScores(data.rules?.allowedScoreValues ?? []);
              setTie(knockout ? 'OVERTIME' : (data.rules?.tiePolicy ?? ''));
              setOvertime(
                data.rules?.overtimeDurationSeconds
                  ? String(data.rules.overtimeDurationSeconds)
                  : '',
              );
              setError('');
            }}
          >
            取消规则修改
          </button>
        </div>
      </form>
    </section>
  );
}
export function StaffPanel({
  data,
  busy,
  onSave,
}: {
  data: ScoringWorkbenchData;
  busy: boolean;
  onSave: (userId: string, input: UpdateMatchStaffInput) => Promise<void>;
}) {
  const [userId, setUserId] = useState(''),
    [role, setRole] = useState<'SCORER' | 'RESULT_REVIEWER'>('SCORER'),
    [status, setStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE'),
    [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId.trim())) {
      setError('请填写现有有效机构成员的完整用户ID');
      return;
    }
    await onSave(userId.trim(), { expectedMatchVersion: data.match.version, role, status });
  }
  return (
    <section className="panel score-panel">
      <h2>
        <ShieldCheck size={19} /> 场次人员
      </h2>
      <p>
        仅明确分配的记分员可写分。管理员不自动具有记分权；有历史记分行为或属于参赛队当前领队的人员不能确认赛果。
      </p>
      {data.staff.length ? (
        <ul className="score-records">
          {data.staff.map((person) => (
            <li key={`${person.userId}:${person.role}`}>
              <div>
                <strong>{person.displayName}</strong>
                <small>
                  {person.role === 'SCORER' ? '记分员' : '赛果确认员'} ·{' '}
                  {person.status === 'ACTIVE' ? '启用' : '停用'}
                </small>
              </div>
              {data.capabilities.canManageStaff && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setUserId(person.userId);
                    setRole(person.role);
                    setStatus(person.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
                    setError('');
                  }}
                >
                  调整{person.displayName}授权
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>尚未分配场次人员。准备比赛前至少需要一名有效记分员。</p>
      )}
      {data.capabilities.canManageStaff ? (
        <form className="score-form" onSubmit={submit} noValidate>
          <label className="score-field">
            工作人员用户ID
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="现有有效机构成员的完整用户ID"
              autoComplete="off"
            />
          </label>
          <div className="score-fields">
            <label className="score-field">
              场次角色
              <select
                aria-label="场次角色"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="SCORER">记分员</option>
                <option value="RESULT_REVIEWER">赛果确认员</option>
              </select>
            </label>
            <label className="score-field">
              授权状态
              <select
                aria-label="授权状态"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">停用</option>
              </select>
            </label>
          </div>
          {error && (
            <div className="score-note score-error" role="alert">
              {error}
            </div>
          )}
          <div className="score-actions">
            <button className="button button-primary" disabled={busy} type="submit">
              保存场次人员
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setUserId('');
                setRole('SCORER');
                setStatus('ACTIVE');
                setError('');
              }}
            >
              取消人员修改
            </button>
          </div>
        </form>
      ) : (
        <p className="score-muted">当前身份只读，无法调整场次人员。</p>
      )}
    </section>
  );
}
