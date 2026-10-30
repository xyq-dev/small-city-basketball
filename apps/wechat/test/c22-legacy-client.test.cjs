const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setPath } = require('./helpers/native-page.cjs');

// R05 is intentionally about the real pre-C22 client. These frozen source fixtures are not
// the new UI. Network/session/confirmation are explicit doubles, not a real API or WeChat.
const fixtureRoot = path.join(__dirname, 'fixtures/c22-legacy-2d22114');
const fixtures = {
  'event-setup.js.txt': {
    sha256: 'def712869ac771a3bb86041595dfcac260106dee17f32be2412f5690d98bfc63',
    blob: '74e31f6b2016533ee11757d86e899d5e030af57b',
  },
  'directory.js.txt': {
    sha256: '3fbdfbe0d381586763cf62b02c27d662c9aaa7c606b0b7e098ee2f87a85e8cd8',
    blob: '437a53ef060d20a8db21f62a5b83134b86653ca6',
  },
};
function source(name) {
  const raw = readFileSync(path.join(fixtureRoot, name));
  assert.equal(createHash('sha256').update(raw).digest('hex'), fixtures[name].sha256);
  assert.equal(
    createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex'),
    fixtures[name].blob,
  );
  return raw.toString('utf8');
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const orgId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const listingId = '33333333-3333-4333-8333-333333333333';
const publicEventId = 'A'.repeat(43);
const base = `/v1/orgs/${orgId}/events/${eventId}`;
const region = {
  catalogVersion: 'cn-admin-2025-r1',
  regionId: '5dbae224-8a72-5c66-8b2e-d6a7a9f312e3',
};
function dto(active = true, standard = true, version = 12) {
  return {
    event: { id: eventId, status: 'SCHEDULED', version },
    publication: { publicEventId, status: 'ACTIVE', purpose: 'LIVE' },
    listing: active
      ? {
          id: listingId,
          status: 'ACTIVE',
          publicEventId,
          displayCity: standard ? '高州市' : '高州',
          region: standard ? region : null,
          listedAt: '2026-10-30T00:00:00.000Z',
          revokedAt: null,
          revokeSource: null,
        }
      : null,
    lastListing: null,
    group: 'UPCOMING',
    regionCatalogVersion: region.catalogVersion,
    capabilities: { canList: !active, canUnlist: active, canReplaceRegion: active },
  };
}
function legacyClient(initial = dto()) {
  const state = { current: structuredClone(initial), writes: [], reads: [], confirmations: [] };
  const client = {
    hasSession: () => true,
    async request(url, method = 'GET', body) {
      if (method !== 'GET') {
        assert.equal(url, base + '/directory-commands');
        state.writes.push({ url, method, body: plain(body) });
        assert.equal(body.expectedEventVersion, state.current.event.version);
        assert.ok(['LIST', 'UNLIST'].includes(body.type));
        const previous = state.current.listing;
        const next = dto(body.type === 'LIST', false, state.current.event.version + 1);
        if (next.listing) next.listing.displayCity = body.displayCity ?? null;
        if (body.type === 'UNLIST')
          next.lastListing = {
            ...previous,
            status: 'REVOKED',
            revokedAt: '2026-10-30T00:01:00.000Z',
            revokeSource: 'UNLIST',
          };
        state.current = next;
        return { data: structuredClone(next) };
      }
      state.reads.push(url);
      if (url === base)
        return {
          data: {
            ...state.current.event,
            name: '合成旧客户端杯',
            format: 'ROUND_ROBIN',
            startDate: '2031-01-01',
            endDate: '2031-01-02',
            venueName: '合成体育馆',
            permissions: { canEditDraft: false },
          },
        };
      if (url === base + '/directory') return { data: structuredClone(state.current) };
      assert.ok(
        ['/registration', '/scoring', '/standings'].some((suffix) => url === base + suffix),
      );
      return { data: null };
    },
  };
  const api = {
    getClient: () => client,
    eventStatus: (value) => value,
    eventFormat: (value) => value,
  };
  const ui = {
    begin: () => ({}),
    live: () => true,
    hold: () => ({}),
    held: () => true,
    async confirmOp(page, title, content) {
      state.confirmations.push({ title, content });
      return { valid: () => true };
    },
    message: (error) => error.message,
  };
  const imports = {
    './api': api,
    './ui': ui,
    '../../utils/api': api,
    '../../utils/ui': ui,
    '../../utils/events': { session: async () => undefined },
    '../../utils/scoring': {},
  };
  let definition;
  const context = vm.createContext({ Page: (value) => (definition = value) });
  const execute = (name) => {
    const module = { exports: {} };
    const run = new vm.Script('(function(require,module,exports){\n' + source(name) + '\n})', {
      filename: `frozen-2d22114/${name}`,
    }).runInContext(context);
    run(
      (specifier) => {
        assert.ok(Object.hasOwn(imports, specifier), 'Unexpected legacy import: ' + specifier);
        return imports[specifier];
      },
      module,
      module.exports,
    );
    return module.exports;
  };
  const directory = execute('directory.js.txt');
  imports['../../utils/directory'] = directory;
  execute('event-setup.js.txt');
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    orgId,
    eventId,
    _alive: true,
    setData(values) {
      for (const [key, value] of Object.entries(values)) setPath(this.data, key, value);
    },
  };
  return { page, directory, state };
}

test('R05 executes unchanged, hash-pinned 2d22114 page and directory sources', () => {
  for (const name of Object.keys(fixtures)) assert.ok(source(name).length > 100);
});

test('old event-setup load reads new private DTO fields for standard and legacy listings', async () => {
  for (const standard of [true, false]) {
    const { page, state } = legacyClient(dto(true, standard));
    await page.load();
    assert.ok(state.reads.includes(base + '/directory'));
    assert.equal(page.data.error, '');
    assert.equal(page.data.directory.listed, true);
    assert.equal(page.data.directory.city, standard ? '高州市' : '高州');
    assert.equal(page.data.directory.canUnlist, true);
    assert.equal(page.data.directory.group, '即将开始');
    assert.deepEqual(plain(page._directory), state.current);
    assert.equal(state.writes.length, 0);
  }
});

test('old LIST still sends only its original fields after reading the expanded private DTO', async () => {
  for (const city of ['高州', '']) {
    const { page, state } = legacyClient(dto(false));
    await page.load();
    page.directoryCityInput({ detail: { value: city } });
    page.directoryReasonInput({ detail: { value: '合成旧客户端上架' } });
    await page.listDirectory();
    assert.deepEqual(state.writes, [
      {
        url: base + '/directory-commands',
        method: 'POST',
        body: {
          type: 'LIST',
          expectedEventVersion: 12,
          reason: '合成旧客户端上架',
          ...(city ? { displayCity: city } : {}),
        },
      },
    ]);
    assert.equal(state.confirmations.length, 1);
    assert.equal(page.data.directory.listed, true);
    assert.equal(page.data.directory.city, city);
    assert.equal(page._event.version, 13);
    assert.equal(page.data.error, '');
  }
});

test('old UNLIST can withdraw a standard-region listing and reread the expanded revoked DTO', async () => {
  const { page, state } = legacyClient();
  await page.load();
  page.directoryReasonInput({ detail: { value: '合成旧客户端撤出' } });
  await page.unlistDirectory();
  assert.deepEqual(state.writes[0].body, {
    type: 'UNLIST',
    expectedEventVersion: 12,
    reason: '合成旧客户端撤出',
  });
  assert.equal(state.writes.length, 1);
  assert.equal(page._event.version, 13);
  assert.equal(page.data.directory.listed, false);
  assert.equal(page.data.directory.lastNote, '已手动撤出目录。');
  assert.deepEqual(plain(page._directory.lastListing.region), region);
  assert.match(state.confirmations[0].content, /已分享的观赛链接仍可访问/);
  assert.equal(page.data.error, '');
});

test('old strict public parser still accepts the exact eight fields and carries its v1 cursor', async () => {
  const { directory } = legacyClient();
  const row = {
    publicEventId,
    name: '合成新地区赛事',
    startDate: '2031-01-01',
    endDate: '2031-01-02',
    venueName: '合成体育馆',
    status: 'SCHEDULED',
    purpose: 'LIVE',
    displayCity: '高州市',
  };
  const cursor = Buffer.from(
    JSON.stringify({ v: 1, s: 'UPCOMING', c: '高州市', d: '2031-01-01', k: publicEventId }),
  ).toString('base64url');
  let requested;
  const client = {
    async requestPublic(url) {
      requested = url;
      return { data: [row], meta: { nextCursor: cursor } };
    },
  };
  const result = await directory.fetchPage(client, { group: 'UPCOMING', city: '高州市', cursor });
  assert.equal(
    requested,
    '/v1/public/directory?status=UPCOMING&limit=20&city=' +
      encodeURIComponent('高州市') +
      '&cursor=' +
      cursor,
  );
  assert.equal(result.items[0].displayCity, '高州市');
  assert.equal(result.nextCursor, cursor);
  await assert.rejects(
    directory.fetchPage(
      { requestPublic: async () => ({ data: [{ ...row, region }], meta: {} }) },
      { group: 'UPCOMING' },
    ),
    /公开赛事资料格式无效/,
  );
});
