import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Plus, Save } from 'lucide-react';
import type { CourtData } from '@small-city-basketball/contracts';
import { createSchedulingApi } from '../api/scheduling';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { organizationContext, SchedulingAccessRequired } from './shared';

export function CourtsPage({ context }: { context: RegistrationWorkspace }) {
  return organizationContext(context) ? (
    <OrganizationCourts context={context} />
  ) : (
    <SchedulingAccessRequired />
  );
}
function OrganizationCourts({
  context,
}: {
  context: RegistrationWorkspace & { organizationId: string };
}) {
  const api = useMemo(
    () => createSchedulingApi(context.client, context.organizationId),
    [context.client, context.organizationId],
  );
  const read = useCallback(() => api.courts(), [api]);
  const resource = useResource(read);
  const action = useAction();
  const [editing, setEditing] = useState<CourtData | 'new'>();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DISABLED'>('ACTIVE');
  const [validation, setValidation] = useState('');
  function begin(court: CourtData | 'new') {
    setEditing(court);
    setName(court === 'new' ? '' : court.name);
    setStatus(court === 'new' ? 'ACTIVE' : court.status);
    setValidation('');
    action.clear();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (!name.trim() || Array.from(name.trim()).length > 80) {
      setValidation('场地名称需为1–80个字符。');
      return;
    }
    setValidation('');
    await action.run(async () => {
      if (editing === 'new') await api.createCourt({ name: name.trim() });
      else
        await api.updateCourt(editing.id, {
          name: name.trim(),
          status,
          expectedVersion: editing.version,
        });
      if (action.isActive()) {
        setEditing(undefined);
        resource.reload();
      }
    }, '场地已保存');
  }
  return (
    <div className="sc-page">
      <Link className="back-link" to="/scheduling">
        ← 返回抽签排赛
      </Link>
      <PageHeading
        eyebrow="SHARED COURTS"
        title="机构场地"
        description="同一机构的所有赛事共用这些场地，发布时统一检查占用。"
      >
        {resource.data?.canCreateCourt && (
          <button
            className="button button-primary"
            disabled={action.busy}
            onClick={() => begin('new')}
          >
            <Plus size={17} />
            创建场地
          </button>
        )}
      </PageHeading>
      <ActionNotice
        action={action}
        onReload={() => {
          setEditing(undefined);
          resource.reload();
        }}
      />
      {editing && (
        <section className="panel sc-panel">
          <h2>{editing === 'new' ? '创建场地' : '编辑场地'}</h2>
          <form
            className="sc-court-form"
            onSubmit={(event) => {
              void save(event);
            }}
            noValidate
          >
            <label>
              场地名称
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                disabled={action.busy}
                placeholder="例如：市民体育中心1号场"
              />
            </label>
            {editing !== 'new' && (
              <label>
                场地状态
                <select
                  value={status}
                  disabled={action.busy}
                  onChange={(event) => setStatus(event.target.value as 'ACTIVE' | 'DISABLED')}
                >
                  <option value="ACTIVE">启用</option>
                  <option value="DISABLED">停用</option>
                </select>
              </label>
            )}
            {validation && (
              <p className="sc-error" role="alert">
                {validation}
              </p>
            )}
            <div className="sc-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={action.busy}
                onClick={() => {
                  setEditing(undefined);
                  setValidation('');
                  action.clear();
                }}
              >
                取消
              </button>
              <button className="button button-primary" disabled={action.busy}>
                <Save size={16} />
                {action.busy ? '正在保存…' : '保存场地'}
              </button>
            </div>
          </form>
          {status === 'DISABLED' && (
            <p className="sc-hint">
              存在未来正式比赛占用的场地不能停用，服务会在保存时核验。历史赛程保留发布时的场地名称。
            </p>
          )}
        </section>
      )}
      {resource.loading || resource.error || !resource.data ? (
        <ResourceState {...resource} />
      ) : resource.data.data.length === 0 ? (
        <section className="panel sc-empty">
          <MapPin size={32} />
          <h2>还没有共享场地</h2>
          <p>
            {resource.data.canCreateCourt
              ? '创建场地后，再为赛事设置可用时间窗口。'
              : '当前身份只能查看，请联系机构负责人创建场地。'}
          </p>
        </section>
      ) : (
        <div className="sc-court-grid">
          {resource.data.data.map((court) => (
            <section className="panel sc-court-card" key={court.id}>
              <span className="sc-court-icon">
                <MapPin size={24} />
              </span>
              <div>
                <span className={`status-badge ${court.status === 'ACTIVE' ? 'green' : 'neutral'}`}>
                  {court.status === 'ACTIVE' ? '启用中' : '已停用'}
                </span>
                <h2>{court.name}</h2>
                <p>机构共享场地 · 资料版本 {court.version}</p>
              </div>
              {court.capabilities.canManage && (
                <button
                  className="button button-secondary"
                  disabled={action.busy}
                  onClick={() => begin(court)}
                >
                  编辑场地
                </button>
              )}
            </section>
          ))}
        </div>
      )}
      <div className="sc-note">
        <MapPin size={18} />
        <p>请为同一实际场地使用同一条场地记录。不同机构的物理场馆共享与协调暂未纳入检查范围。</p>
      </div>
    </div>
  );
}
