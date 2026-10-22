import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  ScorekeeperLeaseData,
  EventScoringData,
  ScoreSnapshot,
  ScoringCommandInput,
  ScoringCommandResponse,
  ScoringEventData,
  ScoringWorkbenchData,
} from '@small-city-basketball/contracts';
import { call, data, error, eventually, login, membersPath } from './support.js';
import type { User } from './support.js';
import { APPLICATION_NAME, blockedPid } from './p04-support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  control,
  createScoringHarness,
  envelope,
  eventScoringPath,
  leasePath,
  liveMatch,
  prepare,
  published,
  receiptPath,
  release,
  renew,
  scoringEventsPath,
  sendCommand,
  snapshotPath,
  staffPath,
  start,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';

function leaseConflict(response: Response): void {
  error(response, 409);
  expect(response.body.error.code).toBe('LEASE_CONFLICT');
}

function idempotencyConflict(response: Response): void {
  error(response, 409);
  expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
}

type Track = <T>(pending: Promise<T>) => Promise<T>;

async function whileRowsLocked(
  h: Harness,
  sql: string,
  values: unknown[],
  expectedRows: number,
  run: (pid: number, release: () => Promise<void>, track: Track) => Promise<void>,
): Promise<void> {
  const blocker = await h.api.pool.connect();
  const pending: Promise<unknown>[] = [];
  let released = false;
  const track: Track = (request) => {
    pending.push(request);
    void request.catch(() => undefined);
    return request;
  };
  try {
    await blocker.query('BEGIN');
    const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
      .pid;
    expect((await blocker.query(sql, values)).rowCount).toBe(expectedRows);
    await run(
      pid,
      async () => {
        await blocker.query('COMMIT');
        released = true;
      },
      track,
    );
  } finally {
    try {
      if (!released) await blocker.query('ROLLBACK');
    } finally {
      blocker.release();
      await Promise.allSettled(pending);
    }
  }
}

async function commandStorage(h: Harness, matchId: string, commandId: string) {
  return (
    await h.api.pool.query<{ events: number; receipts: number; audits: number }>(
      `SELECT
       (SELECT count(*)::int FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND command_id=$3::uuid) AS events,
       (SELECT count(*)::int FROM scoring_commands WHERE org_id=$1 AND match_id=$2 AND command_id=$3::uuid) AS receipts,
       (SELECT count(*)::int FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action='scoring.command.accepted' AND metadata->>'commandId'=($3::uuid)::text) AS audits`,
      [h.owner.orgId, matchId, commandId],
    )
  ).rows[0]!;
}

async function scoringFingerprint(h: Harness, eventId: string, matchId: string) {
  const sources = {
    event: 'SELECT * FROM events WHERE org_id=$1 AND id=$2',
    match: 'SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2 AND id=$3',
    rules: 'SELECT * FROM scoring_rulesets WHERE org_id=$1 AND event_id=$2',
    staff: 'SELECT * FROM match_staff WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    state: 'SELECT * FROM scoring_states WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    lease: 'SELECT * FROM scoring_leases WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    events: 'SELECT * FROM scoring_events WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    receipts: 'SELECT * FROM scoring_commands WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    confirmations:
      'SELECT * FROM result_confirmations WHERE org_id=$1 AND event_id=$2 AND match_id=$3',
    audit: 'SELECT * FROM audit_logs WHERE org_id=$1 AND resource_id IN ($2,$3)',
  };
  const result: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(sources)) {
    const parameters = source.includes('$3')
      ? [h.owner.orgId, eventId, matchId]
      : [h.owner.orgId, eventId];
    result[name] = (
      await h.api.pool.query<{ rows: unknown }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(scoped_row) ORDER BY to_jsonb(scoped_row)::text), '[]'::jsonb) AS rows FROM (${source}) scoped_row`,
        parameters,
      )
    ).rows[0]!.rows;
  }
  return result;
}

async function commandEvents(h: Harness, matchId: string, commandId: string) {
  const events = data<ScoringEventData[]>(
    await call(h.api, 'get', `${scoringEventsPath(h.owner.orgId, matchId)}?limit=100`, {
      cookie: h.owner.cookie,
    }),
  );
  return events.filter((event) => event.commandId === commandId);
}

describe(
  'P05 control ownership and command consistency on real PostgreSQL',
  { concurrent: false, shuffle: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('control binds both session and tab identity, renews without a match version change and fences new holders', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      await assign(h, matchId, h.owner);
      await prepare(h, matchId);
      const original = await workbench(h, matchId);
      const clientId = randomUUID();
      const lease = await acquire(h, matchId, h.otherOwner, clientId);
      expect(lease.fencingToken).toMatch(/^[1-9]\d*$/);
      const repeated = await acquire(h, matchId, h.otherOwner, clientId);
      expect(control(repeated)).toEqual(control(lease));
      const renewed = data<ScorekeeperLeaseData>(await renew(h, matchId, h.otherOwner, lease));
      expect(control(renewed)).toEqual(control(lease));
      expect(Date.parse(renewed.expiresAt)).toBeGreaterThanOrEqual(Date.parse(lease.expiresAt));
      for (const attempt of [
        call(h.api, 'post', leasePath(h.owner.orgId, matchId), {
          cookie: h.otherOwner.cookie,
          body: { clientInstanceId: randomUUID() },
        }),
        call(h.api, 'post', leasePath(h.owner.orgId, matchId), {
          cookie: h.owner.cookie,
          body: { clientInstanceId: randomUUID() },
        }),
      ])
        leaseConflict(await attempt);
      const newSession = { ...h.otherOwner, cookie: await login(h.api, h.otherOwner) };
      leaseConflict(
        await call(h.api, 'post', leasePath(h.owner.orgId, matchId), {
          cookie: newSession.cookie,
          body: { clientInstanceId: clientId },
        }),
      );
      const forgedFence = { ...lease, fencingToken: String(BigInt(lease.fencingToken) + 1n) };
      leaseConflict(await renew(h, matchId, h.otherOwner, forgedFence));
      leaseConflict(await release(h, matchId, h.otherOwner, forgedFence));
      expect(control(await acquire(h, matchId, h.otherOwner, clientId))).toEqual(control(lease));
      data(await release(h, matchId, h.otherOwner, lease));
      const next = await acquire(h, matchId, h.owner);
      expect(next.leaseId).not.toBe(lease.leaseId);
      expect(BigInt(next.fencingToken)).toBeGreaterThan(BigInt(lease.fencingToken));
      const unchanged = await workbench(h, matchId);
      expect(unchanged.match.version).toBe(original.match.version);
      expect(unchanged.snapshot!.version).toBe(original.snapshot!.version);
      expect(unchanged.snapshot!.clock.clockVersion).toBe(original.snapshot!.clock.clockVersion);
    });

    test('concurrent identical commands commit one event and replay the original receipt with the current snapshot', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const input = envelope(
        live.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
        live.lease,
      );
      const responses = await Promise.all([
        sendCommand(h, live.matchId, h.otherOwner, input),
        sendCommand(h, live.matchId, h.otherOwner, input),
      ]);
      const [first, second] = responses.map((response) => data<ScoringCommandResponse>(response));
      expect(second!.receipt).toEqual(first!.receipt);
      expect(first!.receipt).toMatchObject({
        commandId: input.commandId,
        matchId: live.matchId,
        type: 'RECORD_STAT',
        appliedVersion: live.snapshot.version + 1,
      });
      expect(await commandEvents(h, live.matchId, input.commandId)).toHaveLength(1);
      expect(await commandStorage(h, live.matchId, input.commandId)).toEqual({
        events: 1,
        receipts: 1,
        audits: 1,
      });
      const current = await workbench(h, live.matchId);
      expect(current.snapshot).toMatchObject({
        version: live.snapshot.version + 1,
        totals: { home: { score: live.snapshot.totals.home.score + 2 } },
      });
      expect(current.snapshot!.clock.clockVersion).toBe(live.snapshot.clock.clockVersion);
      const newer = await act(
        h,
        live.matchId,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'AWAY', value: 1 } },
        live.lease,
      );
      const replay = data<ScoringCommandResponse>(
        await sendCommand(h, live.matchId, h.otherOwner, input),
      );
      expect(replay.receipt).toEqual(first!.receipt);
      expect(replay.snapshot.version).toBe(newer.snapshot.version);
      expect(replay.snapshot.version).toBeGreaterThan(replay.receipt.appliedVersion);
      expect(replay.snapshot.totals).toEqual(newer.snapshot.totals);
      idempotencyConflict(
        await sendCommand(h, live.matchId, h.otherOwner, {
          ...input,
          payload: { kind: 'SCORE', side: 'HOME', value: 3 },
        } as ScoringCommandInput),
      );
      expect(await commandEvents(h, live.matchId, input.commandId)).toHaveLength(1);
    });

    test('concurrent different content under one commandId has one winner and no second score', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const first = envelope(
        live.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        live.lease,
      );
      const different = {
        ...first,
        payload: { kind: 'SCORE', side: 'HOME', value: 3 },
      } as ScoringCommandInput;
      const responses = await Promise.all([
        sendCommand(h, live.matchId, h.otherOwner, first),
        sendCommand(h, live.matchId, h.otherOwner, different),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const accepted = data<ScoringCommandResponse>(
        responses.find((response) => response.status === 200)!,
      );
      idempotencyConflict(responses.find((response) => response.status === 409)!);
      expect(accepted.snapshot.version).toBe(live.snapshot.version + 1);
      expect([1, 3]).toContain(
        accepted.snapshot.totals.home.score - live.snapshot.totals.home.score,
      );
      expect(await commandEvents(h, live.matchId, first.commandId)).toHaveLength(1);
      expect(await commandStorage(h, live.matchId, first.commandId)).toEqual({
        events: 1,
        receipts: 1,
        audits: 1,
      });
      const replayInput = responses[0]!.status === 200 ? first : different;
      const replay = data<ScoringCommandResponse>(
        await sendCommand(h, live.matchId, h.otherOwner, replayInput),
      );
      expect(replay.receipt).toEqual(accepted.receipt);
      expect(replay.snapshot.totals).toEqual(accepted.snapshot.totals);
    });

    test('expired control never revives or releases a new fence and does not pause the running clock', async () => {
      const fixture = await published(h, h.teams.slice(0, 2), { periodDurationSeconds: 120 });
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      await assign(h, matchId, h.owner);
      await prepare(h, matchId);
      const oldLease = await acquire(h, matchId, h.otherOwner);
      const started = await start(h, matchId, h.otherOwner, oldLease);
      const original = envelope(
        started.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
        oldLease,
      );
      const accepted = data<ScoringCommandResponse>(
        await sendCommand(h, matchId, h.otherOwner, original),
      );
      const running = await act(
        h,
        matchId,
        h.otherOwner,
        { type: 'CLOCK_START', payload: {} },
        oldLease,
      );
      expect(running.snapshot.clock.running).toBe(true);
      const changed = await h.api.pool.query(
        "UPDATE scoring_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND match_id=$2",
        [h.owner.orgId, matchId],
      );
      expect(changed.rowCount).toBe(1);
      leaseConflict(await renew(h, matchId, h.otherOwner, oldLease));
      leaseConflict(await release(h, matchId, h.otherOwner, oldLease));
      const afterExpiry = data<ScoreSnapshot>(
        await call(h.api, 'get', snapshotPath(h.owner.orgId, matchId), { cookie: h.owner.cookie }),
      );
      expect(afterExpiry).toMatchObject({
        status: 'LIVE',
        version: running.snapshot.version,
        clock: { running: true, clockVersion: running.snapshot.clock.clockVersion },
      });
      const currentClientId = randomUUID();
      const currentLease = await acquire(h, matchId, h.owner, currentClientId);
      expect(BigInt(currentLease.fencingToken)).toBeGreaterThan(BigInt(oldLease.fencingToken));
      expect(currentLease.leaseId).not.toBe(oldLease.leaseId);
      leaseConflict(await renew(h, matchId, h.otherOwner, oldLease));
      leaseConflict(await release(h, matchId, h.otherOwner, oldLease));
      expect(control(await acquire(h, matchId, h.owner, currentClientId))).toEqual(
        control(currentLease),
      );
      // A committed receipt remains recoverable with the original expired envelope.
      const replay = data<ScoringCommandResponse>(
        await sendCommand(h, matchId, h.otherOwner, original),
      );
      expect(replay.receipt).toEqual(accepted.receipt);
      expect(replay.snapshot.version).toBe(running.snapshot.version);
      expect(replay.snapshot.clock.running).toBe(true);
      leaseConflict(
        await sendCommand(
          h,
          matchId,
          h.otherOwner,
          envelope(replay.snapshot.version, { type: 'CLOCK_PAUSE', payload: {} }, oldLease),
        ),
      );
      const paused = await act(
        h,
        matchId,
        h.owner,
        { type: 'CLOCK_PAUSE', payload: {} },
        currentLease,
      );
      expect(paused.snapshot.clock.running).toBe(false);
      expect(paused.snapshot.version).toBe(running.snapshot.version + 1);
      expect(await commandStorage(h, matchId, original.commandId)).toEqual({
        events: 1,
        receipts: 1,
        audits: 1,
      });
    });

    test('receipt reads wait for the in-flight match transaction before resolving a lost acknowledgement', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const input = envelope(
        live.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 3 } },
        live.lease,
      );
      await whileRowsLocked(
        h,
        'SELECT match_id FROM scoring_states WHERE org_id=$1 AND match_id=$2 FOR UPDATE',
        [h.owner.orgId, live.matchId],
        1,
        async (pid, unlock, track) => {
          const writing = track(sendCommand(h, live.matchId, h.otherOwner, input));
          const writerPid = await blockedPid(
            h.api.pool,
            pid,
            'Scoring command never waited on the externally locked projection',
          );
          const reading = track(
            call(h.api, 'get', receiptPath(h.owner.orgId, live.matchId, input.commandId), {
              cookie: h.otherOwner.cookie,
            }),
          );
          await blockedPid(
            h.api.pool,
            writerPid,
            'Receipt lookup did not wait for the in-flight writer match lock',
          );
          await unlock();
          const applied = data<ScoringCommandResponse>(await writing);
          const recovered = data<ScoringCommandResponse>(await reading);
          expect(recovered.receipt).toEqual(applied.receipt);
          expect(recovered.snapshot.version).toBe(applied.snapshot.version);
          expect(recovered.snapshot.totals).toEqual(applied.snapshot.totals);
        },
      );
      expect(await commandStorage(h, live.matchId, input.commandId)).toEqual({
        events: 1,
        receipts: 1,
        audits: 1,
      });
    }, 30000);

    test('match-staff revocation waits for an in-flight write then prevents replay with the old cookie', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const input = envelope(
        live.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'AWAY', value: 2 } },
        live.lease,
      );
      await whileRowsLocked(
        h,
        'SELECT match_id FROM scoring_states WHERE org_id=$1 AND match_id=$2 FOR UPDATE',
        [h.owner.orgId, live.matchId],
        1,
        async (pid, unlock, track) => {
          const writing = track(sendCommand(h, live.matchId, h.otherOwner, input));
          const writerPid = await blockedPid(
            h.api.pool,
            pid,
            'Scoring write never held the match lock while waiting for its projection',
          );
          const revoking = track(
            call(h.api, 'put', staffPath(h.owner.orgId, live.matchId, h.otherOwner.id), {
              cookie: h.owner.cookie,
              body: {
                expectedMatchVersion: live.snapshot.version + 1,
                role: 'SCORER',
                status: 'DISABLED',
              },
            }),
          );
          await blockedPid(
            h.api.pool,
            writerPid,
            'Staff revocation did not wait for the in-flight match writer',
          );
          await unlock();
          const applied = data<ScoringCommandResponse>(await writing);
          data(await revoking);
          const current = await workbench(h, live.matchId);
          expect(current.match.version).toBe(applied.snapshot.version + 1);
          expect(current.snapshot!.version).toBe(current.match.version);
          expect(current.snapshot!.totals).toEqual(applied.snapshot.totals);
          expect(current.lease.held).toBe(false);
        },
      );
      error(await sendCommand(h, live.matchId, h.otherOwner, input), 404);
      error(
        await call(h.api, 'get', receiptPath(h.owner.orgId, live.matchId, input.commandId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      expect(await commandStorage(h, live.matchId, input.commandId)).toEqual({
        events: 1,
        receipts: 1,
        audits: 1,
      });
    }, 30000);

    test('failed command auditing rolls back Event, match, projection, event sequence, receipt and lease together', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const matchId = fixture.matches[0]!.id;
      await assign(h, matchId, h.otherOwner);
      await prepare(h, matchId);
      const lease = await acquire(h, matchId, h.otherOwner);
      for (const type of ['START_MATCH', 'RECORD_STAT'] as const) {
        const before = await workbench(h, matchId);
        const command =
          type === 'START_MATCH'
            ? envelope(
                before.match.version,
                { type, payload: { expectedEventVersion: before.event.version } },
                lease,
              )
            : envelope(
                before.match.version,
                { type, payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
                lease,
              );
        const original = await scoringFingerprint(h, before.event.id, matchId);
        const identifier = `scb_p05_audit_${randomUUID().replaceAll('-', '')}`;
        for (const id of [h.owner.orgId, matchId, command.commandId])
          expect(id).toMatch(/^[0-9a-f-]{36}$/);
        await h.api.pool.query(
          `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] AND NEW.action='scoring.command.accepted' AND NEW.metadata->>'commandId'=TG_ARGV[2] THEN RAISE EXCEPTION 'p05 command audit failure'; END IF; RETURN NEW; END $$`,
        );
        try {
          await h.api.pool.query(
            `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${matchId}','${command.commandId}')`,
          );
          const refused = await sendCommand(h, matchId, h.otherOwner, command);
          error(refused, 500);
          expect(JSON.stringify(refused.body)).not.toMatch(
            /p05 command audit|audit_logs|SQLSTATE|postgres/i,
          );
          expect(await scoringFingerprint(h, before.event.id, matchId)).toEqual(original);
          expect(await commandStorage(h, matchId, command.commandId)).toEqual({
            events: 0,
            receipts: 0,
            audits: 0,
          });
          const missing = await call(
            h.api,
            'get',
            receiptPath(h.owner.orgId, matchId, command.commandId),
            { cookie: h.otherOwner.cookie },
          );
          error(missing, 404);
          expect(missing.body.error.code).toBe('COMMAND_NOT_FOUND');
        } finally {
          await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
          await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
        }
        const restored = data<ScoringCommandResponse>(
          await sendCommand(h, matchId, h.otherOwner, command),
        );
        expect(restored.receipt.appliedVersion).toBe(before.match.version + 1);
        expect(restored.receipt.firstEventSeq).toBe(before.snapshot!.lastEventSeq + 1);
        expect(restored.receipt.lastEventSeq).toBe(before.snapshot!.lastEventSeq + 1);
        expect(restored.snapshot.lastEventSeq).toBe(before.snapshot!.lastEventSeq + 1);
        expect(await commandStorage(h, matchId, command.commandId)).toEqual({
          events: 1,
          receipts: 1,
          audits: 1,
        });
      }
      const complete = await workbench(h, matchId);
      expect(complete.event.status).toBe('RUNNING');
      expect(complete.snapshot).toMatchObject({ status: 'LIVE', totals: { home: { score: 2 } } });
    });

    test('two matches preparing and initially starting share one Event update order without lock-upgrade deadlocks', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const matchIds = fixture.matches.slice(0, 2).map((match) => match.id);
      expect(matchIds).toHaveLength(2);
      for (const matchId of matchIds) await assign(h, matchId, h.otherOwner);
      const initial = await Promise.all(matchIds.map((id) => workbench(h, id)));
      const initialEventVersion = initial[0]!.event.version;
      expect(initial[1]!.event.version).toBe(initialEventVersion);

      const compete = async (actor: User, inputs: ScoringCommandInput[]) => {
        let responses: Response[] = [];
        await whileRowsLocked(
          h,
          'SELECT id FROM published_matches WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
          [h.owner.orgId, matchIds],
          2,
          async (pid, unlock, track) => {
            const first = track(sendCommand(h, matchIds[0]!, actor, inputs[0]!));
            await blockedPid(
              h.api.pool,
              pid,
              'First match command did not wait for the externally locked match',
            );
            const second = track(sendCommand(h, matchIds[1]!, actor, inputs[1]!));
            await eventually(
              async () =>
                (
                  await h.api.pool.query<{ pid: number }>(
                    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND pid<>$2 AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0",
                    [APPLICATION_NAME, pid],
                  )
                ).rows,
              (waiting) => waiting.length === 2,
              'Both match commands did not reach their lock wait barriers',
            );
            await unlock();
            responses = await Promise.all([first, second]);
          },
        );
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        const rejected = responses.find((response) => response.status === 409)!;
        error(rejected, 409);
        expect(rejected.body.error.code).toBe('VERSION_CONFLICT');
        const failedIndex = responses.findIndex((response) => response.status === 409);
        expect(
          await commandStorage(h, matchIds[failedIndex]!, inputs[failedIndex]!.commandId),
        ).toEqual({ events: 0, receipts: 0, audits: 0 });
        return failedIndex;
      };

      const prepareInputs = initial.map((current) =>
        envelope(current.match.version, {
          type: 'PREPARE_MATCH',
          payload: { expectedEventVersion: initialEventVersion },
        }),
      );
      const retryPrepare = await compete(h.owner, prepareInputs);
      await prepare(h, matchIds[retryPrepare]!);
      const prepared = await Promise.all(matchIds.map((id) => workbench(h, id)));
      for (let index = 0; index < prepared.length; index++) {
        expect(prepared[index]!.match).toMatchObject({
          status: 'READY',
          version: initial[index]!.match.version + 1,
        });
        expect(prepared[index]!.snapshot!.rules.id).toBe(fixture.event.rules!.id);
        expect(prepared[index]!.snapshot!.version).toBe(prepared[index]!.match.version);
      }
      const rulesLocked = data<EventScoringData>(
        await call(h.api, 'get', eventScoringPath(h.owner.orgId, fixture.event.event.id), {
          cookie: h.owner.cookie,
        }),
      );
      expect(rulesLocked.locked).toBe(true);
      expect(rulesLocked.event).toMatchObject({
        status: 'SCHEDULED',
        version: initialEventVersion + 2,
      });
      const leases = await Promise.all(matchIds.map((id) => acquire(h, id, h.otherOwner)));
      const startInputs = prepared.map((current, index) =>
        envelope(
          current.match.version,
          { type: 'START_MATCH', payload: { expectedEventVersion: rulesLocked.event.version } },
          leases[index]!,
        ),
      );
      const retryStart = await compete(h.otherOwner, startInputs);
      await start(h, matchIds[retryStart]!, h.otherOwner, leases[retryStart]!);
      const running = await Promise.all(matchIds.map((id) => workbench(h, id)));
      for (let index = 0; index < running.length; index++) {
        expect(running[index]!.match).toMatchObject({
          status: 'LIVE',
          version: prepared[index]!.match.version + 1,
        });
        expect(running[index]!.snapshot!.version).toBe(running[index]!.match.version);
        expect(running[index]!.event).toMatchObject({
          status: 'RUNNING',
          version: initialEventVersion + 3,
        });
      }
      const accepted = await h.api.pool.query<{ command_type: string; count: number }>(
        'SELECT command_type,count(*)::int AS count FROM scoring_commands WHERE org_id=$1 AND event_id=$2 AND match_id=ANY($3::uuid[]) GROUP BY command_type ORDER BY command_type',
        [h.owner.orgId, fixture.event.event.id, matchIds],
      );
      expect(accepted.rows).toEqual([
        { command_type: 'PREPARE_MATCH', count: 2 },
        { command_type: 'START_MATCH', count: 2 },
      ]);
    }, 60000);

    test('current match and organization revocation precede successful command replay and receipt reads', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const input = envelope(
        live.snapshot.version,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        live.lease,
      );
      const applied = data<ScoringCommandResponse>(
        await sendCommand(h, live.matchId, h.otherOwner, input),
      );
      await assign(h, live.matchId, h.otherOwner, 'SCORER', 'DISABLED');
      for (const response of [
        await sendCommand(h, live.matchId, h.otherOwner, input),
        await call(h.api, 'get', receiptPath(h.owner.orgId, live.matchId, input.commandId), {
          cookie: h.otherOwner.cookie,
        }),
        await call(h.api, 'get', snapshotPath(h.owner.orgId, live.matchId), {
          cookie: h.otherOwner.cookie,
        }),
      ])
        error(response, 404);
      await assign(h, live.matchId, h.otherOwner);
      const restored = data<ScoringCommandResponse>(
        await sendCommand(h, live.matchId, h.otherOwner, input),
      );
      expect(restored.receipt).toEqual(applied.receipt);
      expect(restored.snapshot.version).toBe((await workbench(h, live.matchId)).match.version);
      leaseConflict(
        await sendCommand(
          h,
          live.matchId,
          h.otherOwner,
          envelope(
            restored.snapshot.version,
            { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 2 } },
            live.lease,
          ),
        ),
      );
      data(
        await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'DISABLED' },
        }),
      );
      try {
        error(await sendCommand(h, live.matchId, h.otherOwner, input), 404);
        error(
          await call(h.api, 'get', receiptPath(h.owner.orgId, live.matchId, input.commandId), {
            cookie: h.otherOwner.cookie,
          }),
          404,
        );
      } finally {
        data(
          await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
            cookie: h.owner.cookie,
            body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
          }),
        );
      }
      expect((await workbench(h, live.matchId)).snapshot!.totals).toEqual(applied.snapshot.totals);
      expect(await commandEvents(h, live.matchId, input.commandId)).toHaveLength(1);
    });

    test('an owner can revoke existing match staff after membership disable without reactivating the target or creating disabled assignments', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const live = await liveMatch(h, fixture);
      const before = await workbench(h, live.matchId);
      const leaseRow = async () =>
        (
          await h.api.pool.query<{
            lease_id: string;
            fencing_token: string;
            holder_user_id: string;
            client_instance_id: string;
            expired: boolean;
          }>(
            'SELECT lease_id,fencing_token,holder_user_id,client_instance_id,expires_at<=clock_timestamp() AS expired FROM scoring_leases WHERE org_id=$1 AND match_id=$2',
            [h.owner.orgId, live.matchId],
          )
        ).rows[0]!;
      const originalLease = await leaseRow();
      expect(originalLease.expired).toBe(false);
      const membership = async (status: 'ACTIVE' | 'DISABLED') =>
        data(
          await call(h.api, 'put', `${membersPath(h.owner.orgId)}/${h.otherOwner.id}`, {
            cookie: h.owner.cookie,
            body: { role: 'EVENT_MANAGER', status },
          }),
        );
      const update = (userId: string, status: 'ACTIVE' | 'DISABLED', version: number) =>
        call(h.api, 'put', staffPath(h.owner.orgId, live.matchId, userId), {
          cookie: h.owner.cookie,
          body: { expectedMatchVersion: version, role: 'SCORER', status },
        });
      const missing = (response: Response) => {
        error(response, 404);
        expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
      };

      await membership('DISABLED');
      try {
        const untouched = await scoringFingerprint(h, fixture.event.event.id, live.matchId);
        missing(await update(h.otherOwner.id, 'ACTIVE', before.match.version));
        const stale = await update(h.otherOwner.id, 'DISABLED', before.match.version - 1);
        error(stale, 409);
        expect(stale.body.error.code).toBe('VERSION_CONFLICT');
        expect(await scoringFingerprint(h, fixture.event.event.id, live.matchId)).toEqual(
          untouched,
        );
        const auditsBefore = (
          await h.api.pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action='scoring.staff.updated'",
            [h.owner.orgId, live.matchId],
          )
        ).rows[0]!.count;

        const revoked = data<ScoringWorkbenchData>(
          await update(h.otherOwner.id.toUpperCase(), 'DISABLED', before.match.version),
        );
        expect(revoked.match).toMatchObject({
          status: 'LIVE',
          version: before.match.version + 1,
        });
        expect(revoked.snapshot).toMatchObject({
          version: revoked.match.version,
          totals: before.snapshot!.totals,
          lastEventSeq: before.snapshot!.lastEventSeq,
          clock: { clockVersion: before.snapshot!.clock.clockVersion },
        });
        expect(revoked.staff).toContainEqual(
          expect.objectContaining({ userId: h.otherOwner.id, role: 'SCORER', status: 'DISABLED' }),
        );
        expect(revoked.lease.held).toBe(false);
        expect(await leaseRow()).toEqual({ ...originalLease, expired: true });
        expect(
          (
            await h.api.pool.query<{ source_version: number; status: string }>(
              'SELECT s.source_version,m.status FROM scoring_states s JOIN organization_memberships m ON m.org_id=s.org_id AND m.user_id=$3 WHERE s.org_id=$1 AND s.match_id=$2',
              [h.owner.orgId, live.matchId, h.otherOwner.id],
            )
          ).rows,
        ).toEqual([{ source_version: revoked.match.version, status: 'DISABLED' }]);
        const audits = await h.api.pool.query<{ actor_id: string; metadata: unknown }>(
          "SELECT actor_id,metadata FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action='scoring.staff.updated' ORDER BY created_at,id",
          [h.owner.orgId, live.matchId],
        );
        expect(audits.rows).toHaveLength(auditsBefore + 1);
        expect(audits.rows.at(-1)).toEqual({
          actor_id: h.owner.id,
          metadata: { userId: h.otherOwner.id, role: 'SCORER', status: 'DISABLED' },
        });

        // Restoring organization access must not restore the revoked assignment or control.
        await membership('ACTIVE');
        missing(await renew(h, live.matchId, h.otherOwner, live.lease));
        missing(
          await sendCommand(
            h,
            live.matchId,
            h.otherOwner,
            envelope(
              revoked.match.version,
              { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
              live.lease,
            ),
          ),
        );
        const rejectedBaseline = await scoringFingerprint(h, fixture.event.event.id, live.matchId);
        await h.api.pool.query("UPDATE users SET status='DISABLED' WHERE id=$1", [h.otherOwner.id]);
        missing(await update(h.otherOwner.id, 'ACTIVE', revoked.match.version));
        await h.api.pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [h.otherOwner.id]);
        missing(await update(randomUUID(), 'DISABLED', revoked.match.version));
        missing(await update(h.owner.id, 'DISABLED', revoked.match.version));
        missing(await update(h.leader.id, 'DISABLED', revoked.match.version));
        missing(
          await call(h.api, 'put', staffPath(h.otherOwner.orgId, live.matchId, h.otherOwner.id), {
            cookie: h.otherOwner.cookie,
            body: {
              expectedMatchVersion: revoked.match.version,
              role: 'SCORER',
              status: 'DISABLED',
            },
          }),
        );
        expect(await scoringFingerprint(h, fixture.event.event.id, live.matchId)).toEqual(
          rejectedBaseline,
        );
      } finally {
        await h.api.pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [h.otherOwner.id]);
        await membership('ACTIVE');
      }
    });
  },
);
