const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const fixture = require('../../../tests/mini-program/fixtures/int01-schedule-all-mode.json');

const root = path.resolve(__dirname, '..');
const route = 'pages/schedule/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const copy = (value) => JSON.parse(JSON.stringify(value));
const org = id(1),
  event = id(2),
  revisionId = id(3),
  court = id(4);
const prefix = '/v1/orgs/' + org;
const revision = () => ({
  id: revisionId,
  eventId: event,
  status: 'DRAFT',
  eventVersion: 7,
  version: 3,
  capabilities: { canEditAllocations: true, canValidate: true, canPublish: false },
  policy: { thirdPlaceMatch: false },
  participants: [
    { entryId: id(5), teamName: '合成一队' },
    { entryId: id(6), teamName: '合成二队' },
  ],
  rounds: [{ roundNo: 1 }],
  fixtures: [
    {
      fixtureKey: 'R1-P1',
      roundNo: 1,
      positionNo: 1,
      homeEntryId: id(5),
      awayEntryId: id(6),
      courtId: court,
      startsAt: '2028-03-01T01:00:00.000Z',
    },
    {
      fixtureKey: 'R2-P1',
      roundNo: 2,
      positionNo: 1,
      homeEntryId: id(6),
      awayEntryId: id(5),
      courtId: null,
      startsAt: null,
    },
  ],
});
const proposal = (preserve) => ({
  algorithm: 'BALANCED_SEARCH_V1',
  optimality: 'BOUNDED_HEURISTIC',
  eventVersion: 7,
  revisionVersion: 3,
  sourceHash: 'a'.repeat(64),
  status: 'COMPLETE',
  allocations: [
    {
      fixtureKey: 'R1-P1',
      courtId: court,
      startsAt: preserve ? '2028-03-01T01:00:00.000Z' : '2028-03-01T02:00:00.000Z',
    },
    { fixtureKey: 'R2-P1', courtId: court, startsAt: '2028-03-01T04:00:00.000Z' },
  ],
  unassigned: [],
  score: { assignedCount: 2, firstLastPenalty: 0 },
  checks: 20,
  limitReached: false,
});
async function harness() {
  const requests = [],
    state = { revision: revision(), session: 1, previewError: null, writeError: null };
  const client = {
    sessionRevision: () => state.session,
    hasSession: () => true,
    onSessionChange(listener) {
      state.listener = listener;
      return () => {};
    },
    async request(url, method = 'GET', body) {
      requests.push({ url, method, body: copy(body || {}) });
      if (url === '/v1/auth/session')
        return { data: { user: { id: id(9) }, organizations: [], teamContexts: [] } };
      if (url.endsWith('/scheduling'))
        return {
          data: {
            event: {
              id: event,
              name: '合成排程杯',
              status: 'REGISTRATION_FROZEN',
              version: 7,
              format: 'DOUBLE_ROUND_ROBIN',
              startDate: '2028-03-01',
              endDate: '2028-03-02',
            },
            support: { supported: true },
            freeze: {
              id: id(7),
              rulesetId: id(8),
              rulesetVersion: 1,
              eventVersion: 6,
              entryCount: 2,
            },
            currentRevision: { id: revisionId },
            publication:
              state.revision.status === 'PUBLISHED'
                ? { matchCount: 2, publishedAt: '2028-03-01T00:00:00Z' }
                : null,
            capabilities: { canGenerate: false, canRedraw: true, canReadMatches: true },
          },
        };
      if (url === prefix + '/courts?limit=100')
        return {
          data: [{ id: court, name: '合成一号场', status: 'ACTIVE' }],
          meta: { nextCursor: null },
        };
      if (url === prefix + '/schedule-revisions/' + revisionId)
        return { data: copy(state.revision) };
      if (url.endsWith('/optimization-preview')) {
        if (state.waitPreview) await state.waitPreview;
        if (state.previewError) throw state.previewError;
        return { data: proposal(body.preserveAssigned) };
      }
      if (url.endsWith('/allocations')) {
        if (state.writeError) throw state.writeError;
        return { data: {} };
      }
      throw Error('Unexpected synthetic URL: ' + url);
    },
  };
  const wx = createWx();
  wx.showModal = (options) => {
    wx.calls.push({ type: 'showModal', ...options });
    state.modal = options;
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const h = loadPage({ root, route, wx, modules: { [path.join(root, 'utils/api.js')]: api } });
  h.page.onLoad({ orgId: org, eventId: event });
  await h.flush();
  assert.equal(h.page.data.state, 'draft');
  requests.length = 0;
  return { ...h, state, requests };
}
function controls(h, width = 320) {
  const html = buildPreview({ root, route, data: h.page.data, width, height: 844 }).phone;
  return [...html.matchAll(/<button\b([^>]*)>/g)]
    .filter((match) => /data-mini-bindtap="autoAssign"/.test(match[1]))
    .map((match) => ({
      mode: match[1].match(/data-mode="([^"]+)"/)?.[1],
      disabled: /\sdisabled(?:\s|$)/.test(match[1]),
    }));
}
function tap(h, mode) {
  const control = controls(h).find((button) => button.mode === mode);
  assert.ok(control, 'actual template must expose mode=' + mode);
  if (control.disabled) return null;
  return h.page.autoAssign({ currentTarget: { dataset: { mode: control.mode } } });
}
const writes = (h) => h.requests.filter((request) => request.method === 'PUT');

for (const [mode, preserve] of [
  ['all', false],
  ['preserve', true],
]) {
  test(
    'rendered ' + mode + ' entry reaches the original handler and exact versioned allocations',
    async () => {
      const h = await harness();
      const pending = tap(h, mode);
      await h.flush();
      assert.equal(h.requests.length, 1);
      assert.deepEqual(h.requests[0], {
        url: prefix + '/schedule-revisions/' + revisionId + '/optimization-preview',
        method: 'POST',
        body: { expectedEventVersion: 7, expectedRevisionVersion: 3, preserveAssigned: preserve },
      });
      assert.equal(writes(h).length, 0, 'preview must await explicit user confirmation');
      assert.match(h.state.modal.title, preserve ? /采用补排建议/ : /采用全稿均衡排程/);
      assert.match(h.state.modal.content, preserve ? /保留已有安排/ : /重排当前草稿全部场地和时间/);
      h.state.modal.success({ confirm: true });
      await pending;
      assert.deepEqual(writes(h), [
        {
          url: prefix + '/schedule-revisions/' + revisionId + '/allocations',
          method: 'PUT',
          body: {
            expectedEventVersion: 7,
            expectedRevisionVersion: 3,
            allocations: proposal(preserve).allocations,
          },
        },
      ]);
      assert.equal(h.page.data.validated, false);
    },
  );

  test('cancelling ' + mode + ' confirmation never applies its preview', async () => {
    const h = await harness(),
      pending = tap(h, mode);
    await h.flush();
    h.state.modal.success({ confirm: false });
    await pending;
    assert.equal(writes(h).length, 0);
  });
}

test('both original entries stay disabled during busy and loading states', async () => {
  for (const flag of ['busy', 'loading']) {
    const h = await harness();
    h.page.setData({ [flag]: true });
    for (const mode of ['all', 'preserve']) {
      assert.equal(controls(h).find((button) => button.mode === mode)?.disabled, true);
      assert.equal(tap(h, mode), null);
    }
    assert.deepEqual(h.requests, []);
  }
});

test('locked drafts and published or superseded revisions cannot expose the full-draft write entry', async () => {
  for (const [state, status] of [
    ['draft', 'DRAFT'],
    ['published', 'PUBLISHED'],
    ['readonly', 'SUPERSEDED'],
  ]) {
    const h = await harness();
    h.state.revision.status = status;
    h.state.revision.capabilities.canEditAllocations = false;
    await h.page.load();
    assert.equal(h.page.data.state, state);
    assert.equal(
      controls(h).some((button) => button.mode === 'all'),
      false,
    );
    assert.equal(controls(h).find((button) => button.mode === 'preserve')?.disabled, true);
    h.requests.length = 0;
    await h.page.autoAssign({ currentTarget: { dataset: { mode: 'all' } } });
    assert.deepEqual(h.requests, []);
  }
});

test('an unknown preview outcome cannot confirm or apply a new allocation', async () => {
  const h = await harness();
  h.state.previewError = Error('合成网络结果未知');
  await tap(h, 'all');
  assert.equal(h.state.modal, undefined);
  assert.equal(writes(h).length, 0);
  assert.match(h.page.data.error, /结果未知/);
});

test('an unknown allocation outcome retains the original versions on an explicit retry', async () => {
  const h = await harness();
  h.state.writeError = Error('合成原写入结果未知');
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = tap(h, 'all');
    await h.flush();
    h.state.modal.success({ confirm: true });
    await pending;
    assert.match(h.page.data.error, /原写入结果未知/);
  }
  assert.equal(writes(h).length, 2);
  assert.deepEqual(writes(h)[0], writes(h)[1]);
  assert.equal(writes(h)[1].body.expectedRevisionVersion, 3);
});

for (const change of ['target', 'session', 'unload'])
  test(
    change + ' while the all-mode confirmation is open cannot write the old revision',
    async () => {
      const h = await harness(),
        pending = tap(h, 'all');
      await h.flush();
      if (change === 'target') h.page._revision = revision();
      else if (change === 'session') {
        h.state.session++;
        h.state.listener();
      } else h.page.onUnload();
      h.state.modal.success({ confirm: true });
      await pending;
      assert.equal(writes(h).length, 0);
    },
  );

test('a late preview for a replaced revision cannot reach confirmation or apply', async () => {
  const h = await harness();
  let resolve;
  h.state.waitPreview = new Promise((done) => {
    resolve = done;
  });
  const pending = tap(h, 'all');
  await h.flush();
  h.page._revision = revision();
  resolve();
  await pending;
  assert.equal(h.state.modal, undefined);
  assert.equal(writes(h).length, 0);
});

test('the new CI fixture renders both modes at three widths without adding a third footer action', () => {
  const h = loadPage({ root, route });
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = buildPreview({ root, route, data: h.page.data, width, height: 844 }).phone;
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.deepEqual(
      controls(h, width)
        .map((control) => control.mode)
        .sort(),
      ['all', 'preserve'],
    );
    const footer = html.slice(html.lastIndexOf('class="figma-fixed-actions"'));
    assert.equal((footer.match(/<button\b/g) || []).length, 2);
  }
});
