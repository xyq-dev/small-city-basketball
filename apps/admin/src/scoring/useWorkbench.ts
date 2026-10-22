import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ScoringWorkbenchData,
  ScoringEventData,
  ResultConfirmationData,
  ScoringCommandInput,
  ScoringCommandPayload,
  ScoringCommandResponse,
  ScorekeeperLeaseData,
  ScoringControl,
} from '@small-city-basketball/contracts';
import type { ScoringApi } from '../api/scoring';
import { ApiError } from '../api/client';
import { message } from '../registration/shared';
import { getTabClientInstanceId } from './clientIdentity';

export interface WorkbenchBundle {
  workbench: ScoringWorkbenchData;
  events: ScoringEventData[];
  confirmations: ResultConfirmationData[];
}
export interface PendingCommand {
  envelope: ScoringCommandInput;
  problem: string;
  checkedAbsent: boolean;
}
const controlOf = (lease: ScorekeeperLeaseData): ScoringControl => ({
  leaseId: lease.leaseId,
  fencingToken: lease.fencingToken,
  clientInstanceId: lease.clientInstanceId,
});
const uncertain = (cause: unknown) =>
  !(cause instanceof ApiError) ||
  cause.status === 0 ||
  cause.status >= 500 ||
  cause.status === 408 ||
  cause.apiCode === 'INVALID_RESPONSE';
function commandPermitted(command: ScoringCommandPayload, workbench: ScoringWorkbenchData) {
  const caps = workbench.capabilities;
  switch (command.type) {
    case 'PREPARE_MATCH':
      return caps.canPrepare;
    case 'START_MATCH':
      return caps.canAcquireControl;
    case 'ADD_CORRECTION':
    case 'VOID_STAT':
    case 'REPLACE_STAT':
      return caps.canCorrect;
    case 'CONFIRM_RESULT':
      return caps.canConfirm;
    case 'REOPEN_RESULT':
      return caps.canReopen;
    default:
      return caps.canRecord;
  }
}
export function useWorkbench(api: ScoringApi, matchId: string) {
  const [data, setData] = useState<WorkbenchBundle>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [lease, setLease] = useState<ScorekeeperLeaseData | null>(null);
  const [leaseRemaining, setLeaseRemaining] = useState(0);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [clientInstanceId] = useState(getTabClientInstanceId);
  const alive = useRef(true),
    lock = useRef(false),
    readGeneration = useRef(0);
  const latest = useRef(data);
  latest.current = data;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  const leaseAnchor = useRef({ start: 0, duration: 0 });
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const acceptLease = useCallback((value: ScorekeeperLeaseData | null) => {
    leaseRef.current = value;
    leaseAnchor.current = {
      start: performance.now(),
      duration: value ? Math.max(0, Date.parse(value.expiresAt) - Date.parse(value.serverTime)) : 0,
    };
    setLease(value);
    setLeaseRemaining(leaseAnchor.current.duration);
  }, []);
  const refresh = useCallback(async () => {
    const generation = ++readGeneration.current;
    try {
      const [workbench, events, confirmations] = await Promise.all([
        api.workbench(matchId),
        api.events(matchId),
        api.confirmations(matchId),
      ]);
      if (!alive.current || generation !== readGeneration.current) return false;
      if (leaseRef.current && (!workbench.lease.held || !workbench.capabilities.canAcquireControl))
        acceptLease(null);
      setData((previous) =>
        previous && previous.workbench.match.version > workbench.match.version
          ? previous
          : { workbench, events, confirmations },
      );
      setStale(false);
      setReadError('');
      return true;
    } catch (cause) {
      if (alive.current && generation === readGeneration.current) {
        setReadError(message(cause));
        setStale(true);
      }
      return false;
    } finally {
      if (alive.current && generation === readGeneration.current) setLoading(false);
    }
  }, [api, matchId, acceptLease]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (onlineRef.current && !lock.current) void refresh();
    }, 5000);
    const offline = () => {
      onlineRef.current = false;
      setOnline(false);
      setNotice('网络已断开，已停止新写入。比赛时钟不会因此自动暂停。');
    };
    const connected = () => {
      onlineRef.current = true;
      setOnline(true);
      setStale(true);
      void refresh();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', connected);
    return () => {
      alive.current = false;
      ++readGeneration.current;
      clearInterval(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', connected);
    };
  }, [refresh]);
  useEffect(() => {
    const tick = setInterval(() => {
      if (!leaseRef.current) return;
      const remaining = Math.max(
        0,
        leaseAnchor.current.duration - (performance.now() - leaseAnchor.current.start),
      );
      setLeaseRemaining(remaining);
      if (remaining === 0) {
        acceptLease(null);
        setNotice('记分控制权已到期，请重新读取并取得控制权。');
      }
    }, 250);
    return () => clearInterval(tick);
  }, [acceptLease]);
  useEffect(() => {
    if (!lease) return;
    let active = true,
      renewing = false;
    const timer = setInterval(() => {
      const current = leaseRef.current;
      if (!active || renewing || !current || !onlineRef.current) return;
      renewing = true;
      void api
        .renew(matchId, controlOf(current))
        .then((value) => {
          if (active && alive.current && leaseRef.current?.leaseId === current.leaseId)
            acceptLease(value);
        })
        .catch((cause) => {
          if (active && alive.current && leaseRef.current?.leaseId === current.leaseId) {
            acceptLease(null);
            setNotice(`控制权续期失败，已停止新写入：${message(cause)}`);
            setStale(true);
            void refresh();
          }
        })
        .finally(() => {
          renewing = false;
        });
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, matchId, lease?.leaseId, acceptLease, refresh]);
  function applyAck(response: ScoringCommandResponse) {
    ++readGeneration.current;
    setData((previous) =>
      !previous || previous.workbench.match.version > response.snapshot.version
        ? previous
        : {
            ...previous,
            workbench: {
              ...previous.workbench,
              match: {
                ...previous.workbench.match,
                status: response.snapshot.status,
                version: response.snapshot.version,
              },
              snapshot: response.snapshot,
            },
          },
    );
    setStale(true);
  }
  async function guarded(task: () => Promise<void>) {
    if (lock.current || !onlineRef.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (cause) {
      if (alive.current) setError(message(cause));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function acquire() {
    await guarded(async () => {
      if (pendingRef.current || !latest.current?.workbench.capabilities.canAcquireControl) return;
      const value = await api.acquire(matchId, clientInstanceId);
      if (!alive.current) return;
      acceptLease(value);
      setNotice('已取得本页记分控制权，每10秒续期。');
      await refresh();
    });
  }
  async function release() {
    await guarded(async () => {
      const current = leaseRef.current;
      if (!current || pendingRef.current) return;
      await api.release(matchId, controlOf(current));
      if (!alive.current) return;
      acceptLease(null);
      setNotice('记分控制权已释放。');
      await refresh();
    });
  }
  async function submitEnvelope(envelope: ScoringCommandInput) {
    try {
      const response = await api.command(matchId, envelope);
      if (!alive.current) return false;
      applyAck(response);
      setPending(null);
      pendingRef.current = null;
      setNotice(`操作已由服务端确认，记录版本 ${response.receipt.appliedVersion}。`);
      await refresh();
      return alive.current;
    } catch (cause) {
      if (!alive.current) return false;
      if (uncertain(cause)) {
        const value = { envelope, problem: message(cause), checkedAbsent: false };
        setPending(value);
        pendingRef.current = value;
        setError('');
        setNotice('');
      } else {
        setError(message(cause));
        setStale(true);
        await refresh();
      }
      return false;
    }
  }
  async function send(
    command: ScoringCommandPayload,
    controlled: boolean,
    expectedVersionOverride?: number,
  ) {
    if (lock.current || pendingRef.current || !onlineRef.current || stale || !latest.current)
      return false;
    if (
      expectedVersionOverride !== undefined &&
      latest.current.workbench.match.version !== expectedVersionOverride
    ) {
      setError('待确认赛果版本已变化，请关闭后重新核对');
      return false;
    }
    if (!commandPermitted(command, latest.current.workbench)) return false;
    const currentLease = leaseRef.current;
    if (
      controlled &&
      (!currentLease ||
        leaseAnchor.current.duration - (performance.now() - leaseAnchor.current.start) <= 0)
    )
      return false;
    const envelope: ScoringCommandInput = {
      ...command,
      commandId: crypto.randomUUID(),
      expectedVersion: expectedVersionOverride ?? latest.current.workbench.match.version,
      capturedAt: new Date().toISOString(),
      ...(controlled && currentLease ? { control: controlOf(currentLease) } : {}),
    };
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      return await submitEnvelope(envelope);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function checkPending() {
    await guarded(async () => {
      const current = pendingRef.current;
      if (!current) return;
      try {
        const response = await api.receipt(matchId, current.envelope.commandId);
        if (!alive.current || pendingRef.current !== current) return;
        applyAck(response);
        setPending(null);
        pendingRef.current = null;
        setNotice(`原命令已确认，应用于版本 ${response.receipt.appliedVersion}，未重复提交。`);
        await refresh();
      } catch (cause) {
        if (!alive.current || pendingRef.current !== current) return;
        if (cause instanceof ApiError && cause.apiCode === 'COMMAND_NOT_FOUND') {
          const value = {
            ...current,
            checkedAbsent: true,
            problem: '暂未找到收据。这不代表原命令已永久失败；请核对当前比分和记录后再决定。',
          };
          setPending(value);
          pendingRef.current = value;
          await refresh();
        } else throw cause;
      }
    });
  }
  const sameControl = Boolean(
    pending &&
    (!pending.envelope.control ||
      (lease &&
        pending.envelope.control.leaseId === lease.leaseId &&
        pending.envelope.control.fencingToken === lease.fencingToken &&
        pending.envelope.control.clientInstanceId === lease.clientInstanceId)),
  );
  const originalEventVersionMatches =
    !pending ||
    !data ||
    !('expectedEventVersion' in pending.envelope.payload) ||
    pending.envelope.payload.expectedEventVersion === data.workbench.event.version;
  const canRetry = Boolean(
    pending?.checkedAbsent &&
    originalEventVersionMatches &&
    data &&
    commandPermitted(pending.envelope, data.workbench) &&
    sameControl &&
    data &&
    pending.envelope.expectedVersion === data.workbench.match.version &&
    online &&
    !stale &&
    (!pending.envelope.control || leaseRemaining > 0),
  );
  async function retryPending() {
    if (!canRetry) return;
    await guarded(async () => {
      const current = pendingRef.current;
      if (current) await submitEnvelope(current.envelope);
    });
  }
  async function acknowledgePending() {
    await guarded(async () => {
      if (await refresh()) {
        setPending(null);
        pendingRef.current = null;
        setNotice('已按人工核对恢复操作。原命令不会自动再次提交。');
      }
    });
  }
  return {
    isActive: () => alive.current,
    data,
    loading,
    error: error || readError,
    notice,
    busy,
    stale,
    online,
    lease,
    leaseRemaining,
    pending,
    canRetry,
    refresh,
    acquire,
    release,
    send,
    checkPending,
    retryPending,
    acknowledgePending,
    staff: async (userId: string, input: Parameters<ScoringApi['staff']>[2]) => {
      await guarded(async () => {
        await api.staff(matchId, userId, input);
        if (alive.current) {
          setNotice('场次人员已保存。');
          await refresh();
        }
      });
    },
  };
}
