const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = require('../utils/api');
function page(name, request, clock = Date) {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '../pages', name, 'index.js'), 'utf8');
  vm.runInNewContext(source, {
    Page(v) {
      definition = v;
    },
    require() {
      return {
        ...core,
        getClient() {
          return { request };
        },
      };
    },
    wx: { navigateTo() {} },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    Date: clock,
    Promise,
  });
  const instance = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(value) {
      Object.assign(this.data, value);
    },
  };
  return instance;
}
const id = 'a'.repeat(43);
test('group events request groups rather than fabricated whole-event standings; shares only opaque keys', async () => {
  let paths = [];
  const instance = page('event', async (path) => {
    paths.push(path);
    if (path.endsWith('/groups'))
      return { data: { groups: [], qualificationStatus: 'WAITING', bracket: null } };
    if (path.includes('/schedule')) return { data: [], meta: { nextCursor: null } };
    return { data: { name: '合成赛事', format: 'GROUP_KNOCKOUT' } };
  });
  instance.id = id;
  await instance.load();
  assert.equal(
    paths.some((p) => p.endsWith('/groups')),
    true,
  );
  assert.equal(
    paths.some((p) => p.endsWith('/standings')),
    false,
  );
  assert.equal(instance.data.groups.qualificationStatus, 'WAITING');
  assert.equal(instance.onShareAppMessage().path, '/pages/event/index?event=' + id);
});
test('revoked event access clears all prior scoreboard/bracket/roster-derived display instead of fallback', async () => {
  const instance = page('event', async () => {
    throw { status: 404 };
  });
  instance.id = id;
  Object.assign(instance.data, {
    event: { name: 'old' },
    matches: [{ score: { home: 10 } }],
    bracket: { private: 'old' },
    groups: { groups: [] },
  });
  await instance.load();
  assert.equal(instance.data.event, null);
  assert.equal(instance.data.matches.length, 0);
  assert.equal(instance.data.bracket, null);
  assert.equal(instance.data.groups, null);
  assert.match(instance.data.error, /撤销/);
});
test('network failure marks existing event stale without claiming reconnection succeeded', async () => {
  const instance = page('event', async () => {
    throw { message: '离线' };
  });
  instance.id = id;
  instance.data.event = { name: 'old' };
  await instance.load();
  assert.equal(instance.data.stale, true);
  assert.equal(instance.data.event.name, 'old');
});
test('revoked match clears images/video plus snapshot so a stale media path cannot remain visible', async () => {
  const instance = page('match', async () => {
    throw { status: 404 };
  });
  instance.event = id;
  instance.matchId = id;
  instance.data.snapshot = { score: { home: 5 } };
  instance.data.media = [{ src: 'old-url' }];
  await instance.load();
  assert.equal(instance.data.snapshot, null);
  assert.equal(instance.data.media.length, 0);
  assert.equal(instance.data.clock, '未准备');
});

test('slow media never shifts the earlier authoritative snapshot receipt time', async () => {
  let time = 1000,
    release,
    started;
  const media = new Promise((resolve) => {
    release = resolve;
  });
  const mediaStarted = new Promise((resolve) => {
    started = resolve;
  });
  const instance = page(
    'match',
    async (path) => {
      if (path.endsWith('/media')) {
        started();
        return media;
      }
      return { data: { score: { home: 6 } } };
    },
    { now: () => time },
  );
  instance.event = id;
  instance.matchId = id;
  const loading = instance.load();
  await mediaStarted;
  assert.equal(instance.receivedAt, 1000);
  assert.equal(instance.data.snapshot.score.home, 6);
  time = 9000;
  release({ data: { media: [] } });
  await loading;
  assert.equal(instance.receivedAt, 1000);
});
test('media network failure clears old media while retaining freshly received match data', async () => {
  const instance = page('match', async (path) => {
    if (path.endsWith('/media')) throw { status: 503 };
    return { data: { score: { home: 7 } } };
  });
  instance.event = id;
  instance.matchId = id;
  instance.data.media = [{ src: 'old' }];
  await instance.load();
  assert.equal(instance.data.snapshot.score.home, 7);
  assert.equal(instance.data.media.length, 0);
  assert.equal(instance.data.stale, false);
  assert.match(instance.data.error, /媒体暂时无法读取/);
});
