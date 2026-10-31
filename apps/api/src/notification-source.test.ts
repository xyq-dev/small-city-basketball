import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { notificationRecipientAllowed, resolveNotificationSource } from './notification-source.js';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const input = { kind: 'MATCH_STARTING' as const, orgId: id(1), eventId: id(2), resourceId: id(3) };
function fixture(
  options: {
    now?: string;
    status?: string;
    rescheduleId?: string | null;
    startsAt?: string;
    command?: string;
    entryStatus?: string;
    exceptionActive?: boolean;
    exceptionVersion?: number;
  } = {},
) {
  const calls: string[] = [];
  const c = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes('FROM organizations o JOIN events'))
        return {
          rows: [
            {
              name: '合成赛事',
              status: 'SCHEDULED',
              now: new Date(options.now ?? '2026-11-01T10:00:00Z'),
            },
          ],
        };
      if (sql.includes('FROM published_matches'))
        return {
          rows: [
            {
              id: id(3),
              status: options.status ?? 'SCHEDULED',
              starts_at: new Date(options.startsAt ?? '2026-11-01T11:00:00Z'),
              court_id: id(4),
              home_team_id: id(5),
              away_team_id: id(6),
              reschedule_id: options.rescheduleId ?? null,
              new_starts_at: new Date(options.startsAt ?? '2026-11-01T11:00:00Z'),
              new_court_id: id(4),
            },
          ],
        };
      if (sql.includes('FROM match_exception_heads'))
        return {
          rows:
            options.exceptionActive || options.exceptionVersion !== undefined
              ? [
                  {
                    version: options.exceptionVersion ?? 1,
                    active_request_id: options.exceptionActive ? id(11) : null,
                  },
                ]
              : [],
        };
      if (sql.includes('FROM entries n'))
        return {
          rows: [
            {
              id: id(3),
              team_id: id(5),
              status: options.entryStatus ?? 'APPROVED',
              review_id: id(7),
              command: options.command ?? 'APPROVE',
              reviewed_at: new Date('2026-11-01T09:00:00Z'),
            },
          ],
        };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { c, calls };
}
describe('notifications derive only current authoritative source facts', () => {
  it('uses the DB clock and configurable pre-start lead without including volatile read time in its fingerprint', async () => {
    const a = await resolveNotificationSource(fixture().c, input, 15);
    const b = await resolveNotificationSource(
      fixture({ now: '2026-11-01T10:10:00Z' }).c,
      input,
      15,
    );
    expect(a!.dueAt.toISOString()).toBe('2026-11-01T10:45:00.000Z');
    expect(a!.expiresAt.toISOString()).toBe('2026-11-01T11:00:00.000Z');
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect((await resolveNotificationSource(fixture().c, input, 30))!.dueAt.toISOString()).toBe(
      '2026-11-01T10:30:00.000Z',
    );
    expect((await resolveNotificationSource(fixture().c, input, 30))!.fingerprint).not.toBe(
      a!.fingerprint,
    );
  });
  it('blocks cancelled or forfeited physical SCHEDULED rows and gives reinstatement a fresh generation', async () => {
    expect(await resolveNotificationSource(fixture({ exceptionActive: true }).c, input)).toBeNull();
    const first = await resolveNotificationSource(fixture().c, input);
    const reinstated = await resolveNotificationSource(fixture({ exceptionVersion: 2 }).c, input);
    expect(reinstated).not.toBeNull();
    expect(reinstated!.fingerprint).not.toBe(first!.fingerprint);
    expect(
      await resolveNotificationSource(fixture({ now: '2026-11-01T11:00:00Z' }).c, input),
    ).toBeNull();
  });
  it.each(['LIVE', 'FINAL', 'CANCELLED'])(
    'cannot prepare an old start reminder for status %s',
    async (status) => {
      expect(await resolveNotificationSource(fixture({ status }).c, input)).toBeNull();
    },
  );
  it('does not generate a reschedule notification without actual immutable reschedule proof', async () => {
    expect(
      await resolveNotificationSource(fixture().c, { ...input, kind: 'MATCH_RESCHEDULED' }),
    ).toBeNull();
    const a = await resolveNotificationSource(fixture({ rescheduleId: id(8) }).c, {
      ...input,
      kind: 'MATCH_RESCHEDULED',
    });
    const b = await resolveNotificationSource(fixture({ rescheduleId: id(9) }).c, {
      ...input,
      kind: 'MATCH_RESCHEDULED',
    });
    expect(a).not.toBeNull();
    expect(a!.fingerprint).not.toBe(b!.fingerprint);
  });
  it('does not infer registration approval from a stale review row or copy private rejection reasons', async () => {
    const good = await resolveNotificationSource(fixture().c, {
      ...input,
      kind: 'REGISTRATION_REVIEW',
    });
    expect(good!.detail).toBe('报名审核通过');
    expect(good!.time).toBe('2026-11-01T09:00:00.000Z');
    expect(
      await resolveNotificationSource(fixture({ command: 'APPROVE', entryStatus: 'WITHDRAWN' }).c, {
        ...input,
        kind: 'REGISTRATION_REVIEW',
      }),
    ).toBeNull();
  });
  it('never lets a public follower receive private registration reviews', async () => {
    const f = fixture(),
      source = (await resolveNotificationSource(f.c, { ...input, kind: 'REGISTRATION_REVIEW' }))!;
    expect(await notificationRecipientAllowed(f.c, source, id(10))).toBe(false);
    expect(f.calls.some((x) => x.includes('FROM event_follows'))).toBe(false);
    expect(f.calls.some((x) => x.includes('organization_memberships m'))).toBe(true);
  });
});
