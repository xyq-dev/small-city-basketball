const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../utils/api');
const { loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const fixtureDirectory = path.resolve(__dirname, '../../../tests/mini-program/fixtures');
const actor = '90000000-0000-4000-8000-000000000099';
const team = {
  id: '90000000-0000-4000-8000-000000000100',
  orgId: '90000000-0000-4000-8000-000000000200',
  name: '合成石鼓篮球队',
};
const players = ['合成林越', '合成陈凯'].map((displayName, index) => ({
  id: '90000000-0000-4000-8000-00000000000' + (index + 1),
  userId: '90000000-0000-4000-8000-00000000000' + (index + 3),
  displayName,
  position: index === 0 ? 'PG' : 'SG',
  status: 'APPROVED',
  priceFen: 30000,
  travelFen: index === 0 ? 0 : 8000,
  accommodationFen: 0,
  version: 1,
}));

async function loaded(kind) {
  const requests = [];
  const client = {
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    request: async (route, method = 'GET') => {
      requests.push({ route, method });
      assert.equal(route, '/v1/auth/session');
      assert.equal(method, 'GET');
      return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
    },
  };
  const workspace = {
    viewerUserId: actor,
    teams: kind === 'permission' ? [] : [team],
    players: kind === 'empty' ? [{ ...players[0], userId: actor }] : players,
    events: [],
    matches: [],
    settings: { feeBps: 1000, version: 1 },
  };
  const h = loadPage({
    root,
    route: 'pages/booking-create/index',
    modules: {
      [path.join(root, 'utils/api.js')]: { ...api, getClient: () => client },
      [path.join(root, 'utils/booking.js')]: { workspace: async () => workspace },
    },
  });
  h.requireLocal('utils/ui.js').today = () => '2026-10-28';
  h.page.onLoad({});
  await h.page.load();
  assert.deepEqual(requests, [{ route: '/v1/auth/session', method: 'GET' }]);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'request'),
    false,
  );
  return h;
}

for (const kind of ['empty', 'permission']) {
  test(
    'booking ' + kind + ' fixture is produced by the real Page load and renderForm',
    async () => {
      const h = await loaded(kind);
      const fixture = JSON.parse(
        fs.readFileSync(path.join(fixtureDirectory, 'c10-core-booking-' + kind + '.json'), 'utf8'),
      );
      assert.deepEqual(h.page.data, fixture.data);
      assert.equal(h.page.data.noPlayers, kind === 'empty');
      assert.equal(h.page.data.noTeams, kind === 'permission');
      assert.equal(h.page.data.teams.length, kind === 'permission' ? 0 : 1);
      assert.equal(h.page.data.players.length, kind === 'empty' ? 0 : 2);
      assert.equal(h.page.data.selectedCount, 0);
      assert.equal(h.page.data.quote.confirmed, '¥0.00');
      assert.equal(h.page.data.quote.count, 0);
      assert.equal(h.page.data.review, false);
      assert.equal(h.page.data.consent, false);
      for (const width of [320, 390, 430]) {
        const html = buildPreview({ root, ...fixture, width, height: 844 }).phone;
        for (const text of fixture.expectText) assert.ok(html.includes(text), text);
        for (const text of fixture.expectAbsentText) assert.ok(!html.includes(text), text);
        assert.doesNotMatch(html, /data-mini-bindtap="(?:review|submit)"/);
        assert.doesNotMatch(html, /<script\b|src="https?:/);
        for (const name of fixture.expectEnabled) {
          const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
            (match) => match[2].replace(/<[^>]*>/g, '').trim() === name,
          );
          assert.ok(button, name);
          assert.doesNotMatch(button[1], /\sdisabled(?:\s|$)/);
        }
      }
    },
  );
}
