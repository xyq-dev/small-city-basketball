import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react';
import { ApiError } from '../api/client';
import type { ApiClient } from '../api/client';

export interface TeamContext {
  orgId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
}
export interface RegistrationWorkspace {
  client: ApiClient;
  organizationId?: string;
  teamContext?: TeamContext;
  userId: string;
  onSessionRefresh: () => Promise<void>;
}
export function message(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作未完成，请重试';
}
export function useResource<T>(read: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(undefined);
    void read()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [read, revision]);
  return { data, loading, error, reload: () => setRevision((n) => n + 1) };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState('');
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>, notice = '已保存') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setConflict(false);
    setSuccess('');
    try {
      await action();
      if (alive.current) setSuccess(notice);
    } catch (cause) {
      if (alive.current) {
        setError(message(cause));
        setConflict(cause instanceof ApiError && cause.apiCode === 'VERSION_CONFLICT');
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return {
    busy,
    error,
    conflict,
    success,
    run,
    isActive: () => alive.current,
    clear: () => {
      setError('');
      setSuccess('');
      setConflict(false);
    },
  };
}
export function ResourceState({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  if (loading)
    return (
      <div className="panel registration-state" role="status">
        <LoaderCircle className="spin" size={24} />
        <p>正在读取最新资料…</p>
      </div>
    );
  return (
    <div className="panel registration-state" role="alert">
      <AlertCircle size={25} />
      <h2>暂时无法读取</h2>
      <p>{error || '资料不可用或没有访问权限。'}</p>
      <button className="button button-secondary" onClick={reload}>
        <RefreshCw size={16} />
        重新加载
      </button>
    </div>
  );
}
export function ActionNotice({
  action,
  onReload,
}: {
  action: ReturnType<typeof useAction>;
  onReload?: () => void;
}) {
  return (
    <>
      {action.error && (
        <div className="registration-alert" role="alert">
          <strong>{action.conflict ? '资料版本已变化' : '操作未完成'}</strong>
          <p>{action.error}</p>
          {action.conflict && (
            <p>其他人可能已更新此资料。当前输入仍在；重新读取最新版本后核对再操作。</p>
          )}
          {onReload && action.conflict && (
            <button className="button button-secondary" disabled={action.busy} onClick={onReload}>
              重新读取最新资料
            </button>
          )}
        </div>
      )}
      {action.success && (
        <div className="success-notice" role="status">
          {action.success}
        </div>
      )}
    </>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Version({ value }: { value: number }) {
  return <span className="registration-version">资料 v{value}</span>;
}
export const entryLabels: Record<string, string> = {
  DRAFT: '待提交',
  SUBMITTED: '待审核',
  APPROVED: '已通过',
  CHANGES_REQUESTED: '待修改',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
};
export function EntryBadge({ status }: { status: string }) {
  return (
    <span
      className={`status-badge ${status === 'APPROVED' ? 'green' : status === 'SUBMITTED' ? 'blue' : status === 'CHANGES_REQUESTED' ? 'amber' : status === 'REJECTED' ? 'red' : 'neutral'}`}
    >
      {entryLabels[status] ?? status}
    </span>
  );
}
