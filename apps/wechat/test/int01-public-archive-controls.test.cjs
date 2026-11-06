const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/public-archives/index';
const id = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const profiles = [
  {
    id: id(1),
    kind: 'PLAYER',
    displayName: '合成本人球员档案',
    version: 4,
    orgId: null,
    teamId: null,
    status: 'PUBLISHED',
    publicKey: 'A'.repeat(43),
    sources: [
      {
        id: id(11),
        profileId: id(1),
        eventName: '合成本届来源',
        teamName: '合成青锋',
        memberName: '合成球员',
        status: 'PENDING',
        version: 6,
        canConsent: true,
        canRevoke: true,
        currentlyEffective: false,
      },
    ],
  },
  {
    id: id(2),
    kind: 'TEAM',
    displayName: '合成第二支公开球队',
    version: 7,
    orgId: id(22),
    teamId: id(23),
    status: 'PUBLISHED',
    publicKey: 'B'.repeat(43),
    sources: [
      {
        id: id(12),
        profileId: id(2),
        eventName: '合成球队来源',
        teamName: '合成第二队',
        memberName: null,
        status: 'CONSENTED',
        version: 8,
        canConsent: false,
        canRevoke: true,
        currentlyEffective: true,
      },
    ],
  },
  {
    id: id(3),
    kind: 'TEAM',
    displayName: '合成第三支草稿球队',
    version: 9,
    orgId: id(22),
    teamId: id(24),
    status: 'DRAFT',
    publicKey: null,
    sources: [],
  },
];

function harness({ confirmed = true } = {}) {
  const writes = [];
  let h;
  const client = {
    hasSession: () => true,
    viewerId: () => id(99),
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      if (url === '/v1/auth/session' && method === 'GET')
        return {
          data: {
            user: { id: id(99), displayName: '合成本人' },
            organizations: [],
            teamContexts: [],
          },
        };
      if (url === '/v1/me/public-archives' && method === 'GET')
        return {
          data: {
            profiles: structuredClone(h.page.data.profiles),
            pendingSources: [],
            manageableTeams: [],
            manageableEvents: [],
          },
        };
      writes.push({ url, method, body: structuredClone(body) });
      return { data: {} };
    },
  };
  h = loadPage({ root, route, wx: createWx({ modalAnswers: [confirmed] }) });
  h.requireLocal('utils/api.js').getClient = () => client;
  h.page.onLoad();
  h.page._viewer = id(99);
  const realLoad = h.page.load.bind(h.page);
  h.page.load = async () => {};
  h.page.setData({
    profiles: structuredClone(profiles),
    primaryProfile: structuredClone(profiles[0]),
    secondaryProfiles: structuredClone(profiles.slice(1)),
    pendingSources: [],
    loading: false,
    busy: false,
    loginRequired: false,
    publicConsent: false,
    disclosureNotice: '合成独立公开用途说明',
  });
  return { ...h, writes, realLoad };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
function giveConsent(h, targetId = id(3), value = ['yes']) {
  const profile = h.page.data.profiles.find((p) => p.id === targetId);
  h.page.consent({
    currentTarget: {
      dataset: { field: 'publicConsent', id: targetId, version: String(profile.version) },
    },
    detail: { value },
  });
}
function twoDrafts() {
  const h = harness();
  const drafts = structuredClone(profiles.slice(0, 2)).map((p) => ({
    ...p,
    status: 'DRAFT',
    publicKey: null,
  }));
  h.page.setData({
    profiles: drafts,
    primaryProfile: drafts[0],
    secondaryProfiles: drafts.slice(1),
  });
  return h;
}
function button(html, handler, target, type) {
  return (html.match(/<button\b[^>]*>/g) || []).find(
    (tag) =>
      tag.includes('data-mini-bindtap="' + handler + '"') &&
      tag.includes('data-id="' + target + '"') &&
      (!type || tag.includes('data-type="' + type + '"')),
  );
}
async function tap(h, tag) {
  assert.ok(tag, 'The eligible resource must have a real template control');
  assert.doesNotMatch(tag, /\sdisabled(?:\s|>)/);
  const handler = tag.match(/data-mini-bindtap="([^"]+)"/)[1];
  const dataset = Object.fromEntries(
    [...tag.matchAll(/\sdata-(id|type)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
  await h.page[handler]({ currentTarget: { dataset } });
  await h.flush();
}

test('real published profile DTOs have revocation controls at all three widths without an invented profile capability', () => {
  const h = harness();
  for (const p of h.page.data.profiles) assert.equal(Object.hasOwn(p, 'canRevoke'), false);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.ok(button(html, 'profileCommand', id(1), 'REVOKE'));
    assert.ok(button(html, 'profileCommand', id(2), 'REVOKE'));
    assert.ok(button(html, 'editProfile', id(2)));
    assert.ok(button(html, 'editProfile', id(3)));
    assert.ok(button(html, 'sourceCommand', id(12), 'REVOKE'));
    assert.equal(button(html, 'sourceCommand', id(12), 'CONSENT'), undefined);
  }
});

test('a secondary profile edit uses the selected ID and version through the existing request', async () => {
  const h = harness();
  await tap(h, button(render(h.page), 'editProfile', id(2)));
  assert.equal(h.page.data.profileEdit.id, id(2));
  h.page.editName({ detail: { value: '合成第二队新公开名称' } });
  const save = (render(h.page).match(/<button\b[^>]*>/g) || []).find((t) =>
    t.includes('data-mini-bindtap="saveProfile"'),
  );
  await tap(h, save);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/v1/me/public-archives/' + id(2) + '/commands');
  assert.equal(h.writes[0].body.expectedVersion, 7);
  assert.equal(h.writes[0].body.type, 'UPDATE');
  assert.equal(h.writes[0].body.displayName, '合成第二队新公开名称');
});

test('a secondary draft exposes its own consent and can publish only after explicit consent', async () => {
  const h = harness();
  const html = render(h.page);
  assert.match(html, /本人明确同意公开此档案/);
  assert.match(button(html, 'profileCommand', id(3), 'PUBLISH'), /\sdisabled(?:\s|>)/);
  const consent = (html.match(/<[^>]*data-mini-bindchange="consent"[^>]*>/g) || []).find((t) =>
    t.includes('data-field="publicConsent"'),
  );
  assert.ok(consent);
  h.page.consent({
    currentTarget: { dataset: { field: 'publicConsent', id: id(3), version: '9' } },
    detail: { value: ['yes'] },
  });
  await tap(h, button(render(h.page), 'profileCommand', id(3), 'PUBLISH'));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/v1/me/public-archives/' + id(3) + '/commands');
  assert.equal(h.writes[0].body.expectedVersion, 9);
  assert.equal(h.writes[0].body.publicConsent, true);
});

for (const n of [1, 2]) {
  test(`published profile ${n} can revoke its own exact version through the rendered control`, async () => {
    const h = harness();
    await tap(h, button(render(h.page), 'profileCommand', id(n), 'REVOKE'));
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].url, '/v1/me/public-archives/' + id(n) + '/commands');
    assert.equal(h.writes[0].body.expectedVersion, n === 1 ? 4 : 7);
    assert.equal(h.writes[0].body.type, 'REVOKE');
  });
}

test('secondary source revocation preserves its individual capability and exact source version', async () => {
  const h = harness();
  await tap(h, button(render(h.page), 'sourceCommand', id(12), 'REVOKE'));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].url, '/v1/public-archive-sources/' + id(12) + '/commands');
  assert.equal(h.writes[0].body.expectedVersion, 8);
  assert.equal(h.writes[0].body.type, 'REVOKE');
});

for (const blocked of ['busy', 'pending']) {
  test(`${blocked} disables primary and secondary profile and source mutations`, async () => {
    const h = harness();
    h.page.setData({
      publicConsent: true,
      [blocked]: blocked === 'busy' ? true : { label: '原请求' },
    });
    const html = render(h.page);
    for (const [handler, target, type] of [
      ['editProfile', id(1)],
      ['editProfile', id(2)],
      ['profileCommand', id(1), 'REVOKE'],
      ['profileCommand', id(2), 'REVOKE'],
      ['profileCommand', id(3), 'PUBLISH'],
      ['sourceCommand', id(12), 'REVOKE'],
    ]) {
      assert.match(button(html, handler, target, type), /\sdisabled(?:\s|>)/);
    }
    await h.page.profileCommand({ currentTarget: { dataset: { id: id(2), type: 'REVOKE' } } });
    await h.flush();
    assert.equal(h.writes.length, 0);
  });
}

test('declined confirmation sends no secondary archive mutation', async () => {
  const h = harness({ confirmed: false });
  await tap(h, button(render(h.page), 'profileCommand', id(2), 'REVOKE'));
  assert.equal(h.writes.length, 0);
});

test('public and publisher consent support explicit yes arrays and legacy booleans, with unknown values closed', () => {
  const h = harness();
  for (const field of ['publicConsent', 'publisherConsent']) {
    for (const [value, expected] of [
      [['yes'], true],
      [[], false],
      [true, true],
      [false, false],
      [['other'], false],
      ['false', false],
      [{}, false],
      [null, false],
      [undefined, false],
    ]) {
      h.page.consent({
        currentTarget: {
          dataset: { field, ...(field === 'publicConsent' ? { id: id(3), version: '9' } : {}) },
        },
        detail: { value },
      });
      assert.equal(h.page.data[field], expected, field + ': ' + JSON.stringify(value));
    }
  }
});

test('unchecking the rendered archive consent clears authorization and prevents a publish request', async () => {
  const h = harness();
  h.page.consent({
    currentTarget: { dataset: { field: 'publicConsent', id: id(3), version: '9' } },
    detail: { value: ['yes'] },
  });
  assert.doesNotMatch(
    button(render(h.page), 'profileCommand', id(3), 'PUBLISH'),
    /\sdisabled(?:\s|>)/,
  );
  giveConsent(h, id(3), []);
  assert.equal(h.page.data.publicConsent, false);
  assert.match(button(render(h.page), 'profileCommand', id(3), 'PUBLISH'), /\sdisabled(?:\s|>)/);
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(3), type: 'PUBLISH' } } });
  await h.flush();
  assert.equal(h.writes.length, 0);
  assert.match(h.page.data.error, /独立公开授权/);
});

test('secondary sources without individual capabilities expose no source command', () => {
  const h = harness();
  h.page.data.profiles[1].sources[0].canRevoke = false;
  h.page.data.secondaryProfiles[0].sources[0].canRevoke = false;
  const html = render(h.page);
  assert.equal(button(html, 'sourceCommand', id(12), 'REVOKE'), undefined);
  assert.equal(button(html, 'sourceCommand', id(12), 'CONSENT'), undefined);
});

test('CI multi-profile fixture preserves real DTO capabilities and the visible controls in all widths', () => {
  const fixture = require('../../../tests/mini-program/fixtures/int01-public-archive-multiple.json');
  assert.equal(fixture.data.profiles.length, 4);
  for (const p of fixture.data.profiles) assert.equal(Object.hasOwn(p, 'canRevoke'), false);
  for (const width of [320, 390, 430]) {
    const html = buildPreview({ root, route, data: fixture.data, width }).phone;
    assert.ok(button(html, 'profileCommand', id(1), 'REVOKE'));
    assert.ok(button(html, 'profileCommand', id(2), 'REVOKE'));
    assert.ok(button(html, 'profileCommand', id(3), 'PUBLISH'));
    assert.doesNotMatch(button(html, 'profileCommand', id(3), 'PUBLISH'), /\bdisabled\b/);
    assert.match(button(html, 'profileCommand', id(4), 'PUBLISH'), /\bdisabled\b/);
    assert.ok(button(html, 'sourceCommand', id(12), 'REVOKE'));
  }
});

test('consenting to draft A neither checks nor authorizes draft B', async () => {
  const h = twoDrafts();
  giveConsent(h, id(1));
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    assert.doesNotMatch(button(html, 'profileCommand', id(1), 'PUBLISH'), /\bdisabled\b/);
    assert.match(button(html, 'profileCommand', id(2), 'PUBLISH'), /\bdisabled\b/);
    const groups = html.match(/<[^>]*data-mini-bindchange="consent"[^>]*>/g) || [];
    assert.ok(
      groups.some(
        (tag) => tag.includes('data-id="' + id(1) + '"') && tag.includes('data-version="4"'),
      ),
    );
    assert.ok(
      groups.some(
        (tag) => tag.includes('data-id="' + id(2) + '"') && tag.includes('data-version="7"'),
      ),
    );
  }
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(2), type: 'PUBLISH' } } });
  assert.equal(h.writes.length, 0);
  assert.equal(
    h.wx.calls.some((c) => c.type === 'showModal'),
    false,
  );
});

test('a directly assigned global boolean never substitutes for a target-bound consent gesture', async () => {
  const h = twoDrafts();
  h.page.setData({ publicConsent: true });
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } } });
  assert.equal(h.writes.length, 0);
});

for (const target of [1, 2]) {
  test(`draft ${target} publishes normally after its own consent and confirms the actual target`, async () => {
    const h = twoDrafts();
    giveConsent(h, id(target), target === 1 ? ['yes'] : true);
    await tap(h, button(render(h.page), 'profileCommand', id(target), 'PUBLISH'));
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].url, '/v1/me/public-archives/' + id(target) + '/commands');
    assert.equal(h.writes[0].body.expectedVersion, target === 1 ? 4 : 7);
    assert.equal(h.writes[0].body.publicConsent, true);
    const modal = h.wx.calls.find((c) => c.type === 'showModal');
    assert.ok(modal.content.includes(profiles[target - 1].displayName));
    assert.ok(modal.content.includes(target === 1 ? '本人球员档案' : '本人有权管理的球队档案'));
    assert.ok(modal.content.includes('合成独立公开用途说明'));
    assert.equal(h.page.data.publicConsent, false);
    assert.equal(h.page.data.publicConsentProfileId, '');
  });
}

test('unchecking draft A clears its binding without authorizing any other draft', () => {
  const h = twoDrafts();
  giveConsent(h, id(1));
  giveConsent(h, id(1), []);
  assert.equal(h.page.data.publicConsentProfileId, '');
  assert.equal(h.page.data.publicConsentProfileVersion, null);
  for (const target of [1, 2])
    assert.match(button(render(h.page), 'profileCommand', id(target), 'PUBLISH'), /\bdisabled\b/);
});

test('a changed target version cannot reuse the previous explicit consent', async () => {
  const h = twoDrafts();
  giveConsent(h, id(1));
  h.page.setData({ 'profiles[0].version': 5, 'primaryProfile.version': 5 });
  assert.match(button(render(h.page), 'profileCommand', id(1), 'PUBLISH'), /\bdisabled\b/);
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } } });
  assert.equal(h.writes.length, 0);
  assert.equal(h.page.data.publicConsent, false);
});

test('reloading or resetting the identity clears every target-bound consent', async () => {
  const h = twoDrafts();
  giveConsent(h, id(1));
  await h.realLoad();
  assert.equal(h.page.data.publicConsent, false);
  assert.equal(h.page.data.publicConsentProfileId, '');
  giveConsent(h, id(2));
  h.page.onSessionReset();
  assert.equal(h.page.data.publicConsent, false);
  assert.equal(h.page.data.publicConsentProfileVersion, null);
});

for (const change of ['uncheck', 'version']) {
  test(`a ${change} while target confirmation waits prevents publication`, async () => {
    const h = twoDrafts();
    let modal;
    h.wx.showModal = (options) => {
      modal = options;
    };
    giveConsent(h, id(1));
    const publishing = h.page.profileCommand({
      currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } },
    });
    assert.ok(modal);
    if (change === 'uncheck') giveConsent(h, id(1), []);
    else h.page.setData({ 'profiles[0].version': 5, 'primaryProfile.version': 5 });
    modal.success({ confirm: true });
    await publishing;
    await h.flush();
    assert.equal(h.writes.length, 0);
    assert.equal(h.page._pending, undefined);
  });
}

for (const change of ['consent', 'version']) {
  test(`a changed ${change} while UUID generation waits cannot register or send the publish request`, async () => {
    const h = twoDrafts();
    let resolveUuid;
    h.requireLocal('utils/ui.js').uuid = () =>
      new Promise((resolve) => {
        resolveUuid = resolve;
      });
    giveConsent(h, id(1));
    const publishing = h.page.profileCommand({
      currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } },
    });
    for (let i = 0; i < 10 && !resolveUuid; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(resolveUuid);
    if (change === 'consent') giveConsent(h, id(1), []);
    else h.page.setData({ 'profiles[0].version': 5, 'primaryProfile.version': 5 });
    resolveUuid(id(88));
    await publishing;
    assert.equal(h.writes.length, 0);
    assert.equal(h.page._pending, undefined);
    assert.equal(h.page.data.busy, false);
  });
}

test('withdrawing and re-granting the same target cannot revive an older confirmation', async () => {
  const h = twoDrafts();
  let modal;
  h.wx.showModal = (options) => {
    modal = options;
  };
  giveConsent(h, id(1));
  const publishing = h.page.profileCommand({
    currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } },
  });
  giveConsent(h, id(1), []);
  giveConsent(h, id(1));
  modal.success({ confirm: true });
  await publishing;
  assert.equal(h.writes.length, 0);
});
