const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');

const root = path.resolve(__dirname, '..');
const route = 'pages/guardian/index';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = id(1),
  org = id(2),
  event = id(3),
  request = id(4);
const privateValue = {
  realName: '合成监护人私密姓名',
  identityNumber: 'SYNTHETIC_PRIVATE_ID',
  relationship: 'PARENT',
  relationshipExplanation: '合成本人关系证明',
  proof: { fileName: 'synthetic.png', contentType: 'image/png', byteLength: 8 },
};
function setup({ canReadProof = true, answers = [true], deferPrivate } = {}) {
  const calls = [];
  const current = {
    id: request,
    orgId: org,
    eventId: event,
    entryId: id(5),
    memberId: id(6),
    eventName: '合成青年杯',
    subjectName: '合成孩子',
    guardianName: '合成监护人',
    status: 'AWAITING_REVIEW',
    version: 2,
    role: 'GUARDIAN',
    current: true,
    reviewReason: null,
    blockers: [],
    subjectPurposes: ['PARTICIPATION'],
    guardianPurposes: [],
    capabilities: { canConfirm: false, canReview: false, canWithdraw: true, canReadProof },
  };
  const client = {
    viewerId: () => user,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET') {
      calls.push({ url, method });
      assert.equal(method, 'GET', 'Proof preview must not mutate a relationship');
      if (url === '/v1/auth/session')
        return { data: { user: { id: user }, organizations: [], teamContexts: [] } };
      if (url.startsWith('/v1/me/youth-guardians'))
        return {
          data: { requests: [current], preconsents: [], adultDataScopes: [], nextCursor: null },
        };
      if (url === `/v1/youth-guardian-requests/${request}`) return { data: current };
      if (url === `/v1/youth-guardian-requests/${request}/private`)
        return { data: deferPrivate ? await deferPrivate() : privateValue };
      throw new Error('Unexpected synthetic API request: ' + url);
    },
  };
  const h = loadPage({
    root,
    route,
    wx: createWx({ modalAnswers: answers }),
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
  });
  h.page.onLoad();
  return { ...h, calls, current };
}
const render = (h) => buildPreview({ root, route, data: h.page.data }).phone;
const revealButton = (h) => render(h).match(/<button\b([^>]*)>明确查看本人监护证明<\/button>/)?.[1];
async function select(h) {
  await h.page.load();
  h.page.changeView({ detail: { key: 'guardian' } });
  await h.page.select({ currentTarget: { dataset: { id: request } } });
}

test('a guardian can explicitly reveal their own proof without reviewer permission, then conceal it', async () => {
  const h = setup();
  await select(h);
  assert.equal(h.page.data.selected.capabilities.canReview, false);
  assert.match(revealButton(h) || '', /data-mini-bindtap="reveal"/);
  assert.doesNotMatch(render(h), /SYNTHETIC_PRIVATE_ID|data-mini-bindtap="viewProof"/);
  const handler = revealButton(h).match(/data-mini-bindtap="([^"]+)"/)[1];
  await h.page[handler]();
  assert.equal(h.calls.filter((call) => call.url.endsWith('/private')).length, 1);
  assert.match(render(h), /SYNTHETIC_PRIVATE_ID/);
  assert.match(render(h), /data-mini-bindtap="viewProof"/);
  assert.match(render(h), /data-mini-bindtap="conceal"/);
  h.page.conceal();
  assert.equal(h.page.data.privateDetails, null);
  assert.doesNotMatch(render(h), /SYNTHETIC_PRIVATE_ID|data-mini-bindtap="viewProof"/);
});

test('no proof capability and a declined explicit confirmation never read private data', async () => {
  for (const options of [{ canReadProof: false }, { answers: [false] }]) {
    const h = setup(options);
    await select(h);
    if (options.canReadProof === false) assert.equal(revealButton(h), undefined);
    await h.page.reveal();
    assert.equal(
      h.calls.some((call) => call.url.endsWith('/private')),
      false,
    );
    assert.doesNotMatch(render(h), /SYNTHETIC_PRIVATE_ID/);
  }
});

test('busy and unknown-result protection disable the restored preview entry', async () => {
  for (const key of ['busy', 'pending']) {
    const h = setup();
    await select(h);
    h.page.setData({ [key]: true });
    assert.match(revealButton(h), /\bdisabled\b/, key);
    await h.page.reveal();
    assert.equal(
      h.calls.some((call) => call.url.endsWith('/private')),
      false,
    );
  }
});

test('a private read returning after page hide cannot restore protected details', async () => {
  let resolve;
  const response = new Promise((done) => {
    resolve = done;
  });
  const h = setup({ deferPrivate: () => response });
  await select(h);
  const pending = h.page.reveal();
  for (let i = 0; i < 20 && !h.calls.some((call) => call.url.endsWith('/private')); i++)
    await new Promise((done) => setImmediate(done));
  assert.equal(
    h.calls.some((call) => call.url.endsWith('/private')),
    true,
  );
  h.page.onHide();
  resolve(privateValue);
  await pending;
  assert.equal(h.page.data.privateDetails, null);
  assert.doesNotMatch(render(h), /SYNTHETIC_PRIVATE_ID/);
});
