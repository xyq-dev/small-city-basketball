import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { call, data, error } from './support.js';
import { closeHarness, createScoringHarness, act, workbench, assign } from './p05-support.js';
import type { Harness } from './p05-support.js';
import {
  confirmKnockoutMatch,
  currentMatches,
  knockoutFacts,
  knockoutFixture,
  publishRound,
  readKnockout,
  roundInput,
} from './c04-support.js';
import { reschedule, rescheduling } from './p04-rescheduling-support.js';
import { plusMinutes } from './p04-support.js';

describe(
  'X03 bronze rescheduling follows the actual semifinal source teams',
  { concurrent: false },
  () => {
    let h: Harness;
    beforeAll(async () => {
      h = await createScoringHarness(4);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);

    test('rejects bronze before semifinals without changing proof or scoring head, and permits a later legal move', async () => {
      const fixture = await knockoutFixture(h, 4, { thirdPlaceMatch: true, minRestMinutes: 0 });
      const id = fixture.event.event.id;
      for (const match of fixture.matches) await confirmKnockoutMatch(h, match.id);
      const current = await readKnockout(h, id);
      data(await publishRound(h, id, await roundInput(h, current, fixture.court)));
      const bronze = (await currentMatches(h, id)).find((m) => m.fixtureKey === 'R2-P2')!;
      await assign(h, bronze.id, h.otherOwner);
      const beforePrepare = await workbench(h, bronze.id);
      await act(h, bronze.id, h.owner, {
        type: 'PREPARE_MATCH',
        payload: {
          expectedEventVersion: beforePrepare.event.version,
          collectionMode: 'TEAM_ONLY',
        },
      });
      const access = await rescheduling(h, bronze.id);
      expect(access.capabilities.canReschedule).toBe(true);
      const facts = await knockoutFacts(h, id);
      const roundProof = async () =>
        (
          await h.api.pool.query(
            'SELECT sources,fixtures FROM knockout_round_publications WHERE org_id=$1 AND event_id=$2 AND round_no=2',
            [h.owner.orgId, id],
          )
        ).rows[0];
      const originalProof = await roundProof();
      const state = async () =>
        (
          await h.api.pool.query(
            `SELECT to_jsonb(s) AS state FROM scoring_states s WHERE org_id=$1 AND match_id=$2`,
            [h.owner.orgId, bronze.id],
          )
        ).rows;
      const history = async () =>
        (
          await h.api.pool.query(
            `SELECT to_jsonb(r) AS receipt FROM match_reschedules r WHERE org_id=$1 AND match_id=$2 ORDER BY to_match_version`,
            [h.owner.orgId, bronze.id],
          )
        ).rows;
      const head = await state(),
        receipts = await history();
      const blocked = await reschedule(h, access, {
        startsAt: `${fixture.event.event.startDate}T08:00:00+08:00`,
      });
      error(blocked, 409);
      expect(blocked.body.error.code).toBe('KNOCKOUT_DEPENDENCY_ORDER');
      expect(await knockoutFacts(h, id)).toEqual(facts);
      expect(await state()).toEqual(head);
      expect(await history()).toEqual(receipts);
      expect((await readKnockout(h, id)).bracket!.nextRound).toBeNull();

      const moved = data<Awaited<ReturnType<typeof rescheduling>>>(
        await reschedule(h, access, {
          startsAt: plusMinutes(bronze.endsAt, 120),
        }),
      );
      expect(moved.match.version).toBe(access.match.version + 1);
      expect(moved.history).toHaveLength(receipts.length + 1);
      expect((await state())[0]!.state.source_version).toBe(moved.match.version);
      const after = await readKnockout(h, id);
      expect(after.bracket!.rounds).toHaveLength(2);
      const proof = await roundProof();
      expect(proof).toEqual(originalProof);
      expect(proof.sources).toHaveLength(2);
      expect(proof.fixtures).toHaveLength(2);
      // Read the normal HTTP bracket after moving the bronze match; no invalid-source fallback.
      data(
        await call(h.api, 'get', `/v1/orgs/${h.owner.orgId}/events/${id}/knockout`, {
          cookie: h.owner.cookie,
        }),
      );
    });
  },
);
