import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { call, data } from './support.js';
import {
  acquire,
  act,
  assign,
  closeHarness,
  control,
  createScoringHarness,
  published,
  start,
  workbench,
} from './p05-support.js';
import type { Harness } from './p05-support.js';

describe('X08 permanent offline intent receipts on PostgreSQL', { concurrent: false }, () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(4);
  });
  afterAll(async () => {
    if (h) await closeHarness(h);
  });
  async function fixture() {
    const f = await published(h, undefined, { periodDurationSeconds: 60 });
    const id = f.matches[0]!.id;
    await assign(h, id, h.otherOwner);
    const ready = await workbench(h, id);
    await act(h, id, h.owner, {
      type: 'PREPARE_MATCH',
      payload: { expectedEventVersion: ready.event.version },
    });
    const lease = await acquire(h, id, h.otherOwner);
    await start(h, id, h.otherOwner, lease);
    const wb = await workbench(h, id, h.otherOwner);
    const queueId = randomUUID(),
      firstId = randomUUID(),
      secondId = randomUUID();
    const intent = (intentId: string, ordinal: number, previousIntentId: string | null) => ({
      intentId,
      queueId,
      ordinal,
      previousIntentId,
      command: {
        commandId: intentId,
        expectedVersion: wb.match.version + ordinal - 1,
        capturedAt: '2026-10-31T00:00:00Z',
        type: 'RECORD_STAT',
        payload: { side: 'HOME', kind: 'SCORE', value: 2 },
      },
    });
    return {
      id,
      lease,
      first: intent(firstId, 1, null),
      second: intent(secondId, 2, firstId),
      base: `/v1/orgs/${h.owner.orgId}/matches/${id}/offline-intents`,
    };
  }
  test('concurrent identical intent accepts one operation; expired/reacquired lease replays the original UUID receipt', async () => {
    const f = await fixture(),
      body = { intent: f.first, control: control(f.lease), confirmImport: true };
    const results = await Promise.all([
      call(h.api, 'post', f.base, { cookie: h.otherOwner.cookie, body }),
      call(h.api, 'post', f.base, { cookie: h.otherOwner.cookie, body }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(data<any>(results[0]!).receipt).toEqual(data<any>(results[1]!).receipt);
    await h.api.pool.query(
      "UPDATE scoring_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND match_id=$2",
      [h.owner.orgId, f.id],
    );
    const renewed = await acquire(h, f.id, h.otherOwner);
    const replay = await call(h.api, 'post', f.base, {
      cookie: h.otherOwner.cookie,
      body: { ...body, control: control(renewed) },
    });
    expect(replay.status).toBe(200);
    expect(data<any>(replay).receipt).toEqual(data<any>(results[0]!).receipt);
    expect(data<any>(replay).snapshot.totals.home.score).toBe(2);
    expect(
      (await h.api.pool.query('SELECT * FROM scoring_offline_intents WHERE match_id=$1', [f.id]))
        .rowCount,
    ).toBe(1);
  });
  test('out-of-order and changed-content submissions fail; successful first item can be resumed precisely', async () => {
    const f = await fixture(),
      submit = (intent: unknown) =>
        call(h.api, 'post', f.base, {
          cookie: h.otherOwner.cookie,
          body: { intent, control: control(f.lease), confirmImport: true },
        });
    expect((await submit(f.second)).status).toBe(409);
    expect((await submit(f.first)).status).toBe(200);
    expect(
      (
        await submit({
          ...f.first,
          command: { ...f.first.command, payload: { ...f.first.command.payload, value: 3 } },
        })
      ).status,
    ).toBe(409);
    expect((await submit(f.second)).status).toBe(200);
    expect((await workbench(h, f.id, h.otherOwner)).snapshot!.totals.home.score).toBe(4);
  });
  test('intervening online operation conflicts without rebasing; stale lease and wrong actor never accept', async () => {
    const f = await fixture();
    await act(
      h,
      f.id,
      h.otherOwner,
      { type: 'RECORD_STAT', payload: { side: 'AWAY', kind: 'SCORE', value: 1 } },
      f.lease,
    );
    const response = await call(h.api, 'post', f.base, {
      cookie: h.otherOwner.cookie,
      body: { intent: f.first, control: control(f.lease), confirmImport: true },
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VERSION_CONFLICT');
    const denied = await call(h.api, 'post', f.base, {
      cookie: h.owner.cookie,
      body: { intent: f.first, control: control(f.lease), confirmImport: true },
    });
    expect(denied.status).toBe(403);
    expect(
      (await h.api.pool.query('SELECT * FROM scoring_offline_intents WHERE match_id=$1', [f.id]))
        .rowCount,
    ).toBe(0);
  });
  test('raw online command UUID cannot be recycled into an offline intent and import must be explicit', async () => {
    const f = await fixture();
    const noConfirm = await call(h.api, 'post', f.base, {
      cookie: h.otherOwner.cookie,
      body: { intent: f.first, control: control(f.lease) },
    });
    expect(noConfirm.status).toBe(422);
    const online = await call(h.api, 'post', `/v1/orgs/${h.owner.orgId}/matches/${f.id}/commands`, {
      cookie: h.otherOwner.cookie,
      body: { ...f.first.command, control: control(f.lease) },
    });
    expect(online.status).toBe(200);
    const imported = await call(h.api, 'post', f.base, {
      cookie: h.otherOwner.cookie,
      body: { intent: f.first, control: control(f.lease), confirmImport: true },
    });
    expect(imported.status).toBe(409);
    expect(imported.body.error.code).toBe('OFFLINE_ID_CONFLICT');
  });
});
