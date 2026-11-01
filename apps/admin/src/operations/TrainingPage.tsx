import { useCallback, useMemo, useState } from 'react';
import type { TrainingCohortData } from '@small-city-basketball/contracts';
import { createOperationsApi, type TrainingRoster } from '../api/operations';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  OperationsFrame,
  chinaIso,
  commandId,
  fenText,
  reasonText,
  useEpoch,
  yuanToFen,
} from './shared';

const cohortLabels: Record<string, string> = {
  DRAFT: '草稿',
  ENROLLING: '招生中',
  RUNNING: '授课中',
  SUSPENDED: '已暂停',
  COMPLETED: '已结课',
  CANCELLED: '已取消',
};

export function TrainingOperationsPage({ context }: { context: RegistrationWorkspace }) {
  return (
    <OperationsFrame context={context}>
      {(orgId) => <TrainingDesk context={context} orgId={orgId} />}
    </OperationsFrame>
  );
}

function TrainingDesk({ context, orgId }: { context: RegistrationWorkspace; orgId: string }) {
  const api = useMemo(() => createOperationsApi(context.client), [context.client]);
  const read = useCallback(() => api.trainingWorkspace(orgId), [api, orgId]);
  const resource = useResource(read);
  const action = useAction();
  const reads = useEpoch();
  const [reason, setReason] = useState('');
  const [roster, setRoster] = useState<TrainingRoster | null>(null);
  const [enrollment, setEnrollment] = useState<Record<string, unknown> | null>(null);
  const [detailError, setDetailError] = useState('');
  const data = resource.data;
  async function refreshDetails() {
    setDetailError('');
    const token = reads.next();
    resource.reload();
    const rosterId = roster ? String(roster.session.id ?? '') : '';
    const enrollmentId = enrollment ? String(enrollment.id ?? '') : '';
    try {
      const nextRoster = rosterId ? await api.trainingRoster(rosterId) : null;
      const nextEnrollment = enrollmentId ? await api.trainingEnrollment(enrollmentId) : null;
      if (!reads.current(token)) return;
      if (rosterId) setRoster(nextRoster);
      if (enrollmentId) setEnrollment(nextEnrollment);
    } catch (cause) {
      if (!reads.current(token)) return;
      if (rosterId) setRoster(null);
      if (enrollmentId) setEnrollment(null);
      const message = cause instanceof Error ? cause.message : '当前详情没有刷新';
      setDetailError(`${message}。旧版本已隐藏，请重新打开。`);
      throw cause;
    }
  }
  function submit(label: string, run: () => Promise<void>) {
    void action.run(async () => {
      await run();
      if (!action.isActive()) return;
      await refreshDetails();
      if (action.isActive()) await context.onSessionRefresh();
    }, label);
  }
  return (
    <div className="registration-page">
      <PageHeading
        eyebrow="ADULT TRAINING"
        title="培训排课"
        description="只办理已实现的成人培训。青少年招生保持关闭，本页不提供青少年名额。"
      />
      {resource.loading || resource.error || !data ? (
        <ResourceState loading={resource.loading} error={resource.error} reload={resource.reload} />
      ) : (
        <>
          <ActionNotice
            action={action}
            onReload={() => {
              void action.run(async () => {
                await refreshDetails();
              }, '已重新读取当前资料');
            }}
          />
          {detailError && <p role="alert">{detailError}</p>}
          <p>
            {data.capabilities.enabled ? '成人培训已开放。' : '培训尚未开放，已有记录仍可查看。'}
            {data.capabilities.youthEnrollmentEnabled
              ? '服务端返回了青少年招生标记，本页仍不提供青少年操作。'
              : '青少年培训未开放。'}
            {data.capabilities.paidEnrollmentEnabled ? '' : '付费报名通道未打开。'}
          </p>
          {!data.capabilities.enabled && (
            <div className="registration-alert" role="status">
              <strong>培训功能关闭</strong>
              <p>新建主体、排课和班期操作会由服务端拒绝。</p>
            </div>
          )}
          <section className="panel">
            <h2>培训主体</h2>
            {data.provider ? (
              <p>
                {String(data.provider.name ?? '')} · {String(data.provider.status ?? '')}{' '}
                <Version value={Number(data.provider.version ?? 0)} />
              </p>
            ) : (
              <ProviderForm
                busy={action.busy || !data.capabilities.enabled}
                onCreate={(body) =>
                  submit('培训主体已提交审核', () =>
                    api
                      .post(`/v1/orgs/${encodeURIComponent(orgId)}/training/provider`, body)
                      .then(() => undefined),
                  )
                }
              />
            )}
          </section>
          <section className="panel">
            <h2>课程与班期</h2>
            {data.cohorts.length === 0 && <p>暂无班期。</p>}
            <ul>
              {data.cohorts.map((cohort) => (
                <li key={cohort.id}>
                  <CohortActions
                    cohort={cohort}
                    reason={reason}
                    busy={action.busy || !data.capabilities.enabled}
                    onReason={setReason}
                    onCommand={(command) =>
                      submit('班期操作已提交', async () => {
                        const payload = { ...command };
                        if (payload.action !== 'PUBLISH')
                          payload.reason = reasonText(String(payload.reason ?? ''));
                        else delete payload.reason;
                        await api.post(`/v1/training/cohorts/${cohort.id}/commands`, payload);
                      })
                    }
                    onRoster={(sessionId) =>
                      void action.run(async () => {
                        const token = reads.next();
                        const next = await api.trainingRoster(sessionId);
                        if (reads.current(token)) setRoster(next);
                      }, '已读取课次名单')
                    }
                  />
                </li>
              ))}
            </ul>
            <CohortForm
              courses={data.courses}
              courts={data.courts}
              coaches={data.coaches}
              busy={action.busy || !data.capabilities.enabled}
              onCreate={(body) =>
                submit('班期草稿已建立', () =>
                  api
                    .post(`/v1/orgs/${encodeURIComponent(orgId)}/training/cohorts`, body)
                    .then(() => undefined),
                )
              }
            />
          </section>
          {roster && (
            <section className="panel" aria-label="课次名单">
              <h2>课次 {String(roster.session.id ?? '')}</h2>
              {roster.learners.length === 0 && <p>本课次暂无已确认学员。</p>}
              <ul>
                {roster.learners.map((learner) => (
                  <li key={String(learner.id)}>
                    {String(learner.display_name ?? learner.id)} · {String(learner.state ?? '')}{' '}
                    <Version value={Number(learner.version ?? 0)} />
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('签到已提交', () =>
                          api
                            .post(`/v1/training/entitlements/${String(learner.id)}/commands`, {
                              commandId: commandId(),
                              action: 'CHECKIN',
                              expectedVersion: Number(learner.version),
                            })
                            .then(() => undefined),
                        )
                      }
                    >
                      现场核验后签到
                    </button>
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('签退已提交', () =>
                          api
                            .post(`/v1/training/entitlements/${String(learner.id)}/commands`, {
                              commandId: commandId(),
                              action: 'CHECKOUT',
                              expectedVersion: Number(learner.version),
                            })
                            .then(() => undefined),
                        )
                      }
                    >
                      签退
                    </button>
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('课次消费已提出，尚待独立复核', async () => {
                          await api.post(
                            `/v1/training/entitlements/${String(learner.id)}/commands`,
                            {
                              commandId: commandId(),
                              action: 'PROPOSE_CONSUMPTION',
                              expectedVersion: Number(learner.version),
                              reason: reasonText(reason),
                            },
                          );
                        })
                      }
                    >
                      提出课次消费
                    </button>
                  </li>
                ))}
              </ul>
              {roster.consumptions.filter(objectRecord).map((row) => (
                <p key={String(row.id)}>
                  {String(row.status)} · {String(row.reason ?? '')}{' '}
                  <Version value={Number(row.version ?? 0)} />
                  {row.status === 'PROPOSED' && (
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('消费复核已提交', async () => {
                          await api.post(`/v1/training/consumptions/${String(row.id)}/commands`, {
                            commandId: commandId(),
                            action: 'REVIEW',
                            expectedVersion: Number(row.version),
                            reason: reasonText(reason),
                          });
                        })
                      }
                    >
                      独立复核消费
                    </button>
                  )}
                  {row.status === 'PROPOSED' && (
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('课次消费已退回', async () => {
                          await api.post(`/v1/training/consumptions/${String(row.id)}/commands`, {
                            commandId: commandId(),
                            action: 'REJECT',
                            expectedVersion: Number(row.version),
                            reason: reasonText(reason),
                          });
                        })
                      }
                    >
                      退回课次消费
                    </button>
                  )}
                </p>
              ))}
              <label>
                授课记录
                <textarea
                  aria-label="授课记录"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={action.busy || !data.capabilities.enabled}
                onClick={() =>
                  submit('授课记录已提交', async () => {
                    await api.post(`/v1/training/sessions/${String(roster.session.id)}/commands`, {
                      commandId: commandId(),
                      action: 'DELIVER',
                      expectedVersion: Number(roster.session.version),
                      reason: reasonText(reason),
                    });
                  })
                }
              >
                提交授课事实
              </button>
            </section>
          )}
          <section className="panel">
            <h2>本机构教练</h2>
            <p>
              审核通过由另一位管理人员执行。本人确认只对教练本人有效，页面隐藏不能代替服务端判断。
            </p>
            <textarea
              aria-label="教练与退费说明"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {data.coaches.length === 0 && <p>暂无教练。</p>}
            <ul>
              {data.coaches.map((coach) => (
                <li key={String(coach.id)}>
                  {String(coach.display_name ?? coach.id)} · {String(coach.status ?? '待审核')}{' '}
                  <Version value={Number(coach.version ?? 0)} />
                  {coach.consented !== true && (
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('已提交本人确认', () =>
                          api
                            .post(`/v1/training/coaches/${String(coach.id)}/commands`, {
                              commandId: commandId(),
                              action: 'CONSENT',
                              expectedVersion: Number(coach.version),
                            })
                            .then(() => undefined),
                        )
                      }
                    >
                      本人确认教练职责
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={action.busy || !data.capabilities.enabled}
                    onClick={() =>
                      submit('教练审核已提交', async () => {
                        await api.post(`/v1/training/coaches/${String(coach.id)}/commands`, {
                          commandId: commandId(),
                          action: 'APPROVE',
                          expectedVersion: Number(coach.version),
                          reason: reasonText(reason),
                        });
                      })
                    }
                  >
                    独立审核教练
                  </button>
                  <button
                    type="button"
                    disabled={action.busy || !data.capabilities.enabled}
                    onClick={() =>
                      submit('教练退回已提交', async () => {
                        await api.post(`/v1/training/coaches/${String(coach.id)}/commands`, {
                          commandId: commandId(),
                          action: 'REJECT',
                          expectedVersion: Number(coach.version),
                          reason: reasonText(reason),
                        });
                      })
                    }
                  >
                    退回教练登记
                  </button>
                  {coach.status === 'APPROVED' && (
                    <button
                      type="button"
                      disabled={action.busy || !data.capabilities.enabled}
                      onClick={() =>
                        submit('教练暂停已提交', async () => {
                          await api.post(`/v1/training/coaches/${String(coach.id)}/commands`, {
                            commandId: commandId(),
                            action: 'SUSPEND',
                            expectedVersion: Number(coach.version),
                            reason: reasonText(reason),
                          });
                        })
                      }
                    >
                      暂停教练资格
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <CoachForm
              busy={action.busy || !data.capabilities.enabled}
              onCreate={(body) =>
                submit('教练已登记，尚待本人确认和独立审核', () =>
                  api
                    .post(`/v1/orgs/${encodeURIComponent(orgId)}/training/coaches`, body)
                    .then(() => undefined),
                )
              }
            />
          </section>
          <section className="panel">
            <h2>本机构报名</h2>
            {data.enrollments.length === 0 && <p>暂无报名。</p>}
            <ul>
              {data.enrollments.map((row) => (
                <li key={String(row.id)}>
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const token = reads.next();
                        const next = await api.trainingEnrollment(String(row.id));
                        if (reads.current(token)) setEnrollment(next);
                      }, '已读取报名')
                    }
                  >
                    {String(row.state)} · 学员 {String(row.learner_user_id)}
                  </button>{' '}
                  <Version value={Number(row.version)} />
                </li>
              ))}
            </ul>
            {enrollment && Array.isArray(enrollment.refunds) && (
              <article aria-label="报名退费">
                <h3>退费复核</h3>
                <p>
                  收费退款批准后，还须在统一交易页审核并发送。这里只提交原复核命令，不表示款项已到账。
                </p>
                {enrollment.refunds.length === 0 && <p>暂无退费申请。</p>}
                <ul>
                  {enrollment.refunds.filter(objectRecord).map((refund) => (
                    <li key={String(refund.id)}>
                      {String(refund.status)} · {fenText(Number(refund.amount_fen ?? 0))} ·{' '}
                      {String(refund.reason ?? '')}
                      {refund.status === 'PENDING_REVIEW' && (
                        <>
                          <button
                            type="button"
                            disabled={action.busy}
                            onClick={() =>
                              submit('退费复核已提交，到账以统一交易回执为准', async () => {
                                await api.post(
                                  `/v1/training/refunds/${String(refund.id)}/commands`,
                                  {
                                    commandId: commandId(),
                                    action: 'APPROVE',
                                    expectedVersion: Number(refund.version),
                                    reason: reasonText(reason),
                                  },
                                );
                              })
                            }
                          >
                            独立批准逐课退费
                          </button>
                          <button
                            type="button"
                            disabled={action.busy}
                            onClick={() =>
                              submit('已驳回退费申请', async () => {
                                await api.post(
                                  `/v1/training/refunds/${String(refund.id)}/commands`,
                                  {
                                    commandId: commandId(),
                                    action: 'REJECT',
                                    expectedVersion: Number(refund.version),
                                    reason: reasonText(reason),
                                  },
                                );
                              })
                            }
                          >
                            驳回并保留补课权益
                          </button>
                        </>
                      )}
                      {(refund.status === 'PENDING' || refund.status === 'UNKNOWN') && (
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() =>
                            submit('已按原退款回执刷新', async () => {
                              await api.post(`/v1/training/refunds/${String(refund.id)}/commands`, {
                                commandId: commandId(),
                                action: 'REFRESH',
                                expectedVersion: Number(refund.version),
                              });
                            })
                          }
                        >
                          刷新退款回执
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {Array.isArray(enrollment.consumptions) &&
                  enrollment.consumptions.filter(objectRecord).map((row) =>
                    row.status === 'PROPOSED' ? (
                      <p key={String(row.id)}>
                        {String(row.status)} · {String(row.reason ?? '')}
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() =>
                            submit('消费复核已提交', async () => {
                              await api.post(
                                `/v1/training/consumptions/${String(row.id)}/commands`,
                                {
                                  commandId: commandId(),
                                  action: 'REVIEW',
                                  expectedVersion: Number(row.version),
                                  reason: reasonText(reason),
                                },
                              );
                            })
                          }
                        >
                          独立复核消费
                        </button>
                      </p>
                    ) : null,
                  )}
              </article>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ProviderForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState('');
  const [evidence, setEvidence] = useState('');
  const [until, setUntil] = useState('');
  const [formError, setFormError] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = new Date(`${until}T23:59:59+08:00`);
        if (!until || !Number.isFinite(parsed.getTime())) {
          setFormError('请填写有效的资质到期日');
          return;
        }
        setFormError('');
        onCreate({
          commandId: commandId(),
          name: name.trim(),
          evidenceReference: evidence.trim(),
          qualifiedUntil: parsed.toISOString(),
        });
      }}
    >
      <label>
        主体名称
        <input aria-label="主体名称" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        资质证明编号
        <input
          aria-label="资质证明编号"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        资质到期日
        <input
          aria-label="资质到期日"
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
      </label>
      {formError && <p role="alert">{formError}</p>}
      <button type="submit" disabled={busy}>
        提交培训主体
      </button>
    </form>
  );
}

function CohortForm({
  courses,
  courts,
  coaches,
  busy,
  onCreate,
}: {
  courses: Record<string, unknown>[];
  courts: { id: string; name: string }[];
  coaches: Record<string, unknown>[];
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [courseId, setCourseId] = useState('');
  const [courtId, setCourtId] = useState('');
  const [coachId, setCoachId] = useState('');
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('8');
  const [price, setPrice] = useState('');
  const [weight, setWeight] = useState('');
  const [terms, setTerms] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [formError, setFormError] = useState('');
  const sessionEnd = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)
    ? new Date(`${end}:00+08:00`).getTime()
    : Number.NaN;
  const available = coaches.filter((coach) => schedulableCoach(coach, sessionEnd));
  return (
    <form
      aria-label="建立班期"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const startsAt = chinaIso(start);
          const endsAt = chinaIso(end);
          const coach = available.find((row) => row.id === coachId);
          if (!coach || typeof coach.id !== 'string')
            throw new Error('请选择已确认且资质覆盖本课次的教练');
          const totalFen = yuanToFen(price);
          const priceWeight = lessonWeight(weight, totalFen);
          setFormError('');
          onCreate({
            commandId: commandId(),
            courseId,
            courtId,
            title: title.trim(),
            address: address.trim(),
            capacity: Number(capacity),
            totalFen,
            termsText: terms.trim(),
            enrollmentDeadline: new Date(Date.parse(startsAt) - 3600000).toISOString(),
            sessions: [
              {
                startsAt,
                endsAt,
                bufferMinutes: 15,
                priceWeight,
                coachIds: [coach.id],
              },
            ],
          });
        } catch (cause) {
          setFormError(cause instanceof Error ? cause.message : '请修正后再提交');
        }
      }}
    >
      <label>
        课程
        <select aria-label="课程" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">选择课程</option>
          {courses.map((course) => (
            <option key={String(course.id)} value={String(course.id)}>
              {String(course.title ?? course.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        场地
        <select aria-label="场地" value={courtId} onChange={(e) => setCourtId(e.target.value)}>
          <option value="">选择场地</option>
          {courts.map((court) => (
            <option key={court.id} value={court.id}>
              {court.name}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label="班期名称"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="班期名称"
      />
      <input
        aria-label="上课地点"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="上课地点"
      />
      <input aria-label="名额" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      <input
        aria-label="班期金额"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="金额（元）"
      />
      <textarea aria-label="培训条款" value={terms} onChange={(e) => setTerms(e.target.value)} />
      <label>
        课次教练
        <select aria-label="课次教练" value={coachId} onChange={(e) => setCoachId(e.target.value)}>
          <option value="">选择教练</option>
          {available.map((coach) => (
            <option key={String(coach.id)} value={String(coach.id)}>
              {String(coach.display_name ?? coach.id)}
            </option>
          ))}
        </select>
      </label>
      {available.length === 0 && (
        <p role="alert">
          没有可排课的教练。请先完成本人确认、独立审核，并保证资质覆盖课次结束时间。
        </p>
      )}
      <input
        aria-label="课次价格权重"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="收费为正整数，免费为 0"
      />
      <input
        aria-label="课次开始"
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <input
        aria-label="课次结束"
        type="datetime-local"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />
      {formError && <p role="alert">{formError}</p>}
      <button type="submit" disabled={busy || !courseId || !courtId}>
        建立班期草稿
      </button>
    </form>
  );
}

function CohortActions({
  cohort,
  reason,
  busy,
  onReason,
  onCommand,
  onRoster,
}: {
  cohort: TrainingCohortData;
  reason: string;
  busy: boolean;
  onReason: (value: string) => void;
  onCommand: (body: Record<string, unknown>) => void;
  onRoster: (sessionId: string) => void;
}) {
  function send(command: string) {
    const body: Record<string, unknown> = {
      commandId: commandId(),
      action: command,
      expectedVersion: cohort.version,
    };
    if (command !== 'PUBLISH') body.reason = reason;
    onCommand(body);
  }
  return (
    <article>
      <h3>
        {cohort.title} · {cohortLabels[cohort.state] ?? cohort.state}{' '}
        <Version value={cohort.version} />
      </h3>
      <p>
        {fenText(cohort.totalFen)} · 剩余 {cohort.available}/{cohort.capacity}
      </p>
      {cohort.capabilities.canManage && cohort.state === 'DRAFT' && (
        <button type="button" disabled={busy} onClick={() => send('PUBLISH')}>
          发布班期
        </button>
      )}
      {cohort.capabilities.canManage && ['ENROLLING', 'RUNNING'].includes(cohort.state) && (
        <button type="button" disabled={busy} onClick={() => send('SUSPEND')}>
          暂停班期
        </button>
      )}
      {cohort.capabilities.canManage && cohort.state === 'SUSPENDED' && (
        <button
          type="button"
          disabled={busy || !cohort.capabilities.canResume}
          onClick={() => send('RESUME')}
          title={cohort.capabilities.resumeBlocker ?? ''}
        >
          恢复班期
        </button>
      )}
      {cohort.capabilities.canManage && (
        <button
          type="button"
          disabled={busy || !cohort.capabilities.canComplete}
          onClick={() => send('COMPLETE')}
          title={cohort.capabilities.completionBlocker ?? ''}
        >
          结课
        </button>
      )}
      {cohort.capabilities.canManage && !['COMPLETED', 'CANCELLED'].includes(cohort.state) && (
        <button type="button" disabled={busy} onClick={() => send('CANCEL')}>
          取消未授课课次
        </button>
      )}
      {cohort.sessions.map((session) => (
        <button key={session.id} type="button" onClick={() => onRoster(session.id)}>
          查看课次名单 {session.startsAt}
        </button>
      ))}
      <textarea
        aria-label={`${cohort.title}说明`}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
      />
    </article>
  );
}

function schedulableCoach(coach: Record<string, unknown>, sessionEnd: number) {
  if (typeof coach.id !== 'string' || coach.status !== 'APPROVED' || coach.consented !== true)
    return false;
  if (typeof coach.qualified_until !== 'string') return false;
  const until = Date.parse(coach.qualified_until);
  if (!Number.isFinite(until)) return false;
  if (Number.isFinite(sessionEnd)) return until >= sessionEnd;
  return until > Date.now();
}

function lessonWeight(raw: string, totalFen: number) {
  if (!/^\d+$/.test(raw.trim())) throw new Error('课次价格权重须为整数');
  const weight = Number(raw.trim());
  if (!Number.isSafeInteger(weight) || weight < 0 || weight > 100000000)
    throw new Error('课次价格权重须为整数');
  if (totalFen > 0 && weight <= 0) throw new Error('收费班期的课次权重须为正整数');
  if (totalFen === 0 && weight !== 0) throw new Error('免费班期的课次权重须为 0');
  return weight;
}

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function CoachForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [evidence, setEvidence] = useState('');
  const [until, setUntil] = useState('');
  const [formError, setFormError] = useState('');
  return (
    <form
      aria-label="登记教练"
      onSubmit={(event) => {
        event.preventDefault();
        const day = until.trim();
        if (
          !userId.trim() ||
          !name.trim() ||
          !evidence.trim() ||
          !/^\d{4}-\d{2}-\d{2}$/.test(day)
        ) {
          setFormError('请填写教练账号、姓名、资质编号和到期日期');
          return;
        }
        const qualifiedUntil = new Date(`${day}T23:59:59+08:00`);
        if (!Number.isFinite(qualifiedUntil.getTime())) {
          setFormError('资质日期无效');
          return;
        }
        setFormError('');
        onCreate({
          commandId: commandId(),
          userId: userId.trim(),
          displayName: name.trim(),
          evidenceReference: evidence.trim(),
          qualifiedUntil: qualifiedUntil.toISOString(),
        });
      }}
    >
      <input aria-label="教练账号" value={userId} onChange={(e) => setUserId(e.target.value)} />
      <input aria-label="教练姓名" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        aria-label="教练资质编号"
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
      />
      <input
        aria-label="教练资质到期"
        type="date"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
      />
      {formError && <p role="alert">{formError}</p>}
      <button type="submit" disabled={busy}>
        登记教练
      </button>
    </form>
  );
}
