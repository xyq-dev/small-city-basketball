import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EventScoringData } from '@small-city-basketball/contracts';
import { call, createEvent, data } from './support.js';
import {
  closeHarness,
  createScoringHarness,
  defaultRules,
  eventScoringPath,
  scoringRulesPath,
} from './p05-support.js';
import type { Harness } from './p05-support.js';
describe('X08/X03 scoring rules before registration and scheduling', { concurrent: false }, () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createScoringHarness(4);
  });
  afterAll(async () => {
    if (h) await closeHarness(h);
  });
  test('draft organizers configure rules before registration without acquiring any scoring control', async () => {
    const event = await createEvent(h.api, h.owner, '合成办赛前置记分规则');
    const before = data<EventScoringData>(
      await call(h.api, 'get', eventScoringPath(h.owner.orgId, event.id), {
        cookie: h.owner.cookie,
      }),
    );
    expect(before.capabilities.canManageRules).toBe(true);
    const saved = data<EventScoringData>(
      await call(h.api, 'put', scoringRulesPath(h.owner.orgId, event.id), {
        cookie: h.owner.cookie,
        body: {
          expectedEventVersion: event.version,
          ...defaultRules({ periodDurationSeconds: 600 }),
        },
      }),
    );
    expect(saved.event.status).toBe('DRAFT');
    expect(saved.rules!.periodDurationSeconds).toBe(600);
    expect(saved.locked).toBe(false);
    const stale = await call(h.api, 'put', scoringRulesPath(h.owner.orgId, event.id), {
      cookie: h.owner.cookie,
      body: { expectedEventVersion: event.version, ...defaultRules() },
    });
    expect(stale.status).toBe(409);
    const denied = await call(h.api, 'put', scoringRulesPath(h.owner.orgId, event.id), {
      cookie: h.leader.cookie,
      body: { expectedEventVersion: saved.event.version, ...defaultRules() },
    });
    expect([403, 404]).toContain(denied.status);
  });
});
