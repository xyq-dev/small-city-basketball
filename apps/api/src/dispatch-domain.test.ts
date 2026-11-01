import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  parseDispatchCommand,
  parseDispatchPreference,
  parseDispatchQuote,
  parseDispatchRequest,
  dispatchMoney,
} from './dispatch-domain.js';
import { REGION_CATALOG_VERSION } from './region-catalog-data.js';
const id = randomUUID();
const money = {
  serviceMinor: 20000,
  travelMinor: 5000,
  lodgingMinor: 8000,
  platformMinor: 0,
  totalMinor: 33000,
};
const request = {
  startsAt: '2030-04-03T10:00:00.000Z',
  endsAt: '2030-04-03T12:00:00.000Z',
  budget: money,
};
const quote = () => ({
  slotId: id,
  ...money,
  departureAt: '2030-04-03T05:00:00.000Z',
  arrivalAt: '2030-04-03T09:00:00.000Z',
  returnAt: '2030-04-03T17:00:00.000Z',
  travelMethod: '高铁转市内公交',
  travelEvidence: '已核验班次时间与市内接驳方案，完整凭据保存在授权审核渠道',
  terms: '服务时间及全额差旅上限已列明，客户确认后方可转预约',
});
const body = () => ({
  commandId: randomUUID(),
  orgId: id,
  kind: 'REFEREE',
  serviceRegion: { catalogVersion: REGION_CATALOG_VERSION, regionId: id },
  serviceAddress: '实际赛事场馆西门报到',
  servicePoint: null,
  ...request,
  expiresAt: '2030-04-02T12:00:00.000Z',
  inviteRegionIds: [id],
  allowCrossCity: true,
  people: 1,
});
describe('R6 dispatch consent, quote and travel boundaries', () => {
  test('accepts explicit one-person scope and normalizes stable quote hash', () => {
    expect(parseDispatchRequest(body()).people).toBe(1);
    const a = parseDispatchQuote(quote(), request);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      parseDispatchQuote({ ...quote(), travelMethod: '  高铁转市内公交  ' }, request).hash,
    ).toBe(a.hash);
    expect(a.protectedEndsAt).toBe(quote().returnAt);
  });
  test.each([
    null,
    {},
    { ...money, serviceMinor: -1 },
    { ...money, serviceMinor: 0.1 },
    { ...money, serviceMinor: Number.MAX_SAFE_INTEGER },
    { ...money, totalMinor: '33000' },
    { ...money, hidden: 1 },
  ])('never defaults malformed money to free: %j', (v) => {
    expect(() => dispatchMoney(v)).toThrow();
  });
  test('requires both total and per-component ceilings', () => {
    expect(() => parseDispatchQuote({ ...quote(), totalMinor: 33001 }, request)).toThrow();
    expect(() =>
      parseDispatchQuote({ ...quote(), serviceMinor: 25000, travelMinor: 0 }, request),
    ).toThrow();
  });
  test.each([
    { allowCrossCity: false },
    { people: 2 },
    { kind: 'MEDIC' },
    { kind: 'COURT' },
    { expiresAt: request.startsAt },
    { inviteRegionIds: [id, id] },
  ])('rejects unsupported request scope %j', (change) => {
    expect(() => parseDispatchRequest({ ...body(), ...change })).toThrow();
  });
  test('unknown/late route cannot be interpreted as zero travel', () => {
    expect(() =>
      parseDispatchQuote({ ...quote(), arrivalAt: '2030-04-03T11:00:00Z' }, request),
    ).toThrow();
    expect(() => parseDispatchQuote({ ...quote(), travelEvidence: '' }, request)).toThrow();
    expect(() =>
      parseDispatchQuote({ ...quote(), returnAt: '2030-04-03T11:00:00Z' }, request),
    ).toThrow();
    expect(() =>
      parseDispatchQuote({ ...quote(), departureAt: '2030-03-01T05:00:00Z' }, request),
    ).toThrow();
  });
  test('enforces 30-minute end protection even when return is immediate', () => {
    expect(
      parseDispatchQuote({ ...quote(), returnAt: request.endsAt }, request).protectedEndsAt,
    ).toBe('2030-04-03T12:30:00.000Z');
  });
  test('server-only merchant/terms and protection fields cannot be injected', () => {
    for (const key of ['merchantKey', 'baseTermsId', 'protectedStartsAt', 'hash'])
      expect(() => parseDispatchQuote({ ...quote(), [key]: id }, request)).toThrow();
  });
  test('review must be explicit and tied to exact immutable quote', () => {
    const b = {
      commandId: randomUUID(),
      expectedVersion: 2,
      type: 'VERIFY_TRAVEL',
      reason: '已实际核验交通凭据',
      quoteHash: 'a'.repeat(64),
      evidenceChecked: true,
    };
    expect(parseDispatchCommand(b, 'OFFER').quoteHash).toBe('a'.repeat(64));
    expect(() => parseDispatchCommand({ ...b, evidenceChecked: false }, 'OFFER')).toThrow();
    expect(() => parseDispatchCommand({ ...b, quoteHash: id }, 'OFFER')).toThrow();
    expect(() => parseDispatchCommand({ ...b, type: 'ACCEPT' }, 'OFFER')).toThrow();
  });
  test('paid consent belongs exclusively to customer confirmation', () => {
    const b = {
      commandId: randomUUID(),
      expectedVersion: 2,
      type: 'CONFIRM_QUOTE',
      reason: '本人核对费用和条款',
      quoteHash: 'a'.repeat(64),
      acceptedTermsId: 'a'.repeat(64),
      chargeConsent: true,
    };
    expect(parseDispatchCommand(b, 'REQUEST').chargeConsent).toBe(true);
    expect(() => parseDispatchCommand({ ...b, type: 'ACCEPT' }, 'OFFER')).toThrow();
    expect(() => parseDispatchCommand({ ...b, chargeConsent: false }, 'REQUEST')).toThrow();
  });
  test('provider opts into bounded daily invitations; cannot submit staff decisions through request commands', () => {
    expect(
      parseDispatchPreference({
        commandId: randomUUID(),
        expectedVersion: 0,
        enabled: true,
        regionIds: [id],
        dailyLimit: 3,
      }).dailyLimit,
    ).toBe(3);
    expect(() =>
      parseDispatchPreference({
        commandId: randomUUID(),
        expectedVersion: 0,
        enabled: true,
        regionIds: [id],
        dailyLimit: 10,
      }),
    ).toThrow();
    expect(() =>
      parseDispatchCommand(
        {
          commandId: randomUUID(),
          expectedVersion: 1,
          type: 'ACCEPT',
          reason: '测试角色越权',
          quoteHash: 'a'.repeat(64),
        },
        'REQUEST',
      ),
    ).toThrow();
  });
});
