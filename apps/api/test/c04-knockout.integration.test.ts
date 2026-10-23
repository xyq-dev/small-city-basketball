import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Response } from 'supertest';
import type {
  EventKnockoutData,
  EventLifecycleData,
  EventPlayerStatisticsData,
  EventStandingsData,
  PublicEventData,
  PublicKnockoutData,
  PublicScheduleMatchData,
  PublishKnockoutRoundInput,
  ScoringCommandResponse,
} from '@small-city-basketball/contracts';
import { call, data, error, staffPath } from './support.js';
import { blockedPid, plusMinutes } from './p04-support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  createScoringHarness,
  defaultRules,
  envelope,
  finish,
  prepare,
  scoringRulesPath,
  sendCommand,
  start,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  anonymous,
  enable,
  publicEventPath,
  publicMatchPath,
  publicSchedulePath,
  publicStandingsPath,
  viewingCommand,
  withRowsLocked,
} from './p05b-support.js';
import { bootstrap, issue, overlayCookie, overlaySnapshot } from './p06-support.js';
import { reschedule, rescheduling } from './p04-rescheduling-support.js';
import {
  confirmKnockoutMatch,
  currentMatches,
  knockoutFacts,
  knockoutFixture,
  knockoutPath,
  lifecycleCommandsPath,
  lifecyclePath,
  playerSummaryPath,
  proofFixtures,
  publicKnockoutPath,
  publishRound,
  readKnockout,
  roundCommandsPath,
  roundInput,
} from './c04-support.js';

const rejected = (response: Response, status: number, code?: string) => {
  error(response, status);
  if (code) expect(response.body.error.code).toBe(code);
};

describe(
  'C04 single-elimination proof and advancement on isolated PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(5);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    const lifecycle = async (event: string) =>
      data<EventLifecycleData>(
        await call(h.api, 'get', lifecyclePath(h.owner.orgId, event), { cookie: h.owner.cookie }),
      );
    const lifecycleCommand = async (event: string, type: 'COMPLETE' | 'ARCHIVE' | 'REOPEN') =>
      call(h.api, 'post', lifecycleCommandsPath(h.owner.orgId, event), {
        cookie: h.owner.cookie,
        body: {
          type,
          expectedEventVersion: (await lifecycle(event)).event.version,
          reason: '合成单淘汰生命周期独立复核',
        },
      });
    const summary = async (event: string) =>
      data<EventPlayerStatisticsData>(
        await call(h.api, 'get', playerSummaryPath(h.owner.orgId, event), {
          cookie: h.owner.cookie,
        }),
      );
    async function publicGone(publicEventId: string, publicMatchId?: string) {
      for (const path of [
        publicEventPath(publicEventId),
        publicSchedulePath(publicEventId),
        publicKnockoutPath(publicEventId),
        ...(publicMatchId ? [publicMatchPath(publicEventId, publicMatchId)] : []),
      ])
        rejected(await anonymous(h, path), 404, 'RESOURCE_NOT_FOUND');
    }

    test('three and five entrants produce real first-round games, dispersed byes and the original frozen identities', async () => {
      for (const count of [3, 5]) {
        const fixture = await knockoutFixture(h, count);
        const current = await readKnockout(h, fixture.event.event.id);
        const bracket = current.bracket!;
        expect(fixture.schedule.algorithmVersion).toBe('SE_SEEDED_V1');
        expect(bracket.algorithmVersion).toBe('SE_SEEDED_V1');
        expect(bracket.participantCount).toBe(count);
        expect(bracket.totalMatchCount).toBe(count - 1);
        expect(bracket.publishedMatchCount).toBe(1);
        expect(fixture.matches).toHaveLength(1);
        expect(bracket.rounds[0]!.slots.filter((slot) => slot.status === 'BYE')).toHaveLength(
          count === 3 ? 1 : 3,
        );
        expect(
          bracket.rounds[0]!.slots.every((slot) => slot.status !== 'BYE' || slot.matchId === null),
        ).toBe(true);
        expect(bracket.nextRound).toBeNull();
        expect(bracket.placements).toEqual([]);
        expect(bracket.isComplete).toBe(false);
        expect(current.capabilities.canPublishNextRound).toBe(false);
        const entries = new Map(
          fixture.schedule.source.entries.map((entry) => [entry.entryId, entry]),
        );
        for (const match of fixture.matches) {
          expect(match.home).toEqual(
            expect.objectContaining({
              entryId: entries.get(match.home.entryId)!.entryId,
              teamId: entries.get(match.home.entryId)!.teamId,
              teamName: entries.get(match.home.entryId)!.teamName,
              rosterRevisionId: entries.get(match.home.entryId)!.rosterRevisionId,
            }),
          );
          expect(match.away).toEqual(
            expect.objectContaining({
              entryId: entries.get(match.away.entryId)!.entryId,
              teamId: entries.get(match.away.entryId)!.teamId,
              teamName: entries.get(match.away.entryId)!.teamName,
              rosterRevisionId: entries.get(match.away.entryId)!.rosterRevisionId,
            }),
          );
        }
        const counts = (
          await h.api.pool.query(
            'SELECT (SELECT count(*)::int FROM schedule_fixtures WHERE org_id=$1 AND event_id=$2) AS fixtures,(SELECT count(*)::int FROM published_matches WHERE org_id=$1 AND event_id=$2) AS matches,(SELECT count(*)::int FROM scoring_states WHERE org_id=$1 AND event_id=$2) AS states,(SELECT count(*)::int FROM result_confirmations WHERE org_id=$1 AND event_id=$2) AS confirmations',
            [h.owner.orgId, current.event.id],
          )
        ).rows[0];
        expect(counts).toEqual({ fixtures: 1, matches: 1, states: 0, confirmations: 0 });
        expect((await summary(current.event.id)).summary).toMatchObject({
          totalMatchCount: count - 1,
          includedMatchCount: 0,
          coverageComplete: false,
        });
      }
    });

    test('unconfirmed or independent-review-pending results cannot create a downstream round or complete the event', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const original = await knockoutFacts(h, event);
      const current = await readKnockout(h, event);
      const invalid: PublishKnockoutRoundInput = {
        type: 'PUBLISH_ROUND',
        expectedEventVersion: current.event.version,
        expectedSourceHash: current.bracket!.sourceHash,
        roundNo: 2,
        reason: '未确认来源不能进入下一轮',
        allocations: [],
      };
      rejected(await publishRound(h, event, invalid), 409, 'KNOCKOUT_ROUND_NOT_READY');
      expect(await knockoutFacts(h, event)).toEqual(original);
      rejected(await lifecycleCommand(event, 'COMPLETE'), 422, 'EVENT_COMPLETION_BLOCKED');
      const match = fixture.matches[0]!;
      await assign(h, match.id, h.otherOwner);
      await prepare(h, match.id);
      const lease = await acquire(h, match.id);
      await start(h, match.id, h.otherOwner, lease);
      await act(
        h,
        match.id,
        h.otherOwner,
        {
          type: 'RECORD_STAT',
          payload: { kind: 'SCORE', side: 'HOME', value: 2 },
        },
        lease,
      );
      await finish(h, match.id, h.otherOwner, lease);
      expect((await workbench(h, match.id)).match.status).toBe('PENDING_CONFIRMATION');
      expect((await readKnockout(h, event)).bracket!.nextRound).toBeNull();
      const reviewer = await workbench(h, match.id, h.otherOwner);
      rejected(
        await sendCommand(
          h,
          match.id,
          h.otherOwner,
          envelope(reviewer.match.version, {
            type: 'CONFIRM_RESULT',
            payload: {},
          }),
        ),
        403,
      );
      expect((await readKnockout(h, event)).bracket!.confirmedMatchCount).toBe(0);
    });

    test('knockout rules reject draws and reuse repeated overtime before independent result confirmation', async () => {
      const fixture = await knockoutFixture(h, 2);
      const event = fixture.event.event.id;
      const current = await readKnockout(h, event);
      rejected(
        await call(h.api, 'put', scoringRulesPath(h.owner.orgId, event), {
          cookie: h.owner.cookie,
          body: { expectedEventVersion: current.event.version, ...defaultRules() },
        }),
        422,
        'RULE_CONFLICT',
      );
      const match = fixture.matches[0]!;
      await assign(h, match.id, h.otherOwner);
      await prepare(h, match.id);
      const lease = await acquire(h, match.id);
      await start(h, match.id, h.otherOwner, lease);
      await act(
        h,
        match.id,
        h.otherOwner,
        { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '合成常规节结束平分' } },
        lease,
      );
      const tied = await workbench(h, match.id, h.otherOwner);
      rejected(
        await sendCommand(
          h,
          match.id,
          h.otherOwner,
          envelope(tied.match.version, { type: 'END_MATCH', payload: {} }, lease),
        ),
        422,
      );
      for (let overtime = 0; overtime < 2; overtime++) {
        await act(h, match.id, h.otherOwner, { type: 'START_OVERTIME', payload: {} }, lease);
        await act(
          h,
          match.id,
          h.otherOwner,
          { type: 'CLOCK_SET', payload: { remainingMs: 0, reason: '合成加时节结束' } },
          lease,
        );
      }
      await act(
        h,
        match.id,
        h.otherOwner,
        { type: 'RECORD_STAT', payload: { kind: 'SCORE', side: 'HOME', value: 1 } },
        lease,
      );
      await finish(h, match.id, h.otherOwner, lease);
      await act(h, match.id, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const final = await readKnockout(h, event);
      expect(final.bracket).toMatchObject({
        isComplete: true,
        totalMatchCount: 1,
        confirmedMatchCount: 1,
      });
      expect(final.bracket!.placements.map((placement) => placement.rank).sort()).toEqual([1, 2]);
      expect((await workbench(h, match.id)).snapshot!.clock.period).toBe(3);
    });

    test('five entrants complete four real games, publish each round explicitly, then archive and reopen with fresh history grants', async () => {
      const fixture = await knockoutFixture(h, 5);
      const event = fixture.event.event.id;
      const initialGrant = await enable(h, event);
      expect(initialGrant.rules).toBeNull();
      expect(initialGrant.standings).toBeNull();
      const firstPublicId = initialGrant.publication!.publicEventId;
      const originalPublicMatches = data<PublicScheduleMatchData[]>(
        await anonymous(h, publicSchedulePath(firstPublicId)),
      );
      expect(originalPublicMatches).toHaveLength(1);
      const firstPublicMatch = originalPublicMatches[0]!.publicMatchId;
      const overlay = await issue(h, fixture.matches[0]!.id);
      const overlaySession = overlayCookie(
        await bootstrap(h, overlay.currentGrant!.overlayId, overlay.credential!.token),
      );
      const oldKeys = [firstPublicId];
      let current = await readKnockout(h, event);
      while (!current.bracket!.isComplete) {
        for (const match of await currentMatches(h, event))
          if (match.status === 'SCHEDULED') await confirmKnockoutMatch(h, match.id, true);
        current = await readKnockout(h, event);
        if (current.bracket!.isComplete) break;
        if (current.bracket!.publishedMatchCount === 1) {
          const confirmation = (await workbench(h, fixture.matches[0]!.id)).snapshot!
            .latestConfirmation!.id;
          const effectiveHash = current.bracket!.sourceHash;
          await assign(h, fixture.matches[0]!.id, h.otherOwner, 'SCORER', 'DISABLED');
          current = await readKnockout(h, event);
          expect(current.bracket!.sourceHash).toBe(effectiveHash);
          expect(
            (await workbench(h, fixture.matches[0]!.id)).snapshot!.latestConfirmation!.id,
          ).toBe(confirmation);
          // Match personnel maintenance advances the current version, not the effective confirmation version.
          const source = current.bracket!.nextRound!.sources[0]!;
          const maintained = await workbench(h, source.matchId);
          expect(source.matchVersion).toBe(
            maintained.snapshot!.latestConfirmation!.sourceMatchVersion + 1,
          );
          expect(source.matchVersion).toBeLessThan(maintained.match.version);
        }
        expect(current.capabilities.canPublishNextRound).toBe(true);
        expect(current.bracket!.nextRound).not.toBeNull();
        const before = current.bracket!.publishedMatchCount;
        const input = await roundInput(h, current, fixture.court);
        current = data<EventKnockoutData>(await publishRound(h, event, input));
        expect(current.event.version).toBe(input.expectedEventVersion + 1);
        expect(current.bracket!.publishedMatchCount).toBe(before + input.allocations.length);
        if (current.bracket!.publishedMatchCount === 3) {
          const effectiveHash = current.bracket!.sourceHash;
          await assign(h, fixture.matches[0]!.id, h.otherOwner, 'SCORER', 'ACTIVE');
          current = await readKnockout(h, event);
          expect(current.bracket!.sourceHash).toBe(effectiveHash);
          expect(current.bracket!.publishedMatchCount).toBe(3);
        }
        for (const old of oldKeys)
          await publicGone(old, old === firstPublicId ? firstPublicMatch : undefined);
        data(await overlaySnapshot(h, overlay.currentGrant!.overlayId, overlaySession));
        const fresh = await enable(h, event);
        expect(fresh.publication!.publicEventId).not.toBe(oldKeys.at(-1));
        oldKeys.push(fresh.publication!.publicEventId);
        current = await readKnockout(h, event);
      }
      expect(current.bracket).toMatchObject({
        totalMatchCount: 4,
        publishedMatchCount: 4,
        confirmedMatchCount: 4,
        isComplete: true,
        nextRound: null,
      });
      expect(current.bracket!.placements.map((placement) => placement.rank)).toEqual([
        1, 2, 3, 3, 5,
      ]);
      expect(new Set(current.bracket!.placements.map((placement) => placement.entryId)).size).toBe(
        5,
      );
      const basic = (await summary(event)).summary!;
      expect(basic).toMatchObject({
        totalMatchCount: 4,
        includedMatchCount: 4,
        pendingMatchCount: 0,
        teamOnlyConfirmedMatchCount: 0,
        coverageComplete: true,
        attributionComplete: true,
      });
      expect(basic.rows.some((row) => row.rosterSampleMatchCount > 1)).toBe(true);
      const completed = data<EventLifecycleData>(await lifecycleCommand(event, 'COMPLETE'));
      expect(completed.event.status).toBe('COMPLETED');
      expect(completed.completion.ready).toBe(true);
      await assign(h, fixture.matches[0]!.id, h.otherOwner, 'SCORER', 'DISABLED');
      expect((await lifecycle(event)).completion.ready).toBe(true);
      expect((await readKnockout(h, event)).bracket!.isComplete).toBe(true);
      for (const old of oldKeys) await publicGone(old);
      const history = data<EventStandingsData>(await viewingCommand(h, event, 'ENABLE_HISTORY'));
      const historyId = history.publication!.publicEventId;
      expect(history.publication!.purpose).toBe('HISTORY');
      const publicEvent = data<PublicEventData>(await anonymous(h, publicEventPath(historyId)));
      expect(publicEvent).toMatchObject({
        format: 'SINGLE_ELIMINATION',
        rules: null,
        totalMatchCount: 4,
        isComplete: true,
        status: 'COMPLETED',
      });
      const publicBracket = data<PublicKnockoutData>(
        await anonymous(h, publicKnockoutPath(historyId)),
      );
      expect(publicBracket.isComplete).toBe(true);
      expect(publicBracket.placements.map((placement) => placement.rank)).toEqual([1, 2, 3, 3, 5]);
      expect(Object.keys(publicBracket).sort()).toEqual(
        [
          'publicEventId',
          'algorithmVersion',
          'sourceHash',
          'asOf',
          'participantCount',
          'totalMatchCount',
          'publishedMatchCount',
          'confirmedMatchCount',
          'isComplete',
          'rounds',
          'placements',
        ].sort(),
      );
      const publicText = JSON.stringify(publicBracket);
      for (const secret of [
        event,
        h.owner.orgId,
        h.owner.email,
        h.owner.cookie,
        fixture.schedule.seed,
        ...fixture.schedule.source.entries.flatMap((entry) => [
          entry.entryId,
          entry.teamId,
          entry.rosterRevisionId,
          ...entry.players.map((player) => player.memberId),
        ]),
      ])
        expect(publicText).not.toContain(secret);
      rejected(
        await anonymous(h, publicStandingsPath(historyId)),
        422,
        'UNSUPPORTED_STANDINGS_FORMAT',
      );
      const finalMatch = (await currentMatches(h, event)).find((match) => match.roundNo === 3)!;
      const closed = await workbench(h, finalMatch.id);
      expect(closed.capabilities.canReopen).toBe(false);
      rejected(
        await sendCommand(
          h,
          finalMatch.id,
          h.owner,
          envelope(closed.match.version, {
            type: 'REOPEN_RESULT',
            payload: { reason: '闭赛后直接重开应被阻断' },
          }),
        ),
        409,
        'INVALID_EVENT_STATE',
      );
      expect(data<EventLifecycleData>(await lifecycleCommand(event, 'ARCHIVE')).event.status).toBe(
        'ARCHIVED',
      );
      expect(
        data<PublicKnockoutData>(await anonymous(h, publicKnockoutPath(historyId))).placements,
      ).toEqual(publicBracket.placements);
      expect(data<EventLifecycleData>(await lifecycleCommand(event, 'REOPEN')).event.status).toBe(
        'RUNNING',
      );
      await publicGone(historyId);
      await act(h, finalMatch.id, h.owner, {
        type: 'REOPEN_RESULT',
        payload: { reason: '重新开放后独立复核决赛' },
      });
      const reopened = await readKnockout(h, event);
      expect(reopened.bracket!.isComplete).toBe(false);
      expect(reopened.bracket!.placements).toEqual([]);
      rejected(await lifecycleCommand(event, 'COMPLETE'), 422, 'EVENT_COMPLETION_BLOCKED');
    }, 60000);

    test('source correction invalidates old advancement previews and downstream publication permanently consumes its source result', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const first = await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const preview = await readKnockout(h, event);
      const oldInput = await roundInput(h, preview, fixture.court);
      const before = await workbench(h, first.matchId);
      const reopening = envelope(before.match.version, {
        type: 'REOPEN_RESULT',
        payload: { reason: '发布下一轮前更正来源' },
      });
      data<ScoringCommandResponse>(await sendCommand(h, first.matchId, h.owner, reopening));
      expect((await readKnockout(h, event)).bracket!.nextRound).toBeNull();
      await act(
        h,
        first.matchId,
        h.otherOwner,
        {
          type: 'ADD_CORRECTION',
          payload: { kind: 'SCORE', side: 'HOME', value: 1, period: 1, reason: '合成来源补记一分' },
        },
        first.lease,
      );
      await act(h, first.matchId, h.owner, { type: 'CONFIRM_RESULT', payload: {} });
      const fresh = await readKnockout(h, event);
      expect(fresh.bracket!.nextRound!.sourceHash).not.toBe(oldInput.expectedSourceHash);
      rejected(
        await publishRound(h, event, { ...oldInput, expectedEventVersion: fresh.event.version }),
        409,
        'KNOCKOUT_SOURCE_CONFLICT',
      );
      data<EventKnockoutData>(
        await publishRound(h, event, await roundInput(h, fresh, fixture.court)),
      );
      expect((await workbench(h, first.matchId)).capabilities.canReopen).toBe(false);
      const facts = await knockoutFacts(h, event);
      // A once-successful idempotency key must not bypass the now consumed source boundary.
      rejected(
        await sendCommand(h, first.matchId, h.owner, reopening),
        409,
        'KNOCKOUT_RESULT_CONSUMED',
      );
      const consumed = await workbench(h, first.matchId);
      rejected(
        await sendCommand(
          h,
          first.matchId,
          h.owner,
          envelope(consumed.match.version, {
            type: 'REOPEN_RESULT',
            payload: { reason: '下游正式发布后不能改写来源' },
          }),
        ),
        409,
        'KNOCKOUT_RESULT_CONSUMED',
      );
      expect(await knockoutFacts(h, event)).toEqual(facts);
    });

    test('version/source checks and concurrent duplicate publication admit exactly one whole downstream round', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      rejected(
        await publishRound(h, event, {
          ...input,
          expectedEventVersion: input.expectedEventVersion - 1,
        }),
        409,
        'VERSION_CONFLICT',
      );
      rejected(
        await publishRound(h, event, { ...input, expectedSourceHash: '0'.repeat(64) }),
        409,
        'KNOCKOUT_SOURCE_CONFLICT',
      );
      const responses = await Promise.all([
        publishRound(h, event, input),
        publishRound(h, event, input),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      expect(await currentMatches(h, event)).toHaveLength(2);
      const rows = (
        await h.api.pool.query(
          'SELECT * FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2',
          [h.owner.orgId, event],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source_hash).toBe(input.expectedSourceHash);
      expect(rows[0]!.sources).toEqual(current.bracket!.nextRound!.sources);
      expect(rows[0]!.fixtures).toHaveLength(1);
      expect(rows[0]!.to_event_version).toBe(rows[0]!.from_event_version + 1);
    });

    test('source end times, minimum rest and allocation validation reject atomically without reservations or grant loss', async () => {
      const fixture = await knockoutFixture(h, 3, { minRestMinutes: 30 });
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      await enable(h, event);
      const current = await readKnockout(h, event);
      const before = await knockoutFacts(h, event);
      const input = await roundInput(h, current, fixture.court);
      const prior = (await currentMatches(h, event))[0]!;
      rejected(
        await publishRound(h, event, {
          ...input,
          allocations: input.allocations.map((allocation) => ({
            ...allocation,
            startsAt: plusMinutes(prior.startsAt, -60),
          })),
        }),
        409,
        'KNOCKOUT_DEPENDENCY_ORDER',
      );
      const tooSoon = await publishRound(h, event, {
        ...input,
        allocations: input.allocations.map((allocation) => ({
          ...allocation,
          startsAt: prior.endsAt,
        })),
      });
      rejected(tooSoon, 409, 'SCHEDULE_CONFLICT');
      expect(tooSoon.body.error.details.conflicts).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'MIN_REST' })]),
      );
      rejected(
        await publishRound(h, event, { ...input, allocations: [] }),
        422,
        'VALIDATION_ERROR',
      );
      rejected(
        await publishRound(h, event, {
          ...input,
          allocations: [...input.allocations, ...input.allocations],
        }),
        422,
        'VALIDATION_ERROR',
      );
      rejected(
        await call(h.api, 'post', roundCommandsPath(h.owner.orgId, event), {
          cookie: h.owner.cookie,
          body: { ...input, confirmationIds: [] },
        }),
        422,
        'VALIDATION_ERROR',
      );
      expect(await knockoutFacts(h, event)).toEqual(before);
    });

    test('later controlled rescheduling cannot move a child match before its consumed source result', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const source = fixture.matches[0]!;
      await confirmKnockoutMatch(h, source.id);
      const current = await readKnockout(h, event);
      data<EventKnockoutData>(
        await publishRound(h, event, await roundInput(h, current, fixture.court)),
      );
      const child = (await currentMatches(h, event)).find((match) => match.roundNo === 2)!;
      const before = await knockoutFacts(h, event);
      const editable = await rescheduling(h, child.id);
      rejected(
        await reschedule(h, editable, { startsAt: plusMinutes(source.startsAt, -120) }),
        409,
        'KNOCKOUT_DEPENDENCY_ORDER',
      );
      const consumed = await rescheduling(h, source.id);
      expect(consumed.capabilities.canReschedule).toBe(false);
      rejected(await reschedule(h, consumed, { startsAt: plusMinutes(child.startsAt, 120) }), 409);
      expect(await knockoutFacts(h, event)).toEqual(before);
    });

    test('a damaged current confirmation fails closed rather than selecting a winner from an unverified score', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const source = fixture.matches[0]!;
      await confirmKnockoutMatch(h, source.id);
      const before = await readKnockout(h, event);
      const original = (
        await h.api.pool.query(
          'SELECT home_score FROM scoring_states WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.id],
        )
      ).rows[0]!.home_score;
      try {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=home_score+1 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.id],
        );
        const failed = await call(h.api, 'get', knockoutPath(h.owner.orgId, event), {
          cookie: h.owner.cookie,
        });
        rejected(failed, 409, 'RESULT_SOURCE_INVALID');
        const body = JSON.stringify(failed.body);
        for (const value of [event, source.id, h.owner.orgId]) expect(body).not.toContain(value);
      } finally {
        await h.api.pool.query(
          'UPDATE scoring_states SET home_score=$3 WHERE org_id=$1 AND match_id=$2',
          [h.owner.orgId, source.id, original],
        );
      }
      expect((await readKnockout(h, event)).bracket!.sourceHash).toBe(before.bracket!.sourceHash);
    });

    test('cross-organization, anonymous, participant and match-only assignments do not acquire event advancement privileges', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      const before = await knockoutFacts(h, event);
      rejected(await call(h.api, 'get', knockoutPath(h.owner.orgId, event)), 401);
      rejected(
        await call(h.api, 'post', roundCommandsPath(h.owner.orgId, event), { body: input }),
        401,
      );
      rejected(
        await call(h.api, 'get', knockoutPath(h.otherOwner.orgId, event), {
          cookie: h.otherOwner.cookie,
        }),
        404,
      );
      rejected(
        await call(h.api, 'post', roundCommandsPath(h.otherOwner.orgId, event), {
          cookie: h.otherOwner.cookie,
          body: input,
        }),
        404,
      );
      rejected(
        await call(h.api, 'get', knockoutPath(h.owner.orgId, event), { cookie: h.leader.cookie }),
        404,
      );
      rejected(await publishRound(h, event, input, h.otherOwner), 404);
      data(
        await call(h.api, 'put', staffPath(h.owner.orgId, event, h.otherOwner.id), {
          cookie: h.owner.cookie,
          body: { role: 'SCORER', status: 'ACTIVE' },
        }),
      );
      const staffView = await readKnockout(h, event, h.otherOwner);
      expect(staffView.capabilities.canPublishNextRound).toBe(false);
      rejected(
        await publishRound(
          h,
          event,
          { ...input, expectedEventVersion: staffView.event.version },
          h.otherOwner,
        ),
        403,
      );
      // The only change is the explicitly granted staff record and its audit/event version.
      expect(await currentMatches(h, event)).toHaveLength(1);
      expect((await knockoutFacts(h, event)).rounds).toEqual(before.rounds);
    });

    test('an audit failure rolls back the proof, all fixtures/reservations, event version and old public grant revocation', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const grant = await enable(h, event);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      const before = await knockoutFacts(h, event);
      const name = `c04_reject_audit_${randomUUID().replaceAll('-', '')}`;
      await h.api.pool.query(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.org_id='${h.owner.orgId}'::uuid AND NEW.resource_id='${event}'::uuid THEN RAISE EXCEPTION 'Synthetic C04 audit rollback'; END IF; RETURN NEW; END; $$`,
      );
      try {
        await h.api.pool.query(
          `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
        rejected(await publishRound(h, event, input), 500, 'INTERNAL_ERROR');
      } finally {
        await h.api.pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
        await h.api.pool.query(`DROP FUNCTION ${name}()`);
      }
      expect(await knockoutFacts(h, event)).toEqual(before);
      data<PublicKnockoutData>(
        await anonymous(h, publicKnockoutPath(grant.publication!.publicEventId)),
      );
    });

    test('a proof without its exact same-transaction match and reservations cannot commit, even under the test schema owner', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      const before = await knockoutFacts(h, event);
      const client = await h.api.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [
          h.owner.orgId,
        ]);
        await client.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
          h.owner.orgId,
          event,
        ]);
        await client.query(
          'INSERT INTO knockout_round_publications(id,org_id,event_id,publication_id,revision_id,round_no,from_event_version,to_event_version,source_hash,sources,fixtures,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)',
          [
            randomUUID(),
            h.owner.orgId,
            event,
            current.publicationId,
            fixture.schedule.id,
            input.roundNo,
            current.event.version,
            current.event.version + 1,
            input.expectedSourceHash,
            JSON.stringify(current.bracket!.nextRound!.sources),
            JSON.stringify(proofFixtures(fixture, current, input)),
            input.reason,
            h.owner.id,
          ],
        );
        await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(await knockoutFacts(h, event)).toEqual(before);
    });

    test('published round proof cannot be updated/deleted and a least-privilege test role lacks those grants', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      await confirmKnockoutMatch(h, fixture.matches[0]!.id);
      const current = await readKnockout(h, event);
      data<EventKnockoutData>(
        await publishRound(h, event, await roundInput(h, current, fixture.court)),
      );
      const before = await knockoutFacts(h, event);
      for (const query of [
        'UPDATE knockout_round_publications SET reason=reason WHERE org_id=$1 AND event_id=$2',
        'DELETE FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2',
      ])
        await expect(h.api.pool.query(query, [h.owner.orgId, event])).rejects.toMatchObject({
          code: '23514',
        });
      const role = `c04_proof_${randomUUID().replaceAll('-', '')}`;
      await h.api.pool.query(`CREATE ROLE ${role} NOLOGIN`);
      try {
        await h.api.pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await h.api.pool.query(`GRANT SELECT,INSERT ON knockout_round_publications TO ${role}`);
        const client = await h.api.pool.connect();
        try {
          for (const query of [
            'UPDATE knockout_round_publications SET reason=reason WHERE false',
            'DELETE FROM knockout_round_publications WHERE false',
          ]) {
            await client.query('BEGIN');
            await client.query(`SET LOCAL ROLE ${role}`);
            await expect(client.query(query)).rejects.toMatchObject({ code: '42501' });
            await client.query('ROLLBACK');
          }
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      } finally {
        await h.api.pool.query(`DROP OWNED BY ${role}`);
        await h.api.pool.query(`DROP ROLE ${role}`);
      }
      expect(await knockoutFacts(h, event)).toEqual(before);
    });

    test('round publication holds the event boundary before any later source reopen can pass', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const first = fixture.matches[0]!;
      await confirmKnockoutMatch(h, first.id);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      await withRowsLocked(
        h,
        'SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, event],
        1,
        async (pid, unlock, track) => {
          const publishing = track(publishRound(h, event, input));
          await blockedPid(h.api.pool, pid, 'Round publication did not wait on the held event');
          await unlock();
          data<EventKnockoutData>(await publishing);
        },
      );
      const consumed = await workbench(h, first.id);
      rejected(
        await sendCommand(
          h,
          first.id,
          h.owner,
          envelope(consumed.match.version, {
            type: 'REOPEN_RESULT',
            payload: { reason: '序列化后应拒绝已消费来源' },
          }),
        ),
        409,
        'KNOCKOUT_RESULT_CONSUMED',
      );
      expect((await readKnockout(h, event)).bracket!.publishedMatchCount).toBe(2);
    });
    test('a reopening already holding event SHARE completes before a waiting round publish and invalidates that publish', async () => {
      const fixture = await knockoutFixture(h);
      const event = fixture.event.event.id;
      const source = fixture.matches[0]!;
      await confirmKnockoutMatch(h, source.id);
      const current = await readKnockout(h, event);
      const input = await roundInput(h, current, fixture.court);
      const sourceView = await workbench(h, source.id);
      await withRowsLocked(
        h,
        'SELECT id FROM published_matches WHERE org_id=$1 AND id=$2 FOR UPDATE',
        [h.owner.orgId, source.id],
        1,
        async (pid, unlock, track) => {
          const reopening = track(
            sendCommand(
              h,
              source.id,
              h.owner,
              envelope(sourceView.match.version, {
                type: 'REOPEN_RESULT',
                payload: { reason: '并发重开先取得赛事共享锁' },
              }),
            ),
          );
          const reopenPid = await blockedPid(
            h.api.pool,
            pid,
            'Source reopen did not hold event SHARE while waiting for the match',
          );
          const publishing = track(publishRound(h, event, input));
          await blockedPid(
            h.api.pool,
            reopenPid,
            'Round publish did not wait for the source reopen event lock',
          );
          await unlock();
          data<ScoringCommandResponse>(await reopening);
          rejected(await publishing, 409, 'KNOCKOUT_ROUND_NOT_READY');
        },
      );
      const after = await readKnockout(h, event);
      expect(after.bracket!.publishedMatchCount).toBe(1);
      expect(after.bracket!.confirmedMatchCount).toBe(0);
      expect(after.bracket!.nextRound).toBeNull();
      expect((await knockoutFacts(h, event)).rounds).toHaveLength(0);
    });
  },
);
