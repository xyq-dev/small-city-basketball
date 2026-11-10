import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CourtData,
  ScheduleOptimizationPreview,
  ScheduleRevisionData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import type { SchedulingApi } from '../api/scheduling';
import type { LocalAllocation } from './AutoScheduleSuggestions';
import { fixtureLabel, timeLabel } from './shared';

type Proposal = {
  preview: ScheduleOptimizationPreview;
  preserveAssigned: boolean;
  source: string;
  api: SchedulingApi;
};

export function ServerOptimizationPreview({
  revision,
  courts,
  allocations,
  eventDates,
  api,
  ownerKey,
  dirty,
  disabled,
  onBusyChange,
  onAdopt,
  onReload,
}: {
  revision: ScheduleRevisionData;
  courts: CourtData[];
  allocations: LocalAllocation[];
  eventDates: { startDate: string; endDate: string };
  api: SchedulingApi;
  ownerKey: string;
  dirty: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdopt: (allocations: ScheduleOptimizationPreview['allocations']) => void;
  onReload: () => void;
}) {
  const [proposal, setProposal] = useState<Proposal>();
  const [computing, setComputing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState<{ key: string; api: SchedulingApi }>();
  const active = useRef<AbortController | null>(null);
  const source = JSON.stringify([
    revision,
    allocations,
    eventDates,
    courts.map(({ id, status, version }) => [id, status, version]),
    dirty,
    ownerKey,
  ]);
  const versionKey = JSON.stringify([
    ownerKey,
    revision.id,
    revision.eventId,
    revision.version,
    revision.eventVersion,
  ]);
  const editable =
    revision.isCurrent && revision.status === 'DRAFT' && revision.capabilities.canEditAllocations;
  const denied = blocked?.key === versionKey && blocked.api === api;
  const allowed = Boolean(ownerKey) && editable && !dirty && !disabled && !denied;
  const latest = useRef({ source, api, allowed });
  latest.current = { source, api, allowed };

  function cancel(message = '') {
    const current = active.current;
    active.current = null;
    current?.abort();
    if (current) onBusyChange(false);
    setComputing(false);
    setProposal(undefined);
    setConfirming(false);
    setNotice(message);
  }
  useLayoutEffect(() => {
    cancel();
    setError('');
    return () => {
      const current = active.current;
      active.current = null;
      current?.abort();
      if (current) onBusyChange(false);
    };
    // Source and API identity define the exact draft/actor this preview may affect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, api]);
  useLayoutEffect(() => {
    if (!allowed && active.current) cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function generate(preserveAssigned: boolean) {
    if (!latest.current.allowed || active.current) return;
    const controller = new AbortController();
    const requestedSource = source;
    const requestedApi = api;
    active.current = controller;
    setProposal(undefined);
    setConfirming(false);
    setError('');
    setNotice('');
    setComputing(true);
    onBusyChange(true);
    const current = () =>
      active.current === controller &&
      !controller.signal.aborted &&
      latest.current.source === requestedSource &&
      latest.current.api === requestedApi &&
      latest.current.allowed;
    try {
      const preview = await api.optimizationPreview(
        revision,
        courts,
        preserveAssigned,
        controller.signal,
      );
      if (current())
        setProposal({ preview, preserveAssigned, source: requestedSource, api: requestedApi });
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause.message : '服务端预演未完成，请重试。');
        if (cause instanceof ApiError && [401, 403, 409].includes(cause.status))
          setBlocked({ key: versionKey, api: requestedApi });
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setComputing(false);
        onBusyChange(false);
      }
    }
  }
  const visible =
    proposal && proposal.source === source && proposal.api === api && allowed
      ? proposal
      : undefined;
  function adopt() {
    if (
      !visible ||
      !latest.current.allowed ||
      latest.current.source !== visible.source ||
      latest.current.api !== visible.api
    )
      return;
    onAdopt(visible.preview.allocations);
    setProposal(undefined);
    setConfirming(false);
  }
  const participants = new Map(revision.participants.map((item) => [item.entryId, item.teamName]));
  const courtName = (id: string | null) =>
    courts.find((court) => court.id === id)?.name ?? '未分配场地';
  const changes =
    visible?.preview.allocations.filter((item) => {
      const before = revision.fixtures.find((f) => f.fixtureKey === item.fixtureKey)!;
      return (
        before.courtId !== item.courtId ||
        (before.startsAt === null || item.startsAt === null
          ? before.startsAt !== item.startsAt
          : Date.parse(before.startsAt) !== Date.parse(item.startsAt))
      );
    }).length ?? 0;
  return (
    <section className="sc-suggestions" aria-label="服务端排程预演">
      <div className="section-heading">
        <div>
          <h3>服务端排程预演</h3>
          <p>基于已保存草稿与服务端资源占用生成建议；预演和采用都不会保存或发布。</p>
        </div>
        <div className="sc-actions">
          {computing ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => cancel('已取消服务端预演，原有安排未改变。')}
            >
              取消服务端预演
            </button>
          ) : (
            <>
              <button
                className="button button-secondary"
                type="button"
                disabled={!allowed}
                onClick={() => void generate(true)}
              >
                服务端补排预演
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={!allowed}
                onClick={() => void generate(false)}
              >
                全稿均衡预演
              </button>
            </>
          )}
        </div>
      </div>
      <p className="sc-hint">
        上方本地建议仅补空项；服务端预演还读取共享资源占用。结果不预留场地，不保证全局最优，发布前仍会重新检查。
      </p>
      {dirty && <p role="status">当前有未保存安排，请先显式保存或放弃修改，再生成服务端预演。</p>}
      {computing && <p role="status">正在读取服务端排程建议，可取消等待…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div className="sc-error" role="alert">
          {error}
        </div>
      )}
      {denied && (
        <p role="status">
          身份、权限或资料版本可能已变化；请重新读取后核对，不会自动重试或覆盖当前输入。
          <button className="button button-secondary" type="button" onClick={onReload}>
            重新读取排赛资料
          </button>
        </p>
      )}
      {visible && (
        <section className="sc-suggestion-preview" aria-label="服务端排程预演结果">
          <h4>
            {visible.preserveAssigned ? '保留已有安排，仅补空项' : '全稿重排，可能替换已有安排'}
          </h4>
          <p>
            已排{visible.preview.score.assignedCount}场 · 保留{visible.preview.preservedCount}场 ·
            未排{visible.preview.unassigned.length}场 · 变化{changes}场
          </p>
          <p className="sc-hint">
            有界搜索{visible.preview.checks}次 · 首末场公平度指标
            {visible.preview.score.firstLastPenalty}（越低越均衡，不代表全局最优）
          </p>
          {visible.preview.limitReached && (
            <p role="status">已达搜索上限；尚未排入不代表无解，可调整窗口后重新预演。</p>
          )}
          <div className="sc-suggestion-list">
            {visible.preview.allocations.map((item) => {
              const before = revision.fixtures.find(
                (fixture) => fixture.fixtureKey === item.fixtureKey,
              )!;
              return (
                <article key={item.fixtureKey}>
                  <strong>
                    {fixtureLabel(before)} · {participants.get(before.homeEntryId) ?? '已冻结球队'}{' '}
                    VS {participants.get(before.awayEntryId) ?? '已冻结球队'}
                  </strong>
                  <span>
                    原：{courtName(before.courtId)} · {timeLabel(before.startsAt)}
                  </span>
                  <span>
                    建议：{courtName(item.courtId)} · {timeLabel(item.startsAt)}
                    {item.startsAt === null ? '（未找到可排时段，不编造时间）' : ''}
                  </span>
                </article>
              );
            })}
          </div>
          {confirming ? (
            <div className="sc-actions" role="group" aria-label="确认全稿替换">
              <p>
                将以预演替换当前本地草稿全部安排，其中{visible.preview.unassigned.length}
                场将保持未分配。此操作尚不保存或发布。
              </p>
              <button className="button button-primary" type="button" onClick={adopt}>
                确认替换本地草稿安排
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setConfirming(false)}
              >
                返回核对预演
              </button>
            </div>
          ) : (
            <div className="sc-actions">
              <button
                className="button button-primary"
                type="button"
                disabled={changes === 0}
                onClick={() => (visible.preserveAssigned ? adopt() : setConfirming(true))}
              >
                采用服务端建议到本地
              </button>
              <button className="button button-secondary" type="button" onClick={() => cancel()}>
                放弃服务端预演
              </button>
            </div>
          )}
          <p className="sc-hint">
            采用后仍须保存全部安排，再检查赛程冲突，检查通过后才可显式发布。
          </p>
        </section>
      )}
    </section>
  );
}
