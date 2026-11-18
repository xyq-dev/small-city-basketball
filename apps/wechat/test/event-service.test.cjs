const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api');
const schedule = require('../utils/trial-schedule');
const drafts = require('../utils/trial-draft');
const { loadPage, createWx } = require('./helpers/native-page.cjs');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const STD = '44444444-4444-4444-8444-444444444444';
const PRO = '55555555-5555-4555-8555-555555555555';
const ODD = '66666666-6666-4666-8666-666666666666';
const EVENT = '77777777-7777-4777-8777-777777777777';

function envelope(data) {
  return { statusCode: 200, data: { data, meta: { requestId: 'member03-test' } } };
}

test('trial schedule keeps the circle pairings and reports hard slot conflicts', () => {
  const ready = schedule.planTrial({
    teams: schedule.SAMPLE,
    dates: [
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
    ],
    courts: ['1号场'],
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.placed.length, 28);
  assert.equal(new Set(ready.placed.map((game) => game.home + '|' + game.away)).size, 28);
  const shared = require('../utils/circle-pairing').circlePairings(['甲', '乙', '丙']);
  assert.deepEqual(
    shared.fixtures.map((fixture) => [fixture.fixtureKey, fixture.homeEntryId, fixture.awayEntryId]),
    [
      ['R1-P2', '乙', '丙'],
      ['R2-P1', '甲', '丙'],
      ['R3-P1', '甲', '乙'],
    ],
  );
  const scheduler = fs.readFileSync(
    path.resolve(__dirname, '../../api/src/scheduling-domain.ts'),
    'utf8',
  );
  assert.match(scheduler, /circle-pairing\.js/);
  assert.doesNotMatch(scheduler, /rotation\.slice\(1, -1\)/);
  const blocked = schedule.planTrial({
    teams: schedule.SAMPLE,
    dates: ['2026-11-21'],
    courts: ['1号场'],
  });
  assert.equal(blocked.ok, false);
  assert.match(blocked.hard, /场地时段不够/);
  assert.deepEqual(blocked.teams, schedule.SAMPLE);
  const duplicate = schedule.planTrial({
    teams: ['甲', '甲'],
    dates: ['2026-11-21'],
    courts: ['1号场'],
  });
  assert.match(duplicate.hard, /不能重复/);
});

test('device drafts stay on the current user and a damaged record is not overwritten', () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) || '',
    setItem: (key, value) => memory.set(key, value),
  };
  assert.equal(drafts.saveDraft(storage, '', '', { teamText: '甲' }).code, 'LOGIN');
  assert.equal(drafts.saveDraft(storage, USER, ORG, { teamText: '甲' }).ok, true);
  assert.equal(drafts.loadDraft(storage, OTHER, ORG).draft, null);
  assert.equal(drafts.loadDraft(storage, USER, ORG).draft.teamText, '甲');
  memory.set(drafts.scopeKey(USER, ORG), '{');
  const damaged = drafts.loadDraft(storage, USER, ORG);
  assert.equal(damaged.code, 'DAMAGED');
  assert.equal(memory.get(drafts.scopeKey(USER, ORG)), '{');
});

test('event service allows only the exact commerce and membership reads and writes', () => {
  const org = '/v1/orgs/' + ORG;
  assert.equal(api.pathAllowed(org + '/commerce', 'GET'), true);
  assert.equal(api.pathAllowed(org + '/software-membership', 'GET'), true);
  assert.equal(api.pathAllowed(org + '/commerce/orders', 'POST'), true);
  assert.equal(api.pathAllowed(org + '/commerce/orders/' + EVENT + '/commands', 'POST'), true);
  assert.equal(api.pathAllowed(org + '/commerce?x=1', 'GET'), false);
  assert.equal(api.pathAllowed('/v1/platform/software-membership/plans', 'POST'), false);
  assert.equal(api.pathAllowed(org + '/commerce/plans', 'POST'), false);
});

test('the service page shows the published plan and does not order from the review screen', async () => {
  const posts = [];
  const wx = createWx({
    modalAnswers: [true],
    request(options) {
      if (options.url.endsWith('/v1/auth/session'))
        return envelope({
          user: { id: USER },
          organizations: [{ id: ORG, name: '示例办赛机构', role: 'ORG_OWNER' }],
          teamContexts: [],
        });
      if (options.url.endsWith('/commerce') && options.method === 'GET')
        return envelope({
          mode: 'ENFORCED',
          orgId: ORG,
          canPurchase: true,
          realPaymentEnabled: false,
          plans: [
            {
              id: STD,
              code: 'STD',
              version: 1,
              name: '标准',
              currency: 'CNY',
              amountFen: 9900,
              maxTeams: 8,
              maxMatches: 32,
              validDays: 90,
              available: true,
            },
            {
              id: PRO,
              code: 'PRO',
              version: 1,
              name: '旧专业',
              currency: 'CNY',
              amountFen: 29900,
              maxTeams: 16,
              maxMatches: 128,
              validDays: 180,
              available: true,
            },
            {
              id: ODD,
              code: 'ODD',
              version: 1,
              name: '错规模',
              currency: 'CNY',
              amountFen: 14900,
              maxTeams: 8,
              maxMatches: 16,
              validDays: 30,
              available: true,
            },
          ],
          orders: [],
          entitlements: [],
          activations: [],
          events: [{ id: EVENT, name: '合成杯', version: 3, status: 'READY' }],
          reconciliations: [],
        });
      if (options.url.endsWith('/software-membership'))
        return envelope({
          orgId: ORG,
          purchaseNotice: '合成服务条款',
          periods: [{ state: 'SCHEDULED', remainingEvents: 9, revokedAt: null }],
        });
      if (options.method === 'POST') {
        posts.push(typeof options.data === 'string' ? JSON.parse(options.data) : options.data);
        return { statusCode: 500, data: { error: { code: 'HTTP_ERROR', message: '结果待核对' } } };
      }
      return { statusCode: 404, data: { error: { code: 'NO', message: '未处理' } } };
    },
  });
  const h = loadPage({
    root: require('node:path').resolve(__dirname, '..'),
    route: 'pages/event-service/index',
    wx,
  });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  h.page.onLoad({ orgId: ORG });
  await h.page.onShow();
  assert.equal(h.page.data.cards[0].digits, '99');
  assert.equal(h.page.data.cards[0].planId, STD);
  assert.equal(h.page.data.cards[1].digits, '299');
  assert.equal(h.page.data.cards[1].planId, PRO);
  assert.equal(h.page.data.periodNote, '');
  h.page.setData({ teamText: '甲\n乙', datesText: '2026-11-21', courtsText: '1号场' });
  h.page.generate();
  assert.equal(h.page.data.trialRows.length, 1);
  h.page.saveCurrent();
  h.page._userId = OTHER;
  h.page.restore();
  assert.match(h.page.data.error, /没有这份身份/);
  const before = posts.length;
  h.page.openReview();
  assert.equal(posts.length, before);
  h.page.setData({ offer: 'pro', termsAccepted: true, selectedEventId: EVENT });
  h.page.setData({
    cards: h.page.data.cards.map((card) => ({ ...card, selected: card.key === 'pro' })),
  });
  await h.page.submit();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].planId, PRO);
  assert.equal(posts[0].eventId, EVENT);
  assert.equal(posts[0].expectedEventVersion, 3);
  assert.equal(
    Object.keys(posts[0]).sort().join(),
    'commandId,eventId,expectedEventVersion,planId',
  );
  assert.equal(h.page.data.unknown, true);
});

test('an unknown order keeps its command and a version conflict does not', async () => {
  const wx = createWx({
    request() {
      return { statusCode: 500, data: { error: { code: 'HTTP_ERROR', message: '待核对' } } };
    },
  });
  const h = loadPage({
    root: require('node:path').resolve(__dirname, '..'),
    route: 'pages/event-service/index',
    wx,
  });
  const service = h.requireLocal('utils/event-service-client.js');
  const first = '88888888-8888-4888-8888-888888888888';
  const second = '99999999-9999-4999-8999-999999999999';
  const body = { commandId: first, eventId: EVENT, planId: PRO, expectedEventVersion: 3 };
  const unknown = await service.createEventOrder(ORG, body);
  assert.equal(unknown.kind, 'unknown');
  let seen = '';
  wx.request = (options) => {
    seen = (typeof options.data === 'string' ? JSON.parse(options.data) : options.data).commandId;
    options.success({
      statusCode: 409,
      data: { error: { code: 'VERSION_CONFLICT', message: '方案已变化' } },
    });
  };
  const replay = await service.createEventOrder(ORG, { ...body, commandId: second });
  assert.equal(seen, first);
  assert.equal(replay.kind, 'conflict');
  wx.request = (options) => {
    seen = (typeof options.data === 'string' ? JSON.parse(options.data) : options.data).commandId;
    options.success({
      statusCode: 200,
      data: { data: { id: 'order' }, meta: { requestId: 'ok' } },
    });
  };
  await service.createEventOrder(ORG, { ...body, commandId: second });
  assert.equal(seen, second);
});

test('a user without an organization keeps the trial and uses an existing invitation entry', async () => {
  const seen = [];
  const wx = createWx({
    request(options) {
      seen.push(options.url);
      if (options.url.endsWith('/v1/auth/session'))
        return envelope({ user: { id: USER }, organizations: [], teamContexts: [] });
      return { statusCode: 404, data: { error: { code: 'NO', message: '未处理' } } };
    },
  });
  const h = loadPage({
    root: path.resolve(__dirname, '..'),
    route: 'pages/event-service/index',
    wx,
  });
  await h.requireLocal('utils/api.js').getClient().request('/v1/auth/session');
  h.page.onLoad({});
  await h.page.onShow();
  h.page.setData({ teamText: '甲\n乙', datesText: '2026-11-21', courtsText: '1号场' });
  h.page.openConvert();
  assert.equal(h.page.data.view, 'convert');
  h.page.setData({ teamText: '' });
  h.page.restore();
  assert.equal(h.page.data.teamText, '甲\n乙');
  h.page.setData({ orgId: ORG, teamText: '' });
  h.page.restore();
  assert.equal(h.page.data.teamText, '甲\n乙');
  h.page.openExisting({ currentTarget: { dataset: { page: 'invitation' } } });
  h.page.openExisting({ currentTarget: { dataset: { page: 'team-request' } } });
  const urls = wx.calls.filter((call) => call.type === 'navigateTo').map((call) => call.url);
  assert.ok(urls.some((url) => url.includes('/pages/invitation/')));
  assert.ok(urls.some((url) => url.includes('/pages/team-request/')));
  assert.equal(seen.some((url) => url.includes('/auth/register')), false);
});
