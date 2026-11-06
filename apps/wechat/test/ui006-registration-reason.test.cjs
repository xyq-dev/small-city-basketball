const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/registration-events/index';
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../tests/mini-program/fixtures/c10-team-events-existing.json'),
    'utf8',
  ),
).data;
const copy = (value) => JSON.parse(JSON.stringify(value));
const originalReason = fixture.events[0].entry.latestReviewReason;
function setup() {
  let revision = 1;
  const listeners = new Set(),
    calls = [];
  // Static layout fixtures omit the event CAS; the controlled API supplies its required version.
  const state = {
    rows: copy(fixture.events).map((row) => ({ ...row, event: { ...row.event, version: 1 } })),
    nextCursor: null,
  };
  const base = '/v1/orgs/' + fixture.team.orgId + '/teams/' + fixture.team.id;
  const client = {
    sessionRevision: () => revision,
    onSessionChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(method, 'GET', 'Displaying an existing review reason must not write');
      if (url === '/v1/auth/session')
        return {
          data: {
            user: { id: 'c1000000-0000-4000-8000-000000000040' },
            organizations: [],
            teamContexts: [],
          },
        };
      if (url === base) return { data: copy(fixture.team) };
      assert.ok(url.startsWith(base + '/registration-events?'));
      return { data: copy(state.rows), meta: { nextCursor: state.nextCursor } };
    },
  };
  const api = { getClient: () => client, uuid: (value) => value };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: {
      './api': api,
      '../../utils/api': api,
    },
  });
  h.page.onLoad({ orgId: fixture.team.orgId, teamId: fixture.team.id });
  return {
    ...h,
    state,
    calls,
    switchUser() {
      revision++;
      for (const fn of [...listeners]) fn();
    },
  };
}
const render = (page) => buildPreview({ root, route, data: page.data }).phone;

test('authorized registration read renders its latest review reason and keeps the existing entry reachable', async () => {
  const h = setup();
  h.state.rows[0].entry.history = [{ reason: '赛事列表不应额外展示的历史字段' }];
  await h.page.load();
  assert.equal(h.page.data.events[0].entry.latestReviewReason, originalReason);
  const html = render(h.page);
  assert.match(html, new RegExp(originalReason));
  assert.doesNotMatch(html, /赛事列表不应额外展示的历史字段/);
  await h.page.enter({ currentTarget: { dataset: { id: fixture.events[0].event.id } } });
  assert.equal(
    h.wx.calls.at(-1)?.url,
    '/pages/entry/index?orgId=' + fixture.team.orgId + '&entryId=' + fixture.events[0].entry.id,
  );
  assert.equal(
    h.calls.some((call) => call.method !== 'GET'),
    false,
  );
});

test('a later page replaces the reason and a refreshed entry without a reason clears the old text', async () => {
  const h = setup();
  h.state.nextCursor = 'next-page';
  await h.page.load();
  h.state.rows[0].entry.latestReviewReason = '请按最新审核意见补齐号码';
  h.state.rows[0].entry.version++;
  h.state.nextCursor = null;
  await h.page.more();
  assert.equal(h.page.data.events.length, 1);
  assert.match(render(h.page), /请按最新审核意见补齐号码/);
  assert.doesNotMatch(render(h.page), new RegExp(originalReason));
  h.state.rows[0].entry.latestReviewReason = null;
  h.state.rows[0].entry.status = 'APPROVED';
  await h.page.load();
  assert.doesNotMatch(render(h.page), /请按最新审核意见补齐号码|审核意见：/);
});

test('missing or empty review reasons do not expose historical reasons or invent an instruction', async () => {
  for (const missing of [true, false]) {
    const h = setup();
    if (missing) delete h.state.rows[0].entry.latestReviewReason;
    else h.state.rows[0].entry.latestReviewReason = '';
    h.state.rows[0].entry.history = [{ type: 'REQUEST_CHANGES', reason: '不应从历史推测当前意见' }];
    await h.page.load();
    assert.equal(h.page.data.error, '');
    assert.equal(h.page.data.events.length, 1);
    assert.doesNotMatch(render(h.page), /审核意见：|不应从历史推测当前意见/);
  }
});

test('session reset removes the prior team review reason from the registration list', async () => {
  const h = setup();
  await h.page.load();
  assert.match(render(h.page), new RegExp(originalReason));
  h.switchUser();
  assert.equal(h.page.data.events.length, 0);
  assert.equal(h.page.data.team, null);
  assert.doesNotMatch(render(h.page), new RegExp(originalReason));
});
