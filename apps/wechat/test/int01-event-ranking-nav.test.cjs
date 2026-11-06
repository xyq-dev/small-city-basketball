const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require('../utils/api');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-event-ranking-nav.json');

const root = path.resolve(__dirname, '..');
const route = fixture.route;
const publicId = fixture.data.sponsorEventPublicId;
const publicRoot = '/v1/public/events/' + publicId;
const topSelectors = fixture.expectVisible.slice(0, 4);
const rankingSelector = topSelectors[2];
const overviewSelector = topSelectors[0];
const subSelector = (view) => `button[data-mini-bindtap="standingsTab"][data-view="${view}"]`;
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const buttons = (html) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];

function matchingButtons(html, selector) {
  const attributes = [...selector.matchAll(/\[([^=\]]+)="([^"]*)"\]/g)];
  assert.ok(attributes.length, selector);
  return buttons(html).filter((button) => {
    const tag = button.slice(0, button.indexOf('>') + 1);
    return attributes.every(([, name, value]) => tag.includes(`${name}="${value}"`));
  });
}

function control(page, selector) {
  const matches = matchingButtons(render(page), selector);
  assert.equal(matches.length, 1, 'Exactly one visible navigation control: ' + selector);
  return matches[0];
}

function click(page, selector) {
  const button = control(page, selector);
  assert.doesNotMatch(button.slice(0, button.indexOf('>')), /\sdisabled\b/, selector);
  const handler = button.match(/data-mini-bindtap="([^"]+)"/)[1];
  const dataset = Object.fromEntries(
    [...button.matchAll(/\sdata-(tab|view)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  );
  page[handler]({ currentTarget: { dataset } });
}

function assertTopNavigation(page) {
  for (const selector of topSelectors) {
    const button = control(page, selector);
    assert.doesNotMatch(button.slice(0, button.indexOf('>')), /\sdisabled\b/, selector);
  }
}

function publicRecords(page) {
  return structuredClone({
    id: page.id,
    sponsorEventPublicId: page.data.sponsorEventPublicId,
    event: page.data.event,
    matches: page.data.matches,
    overviewPoints: page.data.overviewPoints,
    groups: page.data.groups,
    standings: page.data.standings,
    bracket: page.data.bracket,
    follow: page.data.follow,
  });
}

async function setup(query = {}) {
  const requests = [];
  const source = structuredClone(fixture.data);
  const read = async (url, method = 'GET', body, isPublic = true) => {
    requests.push({ url, method, body, isPublic });
    assert.equal(method, 'GET', 'Navigation cannot write');
    assert.equal(isPublic, true, 'Event reads keep their public request mode');
    assert.equal(body, undefined);
    if (url === publicRoot) return { data: structuredClone(source.event) };
    if (url === publicRoot + '/schedule?limit=50')
      return { data: structuredClone(source.matches), meta: { nextCursor: null } };
    if (url === publicRoot + '/groups') return { data: structuredClone(source.groups) };
    assert.fail('Unexpected request: ' + url);
  };
  const client = {
    requestPublic: (url) => read(url, 'GET', undefined, true),
    request: (url, method, body, isPublic = false) => read(url, method, body, isPublic),
    hasSession: () => false,
    viewerId: () => null,
    sessionRevision: () => 0,
    onSessionChange: () => () => {},
  };
  const h = loadPage({
    root,
    route,
    wx: createWx(),
    modules: { '../../utils/api': { ...core, getClient: () => client } },
  });
  h.page.onLoad({ event: publicId, ...query });
  await h.flush();
  assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.error, '');
  assert.equal(h.page.id, publicId);
  assert.equal(h.page.data.sponsorEventPublicId, publicId);
  assert.deepEqual(
    requests.map((request) => request.url),
    [publicRoot, publicRoot + '/schedule?limit=50', publicRoot + '/groups'],
  );
  return { ...h, requests };
}

for (const view of ['schedule', 'points', 'groups']) {
  test(`public overview -> ranking ${view} keeps all outer destinations and return controls`, async () => {
    const h = await setup();
    const original = publicRecords(h.page);
    const reads = structuredClone(h.requests);
    assert.equal(h.page.data.overview, true);
    assertTopNavigation(h.page);
    click(h.page, rankingSelector);
    assertTopNavigation(h.page);
    click(h.page, subSelector(view));
    assert.equal(h.page.data.standingsView, view);

    for (const [selector, tab, overview, text] of [
      [overviewSelector, 'schedule', true, '本周赛程'],
      [topSelectors[1], 'schedule', false, '赛事赛程'],
      [topSelectors[3], 'media', false, '选择比赛查看媒体'],
    ]) {
      assertTopNavigation(h.page);
      click(h.page, selector);
      assert.equal(h.page.data.tab, tab);
      assert.equal(h.page.data.overview, overview);
      assert.ok(render(h.page).includes(text));
      assertTopNavigation(h.page);
      click(h.page, rankingSelector);
      assert.equal(h.page.data.tab, 'ranking');
      assert.equal(h.page.data.overview, false);
      click(h.page, subSelector(view));
      assert.equal(h.page.data.standingsView, view);
      assert.deepEqual(publicRecords(h.page), original);
      assert.deepEqual(h.requests, reads, 'Display transitions issue no extra HTTP requests');
    }
    click(h.page, overviewSelector);
    assert.equal(h.page.data.overview, true);
    assert.deepEqual(publicRecords(h.page), original);
    assert.deepEqual(h.requests, reads);
    assert.equal(
      h.wx.calls.some((call) => call.type === 'showModal'),
      false,
    );
    assert.equal(
      h.wx.calls.some((call) => call.type === 'navigateTo'),
      false,
    );
    h.unload();
  });
}

test('a direct public ranking link exposes the same outer navigation without an identity change', async () => {
  const h = await setup({ tab: 'ranking' });
  const original = publicRecords(h.page);
  assert.equal(h.page.data.tab, 'ranking');
  assert.equal(h.page.data.overview, false);
  assertTopNavigation(h.page);
  click(h.page, topSelectors[3]);
  click(h.page, rankingSelector);
  click(h.page, overviewSelector);
  assert.deepEqual(publicRecords(h.page), original);
  assert.equal(h.requests.length, 3);
  h.unload();
});

test('loading preserves the public snapshot and disables outer and standings navigation', async () => {
  const h = await setup({ tab: 'ranking' });
  h.page.setData({ loading: true });
  const original = structuredClone(h.page.data);
  for (const selector of fixture.expectVisible) {
    const button = control(h.page, selector);
    assert.match(button.slice(0, button.indexOf('>')), /\sdisabled\b/, selector);
  }
  h.page.tab({ currentTarget: { dataset: { tab: 'media' } } });
  h.page.backToOverview();
  h.page.standingsTab({ currentTarget: { dataset: { view: 'points' } } });
  assert.deepEqual(h.page.data, original);
  assert.equal(h.requests.length, 3);
  h.page.setData({ loading: false });
  click(h.page, overviewSelector);
  assert.equal(h.page.data.overview, true);
  h.unload();
});

test('a busy follow remains disabled while read-only section navigation stays available', async () => {
  const h = await setup({ tab: 'ranking' });
  h.page.setData({
    follow: { ...h.page.data.follow, state: 'none', busy: true },
  });
  const original = publicRecords(h.page);
  assertTopNavigation(h.page);
  click(h.page, overviewSelector);
  const followButtons = matchingButtons(
    render(h.page),
    'button[data-mini-bindtap="followPrimary"]',
  );
  assert.ok(followButtons.length);
  for (const button of followButtons)
    assert.match(button.slice(0, button.indexOf('>')), /\sdisabled\b/);
  h.page.followPrimary();
  click(h.page, rankingSelector);
  assert.deepEqual(publicRecords(h.page), original);
  assert.equal(h.requests.length, 3);
  assert.equal(
    h.wx.calls.some((call) => call.type === 'showModal'),
    false,
  );
  h.unload();
});

test('an unavailable public event does not expose navigation for the removed event', () => {
  const h = loadPage({ root, route });
  h.page.setData({ event: null, unavailable: true, loading: false });
  const html = render(h.page);
  for (const selector of fixture.expectVisible)
    assert.equal(matchingButtons(html, selector).length, 0);
  assert.match(html, /该赛事已停止公开/);
});

test('the public ranking fixture exposes enabled outer and inner controls at all three widths', () => {
  const h = loadPage({ root, route });
  h.page.setData(structuredClone(fixture.data));
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), `${width}: ${text}`);
    for (const selector of fixture.expectVisible) {
      const matches = matchingButtons(html, selector);
      assert.equal(matches.length, 1, `${width}: ${selector}`);
      assert.doesNotMatch(matches[0].slice(0, matches[0].indexOf('>')), /\sdisabled\b/);
    }
    for (const name of fixture.expectEnabled) {
      const matches = buttons(html).filter(
        (button) => button.replace(/<[^>]*>/g, '').trim() === name,
      );
      assert.ok(matches.length, `${width}: ${name}`);
      for (const button of matches)
        assert.doesNotMatch(button.slice(0, button.indexOf('>')), /\sdisabled\b/);
    }
  }
});
