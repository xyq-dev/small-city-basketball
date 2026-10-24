const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../utils/performance-links');
const link = (id = 'link-a', version = 1) => ({
  id,
  version,
  profileId: 'profile-a',
  profileName: '合成球员',
  orgId: 'org-a',
  eventId: 'event-a',
  eventName: '合成赛事',
  teamId: 'team-a',
  teamName: '合成球队',
  memberId: 'member-a',
  memberName: '合成成员',
  status: 'PENDING',
  sourceCurrentlyAvailable: true,
  createdAt: '2026-10-24T00:00:00Z',
  capabilities: { canConsent: true, canRevoke: true },
});
const event = { id: 'event-a', orgId: 'org-a', name: '合成赛事' };
const sources = {
  event,
  teams: [
    {
      id: 'team-a',
      name: '合成球队',
      members: [{ id: 'member-a', name: '合成成员', jerseyNo: '7' }],
    },
  ],
};
const profiles = [{ id: 'profile-a', displayName: '合成球员', status: 'APPROVED' }];
const workspace = (links = [link()]) => ({
  viewerUserId: 'actor-a',
  ownProfileId: 'profile-a',
  manageableEvents: [event],
  links,
  linksHasMore: false,
  nextCursor: null,
  disclosureNotice: '仅公开本人有限统计',
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(overrides = {}) {
  let definition,
    revision = 1,
    actor = 'actor-a',
    uuids = 0;
  const ui = {
    session: async () => ({ user: { id: actor } }),
    begin(p) {
      return { generation: (p._generation = (p._generation || 0) + 1), revision };
    },
    live(p, t) {
      return !p._closed && p._generation === t.generation && revision === t.revision;
    },
    close(p) {
      p._closed = true;
    },
    localTime: (s) => s,
    uuid: async () => 'secure-' + ++uuids,
    confirm: async () => true,
    message: (e) => e.message || '操作未完成',
    login() {},
    open() {},
  };
  const sdk = {
    performanceWorkspace: async () => ({ ...workspace(), viewerUserId: actor }),
    workspace: async () => ({ viewerUserId: actor, players: profiles }),
    link: async (id) => link(id),
    sources: async () => sources,
    performanceCommand: async (id) => ({
      ...link(id, 2),
      status: 'APPROVED',
      capabilities: { canConsent: false, canRevoke: true },
    }),
    nominate: async () => link('new-link'),
    ...overrides,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../pages/performance/index.js'), 'utf8'),
    {
      Page(d) {
        definition = d;
      },
      require(name) {
        return name.endsWith('/booking')
          ? sdk
          : name.endsWith('/ui')
            ? ui
            : name.endsWith('/api')
              ? { getClient: () => ({ sessionRevision: () => revision }) }
              : model;
      },
      console,
      Date,
      Promise,
      Map,
      Set,
    },
  );
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return {
    page,
    sdk,
    ui,
    uuids: () => uuids,
    changeActor(id) {
      actor = id;
      revision++;
    },
  };
}

test('history deduplicates by stable id without losing earlier valid authorizations', () => {
  const merged = model.mergeLinks([link('old'), link('new', 1)], [link('new', 2), link('older')]);
  assert.deepEqual(
    merged.map((l) => l.id),
    ['old', 'new', 'older'],
  );
  assert.equal(merged[1].version, 2);
  assert.deepEqual(model.visibleLinks(merged, true, 'not-on-this-page', 'ALL'), []);
  assert.throws(() => model.cursorAfter({ linksHasMore: true, nextCursor: 'same' }, 'same'));
  assert.throws(() => model.cursorAfter({ linksHasMore: false, nextCursor: 'unused' }));
});
test('nomination requires explicit publisher consent and precise event-team-member-approved profile graph', () => {
  const draft = {
    ...model.emptyDraft(),
    eventId: event.id,
    orgId: event.orgId,
    teamId: 'team-a',
    memberId: 'member-a',
    profileId: 'profile-a',
    reason: '已经核对固定报名名单',
  };
  assert.throws(() => model.nominateInput(draft, [event], sources, profiles, 'cmd'));
  draft.publisherConsent = true;
  const value = model.nominateInput(draft, [event], sources, profiles, 'cmd');
  assert.equal(value.memberId, 'member-a');
  assert.equal(value.publisherConsent, true);
  assert.throws(() =>
    model.nominateInput(
      { ...draft, memberId: 'other-same-name' },
      [event],
      sources,
      profiles,
      'cmd',
    ),
  );
  assert.throws(() => model.nominateInput(draft, [], sources, profiles, 'cmd'));
  assert.throws(() =>
    model.nominateInput(draft, [event], sources, [{ ...profiles[0], status: 'DISABLED' }], 'cmd'),
  );
});
test('consent is explicit and capabilities must be boolean true; pending rejection uses REVOKE', () => {
  assert.throws(() => model.commandInput(link(), 'CONSENT', '本人核对', false, 'cmd'));
  assert.equal(
    model.allowed({ ...link(), capabilities: { canConsent: 'true' } }, 'CONSENT'),
    false,
  );
  const revoke = model.commandInput(link(), 'REVOKE', '这不是本人记录', false, 'cmd');
  assert.equal(revoke.type, 'REVOKE');
  assert.equal('playerConsent' in revoke, false);
  assert.equal(model.allowed({ ...link(), status: 'REVOKED' }, 'REVOKE'), false);
});
test('pagination retries the same cursor and retains earlier rows on a transport failure', async () => {
  const cursors = [];
  const h = harness({
    performanceWorkspace: async (cursor) => {
      if (!cursor) return { ...workspace(), linksHasMore: true, nextCursor: 'page-2' };
      cursors.push(cursor);
      if (cursors.length === 1) throw { status: 503, message: '分页暂不可用' };
      return { ...workspace([link('older')]), linksHasMore: false, nextCursor: null };
    },
  });
  await h.page.load();
  await h.page.more();
  assert.equal(h.page.data.nextCursor, 'page-2');
  assert.equal(h.page.data.links.length, 1);
  assert.match(h.page.data.pageError, /当前游标未推进/);
  await h.page.more();
  assert.deepEqual(cursors, ['page-2', 'page-2']);
  assert.equal(h.page.data.links.length, 2);
  assert.equal(h.page.data.linksHasMore, false);
});
test('own-only empty current page still permits loading older own records', async () => {
  let requested = false;
  const h = harness({
    performanceWorkspace: async (cursor) =>
      cursor
        ? ((requested = true), workspace([link('own-old')]))
        : {
            ...workspace([{ ...link('other'), profileId: 'profile-other' }]),
            linksHasMore: true,
            nextCursor: 'older',
          },
  });
  h.page.onLoad({ own: '1' });
  await h.page.load();
  assert.equal(h.page.data.links.length, 0);
  await h.page.more();
  assert.equal(requested, true);
  assert.equal(h.page.data.links[0].id, 'own-old');
});
test('opening action privately rechecks current capability and removes stale action if denied', async () => {
  let read = 0,
    writes = 0;
  const h = harness({
    link: async () => {
      read++;
      return { ...link(), capabilities: { canConsent: false, canRevoke: false } };
    },
    performanceCommand: async () => {
      writes++;
    },
  });
  await h.page.load();
  await h.page.checkLink({ currentTarget: { dataset: { id: 'link-a', type: 'CONSENT' } } });
  assert.equal(read, 1);
  assert.equal(writes, 0);
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page.data.links.length, 0);
});
test('record version changing after opening resets explicit consent and does not write old confirmation', async () => {
  let reads = 0,
    writes = 0;
  const h = harness({
    link: async () => link('link-a', ++reads === 1 ? 2 : 3),
    performanceCommand: async () => {
      writes++;
    },
  });
  await h.page.load();
  await h.page.checkLink({ currentTarget: { dataset: { id: 'link-a', type: 'CONSENT' } } });
  h.page.dialogReason({ detail: { value: '本人已核对' } });
  h.page.playerConsent({ detail: { value: ['yes'] } });
  await h.page.submitDialog();
  assert.equal(writes, 0);
  assert.equal(h.page.data.pending.link.version, 3);
  assert.equal(h.page.data.pending.consent, false);
  assert.equal(h.page.data.pending.reason, '');
});
test('a lost command result replays identical original id/version even when current record is now approved', async () => {
  let reads = 0;
  const calls = [];
  const h = harness({
    link: async () =>
      ++reads <= 2
        ? link('link-a', 2)
        : {
            ...link('link-a', 3),
            status: 'APPROVED',
            capabilities: { canConsent: false, canRevoke: true },
          },
    performanceCommand: async (id, input) => {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (calls.length === 1) throw { code: 'NETWORK_ERROR', message: '响应丢失' };
      return { ...link(id, 3), status: 'APPROVED' };
    },
  });
  await h.page.load();
  await h.page.checkLink({ currentTarget: { dataset: { id: 'link-a', type: 'CONSENT' } } });
  h.page.dialogReason({ detail: { value: '本人核对后同意' } });
  h.page.playerConsent({ detail: { value: ['yes'] } });
  await h.page.submitDialog();
  assert.equal(h.page.data.pendingUnknown, true);
  h.page.dialogReason({ detail: { value: '不可改写' } });
  await h.page.submitDialog();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].expectedVersion, 2);
  assert.equal(h.uuids(), 1);
  assert.equal(h.page.data.pending, null);
});
test('draft blocks refresh/history and resets publisher consent when target changes', async () => {
  let lists = 0;
  const h = harness({
    performanceWorkspace: async () => {
      lists++;
      return { ...workspace(), linksHasMore: true, nextCursor: 'older' };
    },
  });
  await h.page.load();
  await h.page.chooseEvent({ detail: { value: '0' } });
  h.page.publisherConsent({ detail: { value: ['yes'] } });
  h.page.chooseTeam({ detail: { value: '0' } });
  assert.equal(h.page.data.draft.publisherConsent, false);
  assert.equal(h.page.data.dirty, true);
  h.page.refresh();
  await h.page.more();
  assert.equal(lists, 1);
  assert.match(h.page.data.message, /完成或关闭/);
});
test('late private link response after account switch cannot open consent dialog or retain old records', async () => {
  const wait = deferred();
  const h = harness({ link: () => wait.promise });
  await h.page.load();
  const opening = h.page.checkLink({
    currentTarget: { dataset: { id: 'link-a', type: 'CONSENT' } },
  });
  await Promise.resolve();
  h.changeActor('actor-b');
  wait.resolve(link());
  await opening;
  assert.equal(h.page.data.pending, null);
  assert.equal(h.page.data.links.length, 0);
  assert.equal(h.page.data.authorized, false);
  assert.equal(h.uuids(), 0);
});

test('unknown nomination locks original graph and retries original command without replacing id', async () => {
  const calls = [];
  const h = harness({
    nominate: async (input) => {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (calls.length === 1) throw { code: 'NETWORK_ERROR', message: '提名响应丢失' };
      return link('new-link');
    },
  });
  await h.page.load();
  await h.page.chooseEvent({ detail: { value: '0' } });
  h.page.chooseTeam({ detail: { value: '0' } });
  h.page.chooseMember({ detail: { value: '0' } });
  h.page.chooseProfile({ detail: { value: '0' } });
  h.page.draftReason({ detail: { value: '核对了固定名单' } });
  h.page.publisherConsent({ detail: { value: ['yes'] } });
  await h.page.nominate();
  assert.equal(h.page.data.nominationUnknown, true);
  h.page.draftReason({ detail: { value: '不允许覆盖原请求' } });
  assert.equal(h.page.data.draft.reason, '核对了固定名单');
  await h.page.nominate();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(h.uuids(), 1);
  assert.equal(h.page.data.nominationUnknown, false);
});

test('hiding an unfinished read does not permanently block a fresh show', async () => {
  const wait = deferred(),
    started = deferred();
  let requests = 0;
  const h = harness({
    performanceWorkspace: async () => {
      requests++;
      if (requests === 1) {
        started.resolve();
        return wait.promise;
      }
      return workspace([link('current')]);
    },
  });
  const old = h.page.load();
  await started.promise;
  h.page.onHide();
  h.page._hidden = false;
  await h.page.load();
  wait.resolve(workspace([link('old')]));
  await old;
  assert.equal(h.page.data.links[0].id, 'current');
  assert.equal(h.page.data.loading, false);
});
