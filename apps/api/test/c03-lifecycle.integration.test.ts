import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Response } from 'supertest';
import type {
  EventData,
  EventLifecycleCommandInput,
  EventLifecycleData,
  EventStandingsData,
  PublicScheduleMatchData,
  ScoringCommandPayload,
  ScoringCommandResponse,
} from '@small-city-basketball/contracts';
import { call, data, error, eventPath, eventsPath, membership, staffPath } from './support.js';
import type { User } from './support.js';
import { blockedPid, revisionsPath } from './p04-support.js';
import { registrationCommandsPath } from './p03-support.js';
import {
  input as rescheduleInput,
  rescheduling,
  rescheduleCommandsPath,
} from './p04-rescheduling-support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  envelope,
  finish,
  leasePath,
  liveMatch,
  prepare,
  published,
  receiptPath,
  release,
  renew,
  sendCommand,
  start,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  anonymous,
  confirmMatch,
  defaultStandingsRules,
  disable,
  enable,
  privateStandings,
  publicEventPath,
  publicMatchPath,
  publicSchedulePath,
  publicStandingsPath,
  savePublishRules,
  standingsCommandsPath,
  standingsRulesPath,
  viewingCommand,
  withRowsLocked,
} from './p05b-support.js';
import { bootstrap, issue, overlayCookie, overlaySnapshot, revoke } from './p06-support.js';

const lifecyclePath = (org: string, id: string) => `${eventPath(org, id)}/lifecycle`;
const lifecycleCommandsPath = (org: string, id: string) =>
  `${eventPath(org, id)}/lifecycle-commands`;
const reject = (response: Response, status: number, code?: string) => {
  error(response, status);
  if (code) expect(response.body.error.code).toBe(code);
};

describe(
  'C03 explicit event lifecycle and history on isolated PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    const current = async (eventId: string, actor: User = h.owner) =>
      data<EventLifecycleData>(
        await call(h.api, 'get', lifecyclePath(h.owner.orgId, eventId), { cookie: actor.cookie }),
      );
    const command = async (
      eventId: string,
      type: EventLifecycleCommandInput['type'],
      expectedEventVersion?: number,
      actor: User = h.owner,
    ) =>
      call(h.api, 'post', lifecycleCommandsPath(h.owner.orgId, eventId), {
        cookie: actor.cookie,
        body: {
          type,
          expectedEventVersion: expectedEventVersion ?? (await current(eventId)).event.version,
          reason: '合成赛事独立复核',
        },
      });
    async function finished() {
      const fixture = await published(h, h.teams.slice(0, 2));
      await savePublishRules(h, fixture.event.event.id);
      const result = await confirmMatch(h, fixture);
      return { fixture, result, eventId: fixture.event.event.id };
    }
    async function oldKeysAreGone(publicEventId: string, publicMatchId: string) {
      for (const path of [
        publicEventPath(publicEventId),
        publicStandingsPath(publicEventId),
        publicSchedulePath(publicEventId),
        publicMatchPath(publicEventId, publicMatchId),
      ])
        reject(await anonymous(h, path), 404, 'RESOURCE_NOT_FOUND');
    }
    async function publicMatchId(publicEventId: string) {
      return data<PublicScheduleMatchData[]>(
        await anonymous(h, publicSchedulePath(publicEventId)),
      )[0]!.publicMatchId;
    }

    test('requires published locked sources and all effective FINAL results without changing a blocked event', async () => {
      const fixture = await published(h, h.teams.slice(0, 3));
      const eventId = fixture.event.event.id;
      const initial = await current(eventId);
      expect(initial.completion).toMatchObject({
        totalMatchCount: 3,
        confirmedMatchCount: 0,
        ready: false,
        blockers: expect.arrayContaining(['STANDINGS_RULES_REQUIRED', 'UNCONFIRMED_MATCHES']),
      });
      const failed = await command(eventId, 'COMPLETE', initial.event.version);
      reject(failed, 422, 'EVENT_COMPLETION_BLOCKED');
      expect((await current(eventId)).event).toEqual(initial.event);
      await savePublishRules(h, eventId);
      await confirmMatch(h, fixture, 0);
      const partial = await current(eventId);
      expect(partial.completion).toMatchObject({
        confirmedMatchCount: 1,
        ready: false,
        blockers: ['UNCONFIRMED_MATCHES'],
      });
      reject(await command(eventId, 'COMPLETE'), 422, 'EVENT_COMPLETION_BLOCKED');
      reject(await command(eventId, 'ARCHIVE'), 409, 'INVALID_EVENT_STATE');
      reject(await command(eventId, 'REOPEN'), 409, 'INVALID_EVENT_STATE');
      reject(await viewingCommand(h, eventId, 'ENABLE_HISTORY'), 409, 'INVALID_EVENT_STATE');
    });

    test('manager authority is actual per-event access and every lifecycle route is organization scoped', async () => {
      const { eventId } = await finished();
      const version = (await current(eventId)).event.version;
      reject(await call(h.api, 'get', lifecyclePath(h.owner.orgId, eventId)), 401);
      reject(
        await call(h.api, 'post', lifecycleCommandsPath(h.owner.orgId, eventId), {
          body: { type: 'COMPLETE', expectedEventVersion: version, reason: '合成赛事独立复核' },
        }),
        401,
      );
      reject(
        await call(h.api, 'get', lifecyclePath(h.otherOwner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      reject(
        await call(h.api, 'post', lifecycleCommandsPath(h.otherOwner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
          body: { type: 'COMPLETE', expectedEventVersion: version, reason: '合成赛事独立复核' },
        }),
        404,
      );
      // Organization EVENT_MANAGER without an actual event_staff grant gets no event access.
      reject(
        await call(h.api, 'get', lifecyclePath(h.owner.orgId, eventId), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      await membership(h.api, h.owner, h.leader, 'REVIEWER');
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.leader.id), {
          cookie: h.owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
      expect((await current(eventId, h.leader)).capabilities).toEqual({
        canComplete: false,
        canArchive: false,
        canReopen: false,
      });
      reject(await command(eventId, 'COMPLETE', version, h.leader), 403, 'FORBIDDEN');
      // A distinct non-scoring actual manager may perform event closure.
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, eventId, h.leader.id), {
          cookie: h.owner.cookie,
          body: { role: 'EVENT_MANAGER', status: 'ACTIVE' },
        }),
      );
      const changed = data<EventLifecycleData>(
        await command(eventId, 'COMPLETE', version, h.leader),
      );
      expect(changed.event.status).toBe('COMPLETED');
      reject(await command(eventId, 'ARCHIVE', version), 409, 'VERSION_CONFLICT');
    });

    test('completion revokes live keys, history is explicit, archive retains only that grant, and old keys never revive', async () => {
      const { eventId, result } = await finished();
      const source = (await current(eventId)).completion.sourceHash;
      const live = (await enable(h, eventId)).publication!;
      expect(live.purpose).toBe('LIVE');
      const liveMatchId = await publicMatchId(live.publicEventId);
      const completed = data<EventLifecycleData>(await command(eventId, 'COMPLETE'));
      expect(completed).toMatchObject({
        event: { status: 'COMPLETED' },
        completion: { ready: true, sourceHash: source },
        capabilities: { canComplete: false, canArchive: true, canReopen: true },
      });
      expect((await workbench(h, result.matchId)).match.status).toBe('FINAL');
      await oldKeysAreGone(live.publicEventId, liveMatchId);
      reject(await viewingCommand(h, eventId, 'ENABLE'), 409, 'INVALID_EVENT_STATE');
      const history = data<EventStandingsData>(
        await viewingCommand(h, eventId, 'ENABLE_HISTORY'),
      ).publication!;
      expect(history).toMatchObject({ purpose: 'HISTORY', status: 'ACTIVE' });
      expect(history.publicEventId).not.toBe(live.publicEventId);
      const historyMatchId = await publicMatchId(history.publicEventId);
      data(await anonymous(h, publicMatchPath(history.publicEventId, historyMatchId)));
      data<EventLifecycleData>(await command(eventId, 'ARCHIVE'));
      expect(
        data<{ status: string }>(await anonymous(h, publicEventPath(history.publicEventId))).status,
      ).toBe('ARCHIVED');
      const listing = data<EventData[]>(
        await call(h.api, 'get', `${eventsPath(h.owner.orgId)}?status=ARCHIVED`, {
          cookie: h.owner.cookie,
        }),
      );
      expect(listing.some((event) => event.id === eventId)).toBe(true);
      data<EventLifecycleData>(await command(eventId, 'REOPEN'));
      expect((await workbench(h, result.matchId)).match.status).toBe('FINAL');
      await oldKeysAreGone(history.publicEventId, historyMatchId);
      await oldKeysAreGone(live.publicEventId, liveMatchId);
      const finalAgain = data<EventLifecycleData>(await command(eventId, 'COMPLETE'));
      expect(finalAgain.completion.sourceHash).toBe(source);
      const newHistory = data<EventStandingsData>(
        await viewingCommand(h, eventId, 'ENABLE_HISTORY'),
      ).publication!;
      expect(newHistory.publicEventId).not.toBe(history.publicEventId);
      await oldKeysAreGone(history.publicEventId, historyMatchId);
      await oldKeysAreGone(live.publicEventId, liveMatchId);
      await disable(h, eventId);
      reject(await anonymous(h, publicEventPath(newHistory.publicEventId)), 404);
    });

    test('closed events reject all business scoring commands and command replays, while reads, release and personnel revocation remain available', async () => {
      const { eventId, fixture, result } = await finished();
      data<EventLifecycleData>(await command(eventId, 'COMPLETE'));
      data<EventLifecycleData>(await command(eventId, 'ARCHIVE'));
      const wb = await workbench(h, result.matchId);
      expect(wb.capabilities).toEqual({
        canManageStaff: true,
        canPrepare: false,
        canAcquireControl: false,
        canRecord: false,
        canCorrect: false,
        canConfirm: false,
        canReopen: false,
      });
      const commands: ScoringCommandPayload[] = [
        { type: 'PREPARE_MATCH', payload: { expectedEventVersion: wb.event.version } },
        { type: 'START_MATCH', payload: { expectedEventVersion: wb.event.version } },
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        {
          type: 'ADD_CORRECTION',
          payload: { kind: 'SCORE', side: 'HOME', value: 1, period: 1, reason: '合成分数更正' },
        },
        { type: 'VOID_STAT', payload: { targetEventId: randomUUID(), reason: '合成分数更正' } },
        {
          type: 'REPLACE_STAT',
          payload: { targetEventId: randomUUID(), side: 'HOME', value: 1, reason: '合成分数更正' },
        },
        { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '合成时钟更正' } },
        { type: 'CLOCK_START', payload: {} },
        { type: 'CLOCK_PAUSE', payload: {} },
        { type: 'NEXT_PERIOD', payload: {} },
        { type: 'START_OVERTIME', payload: {} },
        { type: 'END_MATCH', payload: {} },
        { type: 'CONFIRM_RESULT', payload: {} },
        { type: 'REOPEN_RESULT', payload: { reason: '合成重新复核' } },
      ];
      for (const cmd of commands) {
        const management = ['PREPARE_MATCH', 'CONFIRM_RESULT', 'REOPEN_RESULT'].includes(cmd.type);
        reject(
          await sendCommand(
            h,
            result.matchId,
            management ? h.owner : h.otherOwner,
            envelope(wb.match.version, cmd, management ? undefined : result.lease),
          ),
          409,
          'INVALID_EVENT_STATE',
        );
      }
      // Replay of an already accepted confirmation is rejected by the write endpoint.
      const receipt = result.confirmed.receipt;
      const replay = envelope(receipt.appliedVersion - 1, { type: 'CONFIRM_RESULT', payload: {} });
      replay.commandId = receipt.commandId;
      reject(await sendCommand(h, result.matchId, h.owner, replay), 409, 'INVALID_EVENT_STATE');
      data(
        await call(h.api, 'get', receiptPath(h.owner.orgId, result.matchId, receipt.commandId), {
          cookie: h.owner.cookie,
        }),
      );
      reject(
        await call(h.api, 'post', leasePath(h.owner.orgId, result.matchId), {
          cookie: h.otherOwner.cookie,
          body: { clientInstanceId: randomUUID() },
        }),
        409,
        'INVALID_EVENT_STATE',
      );
      reject(
        await renew(h, result.matchId, h.otherOwner, result.lease),
        409,
        'INVALID_EVENT_STATE',
      );
      data(await release(h, result.matchId, h.otherOwner, result.lease));
      await assign(h, result.matchId, h.otherOwner, 'SCORER', 'DISABLED');
      expect((await current(eventId)).completion.ready).toBe(true);
      reject(
        await call(h.api, 'post', registrationCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: { type: 'OPEN_REGISTRATION', expectedVersion: wb.event.version },
        }),
        422,
        'REGISTRATION_FROZEN',
      );
      reject(
        await call(h.api, 'post', revisionsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            expectedEventVersion: wb.event.version,
            freezeId: fixture.schedule.freezeId,
            algorithmVersion: 'RR_CIRCLE_V1',
            policy: fixture.schedule.policy,
          },
        }),
        409,
        'SCHEDULE_ALREADY_PUBLISHED',
      );
      const plan = await rescheduling(h, result.matchId);
      reject(
        await call(h.api, 'post', rescheduleCommandsPath(h.owner.orgId, result.matchId), {
          cookie: h.owner.cookie,
          body: rescheduleInput(plan),
        }),
        409,
        'INVALID_EVENT_STATE',
      );
      const rank = await privateStandings(h, eventId);
      reject(
        await call(h.api, 'put', standingsRulesPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: { expectedEventVersion: rank.event.version, ...defaultStandingsRules() },
        }),
        409,
        'INVALID_EVENT_STATE',
      );
      reject(
        await call(h.api, 'post', standingsCommandsPath(h.owner.orgId, eventId), {
          cookie: h.owner.cookie,
          body: {
            type: 'PUBLISH_STANDINGS_RULES',
            rulesetId: rank.rules!.id,
            expectedEventVersion: rank.event.version,
          },
        }),
        409,
        'INVALID_EVENT_STATE',
      );
    });

    test('current personal proof inconsistency blocks completion and history, but cannot block security revocation or explicit reopening', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      const matchId = fixture.matches[0]!.id;
      await savePublishRules(h, eventId);
      await assign(h, matchId, h.otherOwner);
      const initial = await workbench(h, matchId);
      await act(h, matchId, h.owner, {
        type: 'PREPARE_MATCH',
        payload: { expectedEventVersion: initial.event.version, collectionMode: 'PLAYER_BASIC' },
      });
      const lease = await acquire(h, matchId);
      await start(h, matchId, h.otherOwner, lease);
      await act(
        h,
        matchId,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: {
            kind: 'SCORE',
            side: 'HOME',
            value: 2,
            memberId: initial.playerRoster.home[0]!.memberId,
          },
        },
        lease,
      );
      await finish(h, matchId, h.otherOwner, lease);
      const confirmed = await act(h, matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const original = confirmed.snapshot.playerStatistics!;
      const damaged = structuredClone(original);
      damaged.home.players[0]!.score++;
      const corrupt = () =>
        h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, matchId, JSON.stringify(damaged)],
        );
      const restore = () =>
        h.api.pool.query(
          'UPDATE scoring_states SET player_stats=$3::jsonb WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, matchId, JSON.stringify(original)],
        );
      try {
        await corrupt();
        expect((await current(eventId)).completion).toMatchObject({
          ready: false,
          blockers: ['RESULT_SOURCE_INVALID'],
        });
        reject(await command(eventId, 'COMPLETE'), 422, 'EVENT_COMPLETION_BLOCKED');
        await restore();
        data<EventLifecycleData>(await command(eventId, 'COMPLETE'));
        const history = data<EventStandingsData>(
          await viewingCommand(h, eventId, 'ENABLE_HISTORY'),
        ).publication!;
        await corrupt();
        reject(
          await anonymous(h, publicEventPath(history.publicEventId)),
          409,
          'RESULT_SOURCE_INVALID',
        );
        // Revocation does not invoke the damaged source validator.
        const before = await current(eventId);
        const disabled = data<EventStandingsData>(
          await viewingCommand(h, eventId, 'DISABLE', before.event.version),
        );
        expect(disabled.publication!.status).toBe('REVOKED');
        const reopen = data<EventLifecycleData>(await command(eventId, 'REOPEN'));
        expect(reopen).toMatchObject({
          event: { status: 'RUNNING' },
          completion: { ready: false, blockers: ['RESULT_SOURCE_INVALID'] },
        });
      } finally {
        await restore();
      }
    });

    test('completion waits for a real confirmation holding the event, then validates its newly committed result', async () => {
      const fixture = await published(h, h.teams.slice(0, 2));
      const eventId = fixture.event.event.id;
      await savePublishRules(h, eventId);
      const live = await liveMatch(h, fixture);
      const pending = await finish(h, live.matchId, h.otherOwner, live.lease);
      const before = await current(eventId);
      await withRowsLocked(
        h,
        'SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, live.matchId],
        1,
        async (pid, unlock, track) => {
          const confirmation = track(
            sendCommand(
              h,
              live.matchId,
              h.owner,
              envelope(pending.snapshot.version, { type: 'CONFIRM_RESULT', payload: {} }),
            ),
          );
          const confirmingPid = await blockedPid(
            h.api.pool,
            pid,
            'Confirmation must hold event SHARE while waiting for its match',
          );
          const completion = track(command(eventId, 'COMPLETE', before.event.version));
          await blockedPid(
            h.api.pool,
            confirmingPid,
            'Lifecycle UPDATE must wait for the confirmation event lock',
          );
          await unlock();
          data<ScoringCommandResponse>(await confirmation);
          expect(data<EventLifecycleData>(await completion)).toMatchObject({
            event: { status: 'COMPLETED' },
            completion: { ready: true, confirmedMatchCount: 1 },
          });
        },
      );
    });

    test('completion waits for an in-flight individual result reopen and rejects its fresh unconfirmed state', async () => {
      const { eventId, result } = await finished();
      const before = await current(eventId);
      await withRowsLocked(
        h,
        'SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, result.matchId],
        1,
        async (pid, unlock, track) => {
          const reopen = track(
            sendCommand(
              h,
              result.matchId,
              h.owner,
              envelope(result.confirmed.snapshot.version, {
                type: 'REOPEN_RESULT',
                payload: { reason: '合成比赛重新复核' },
              }),
            ),
          );
          const reopeningPid = await blockedPid(
            h.api.pool,
            pid,
            'Individual reopen must hold event SHARE while waiting for its match',
          );
          const completion = track(command(eventId, 'COMPLETE', before.event.version));
          await blockedPid(
            h.api.pool,
            reopeningPid,
            'Lifecycle UPDATE must wait for the individual result reopen',
          );
          await unlock();
          data<ScoringCommandResponse>(await reopen);
          reject(await completion, 422, 'EVENT_COMPLETION_BLOCKED');
        },
      );
      expect(await current(eventId)).toMatchObject({
        event: { status: 'RUNNING', version: before.event.version },
        completion: { ready: false, confirmedMatchCount: 0 },
      });
    });

    test('concurrent closure serializes one CAS transition and audit failure rolls back status and all publication revocations', async () => {
      const { eventId } = await finished();
      const live = (await enable(h, eventId)).publication!;
      const before = await current(eventId);
      const identifier = `scb_c03_audit_${randomUUID().replaceAll('-', '')}`;
      for (const value of [h.owner.orgId, eventId]) expect(value).toMatch(/^[0-9a-f-]{36}$/);
      await h.api.pool.query(
        `CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id::text=TG_ARGV[0] AND NEW.resource_id::text=TG_ARGV[1] AND NEW.action LIKE 'event.lifecycle.%' THEN RAISE EXCEPTION 'c03 synthetic audit failure'; END IF; RETURN NEW; END $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${identifier} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${identifier}('${h.owner.orgId}','${eventId}')`,
        );
        const failed = await command(eventId, 'COMPLETE', before.event.version);
        reject(failed, 500, 'INTERNAL_ERROR');
        expect(JSON.stringify(failed.body)).not.toMatch(
          /c03 synthetic|audit_logs|SQLSTATE|postgres/i,
        );
        expect((await current(eventId)).event).toEqual(before.event);
        data(await anonymous(h, publicEventPath(live.publicEventId)));
        expect((await privateStandings(h, eventId)).publication!.status).toBe('ACTIVE');
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${identifier} ON audit_logs`);
        await h.api.pool.query(`DROP FUNCTION IF EXISTS ${identifier}()`);
      }
      const raced = await Promise.all([
        command(eventId, 'COMPLETE', before.event.version),
        command(eventId, 'COMPLETE', before.event.version),
      ]);
      expect(raced.map((response) => response.status).sort()).toEqual([200, 409]);
      reject(
        raced.find((response) => response.status === 409)!,
        409,
        'VERSION_CONFLICT',
      );
      expect((await current(eventId)).event.version).toBe(before.event.version + 1);
      const audit = (
        await h.api.pool.query(
          "SELECT metadata FROM audit_logs WHERE org_id=$1 AND resource_id=$2 AND action='event.lifecycle.complete'",
          [h.owner.orgId, eventId],
        )
      ).rows;
      expect(audit).toEqual([
        {
          metadata: {
            from: 'RUNNING',
            to: 'COMPLETED',
            reason: '合成赛事独立复核',
            expectedEventVersion: before.event.version,
          },
        },
      ]);
    });

    test('history grants do not create, rotate, expire or revoke independent OBS authorization', async () => {
      const { eventId, result } = await finished();
      const obs = await issue(h, result.matchId);
      const session = await bootstrap(h, obs.currentGrant!.overlayId, obs.credential!.token);
      const cookie = overlayCookie(session);
      data(await overlaySnapshot(h, obs.currentGrant!.overlayId, cookie));
      const obsBefore = (
        await h.api.pool.query(
          'SELECT to_jsonb(g) AS grant FROM overlay_grants g WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, eventId],
        )
      ).rows;
      data<EventLifecycleData>(await command(eventId, 'COMPLETE'));
      data<EventStandingsData>(await viewingCommand(h, eventId, 'ENABLE_HISTORY'));
      data<EventLifecycleData>(await command(eventId, 'ARCHIVE'));
      data(await overlaySnapshot(h, obs.currentGrant!.overlayId, cookie));
      expect(
        (
          await h.api.pool.query(
            'SELECT to_jsonb(g) AS grant FROM overlay_grants g WHERE org_id=$1 AND event_id=$2',
            [h.owner.orgId, eventId],
          )
        ).rows,
      ).toEqual(obsBefore);
      await revoke(h, result.matchId);
      reject(await overlaySnapshot(h, obs.currentGrant!.overlayId, cookie), 404);
      // OBS revocation must not revoke the separate history grant.
      const history = (await privateStandings(h, eventId)).publication!;
      data(await anonymous(h, publicEventPath(history.publicEventId)));
    });

    test('migration keeps publication purpose constrained and immutable while revocation is allowed', async () => {
      const { eventId } = await finished();
      const live = (await enable(h, eventId)).publication!;
      const client = await h.api.pool.connect();
      try {
        await client.query('BEGIN');
        await expect(
          client.query(
            "UPDATE public_event_publications SET purpose='HISTORY' WHERE org_id=$1 AND event_id=$2 AND public_event_id=$3",
            [h.owner.orgId, eventId, live.publicEventId],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect((await privateStandings(h, eventId)).publication).toEqual(live);
      await disable(h, eventId);
      expect((await privateStandings(h, eventId)).publication).toMatchObject({
        purpose: 'LIVE',
        status: 'REVOKED',
      });
    });
  },
);
