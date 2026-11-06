const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const route = 'pages/participant-materials/index';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(4),
  org = id(1),
  entry = id(2),
  member = id(3);
const base = '/v1/orgs/' + org + '/entries/' + entry + '/participant-materials';
const copy = (value) => JSON.parse(JSON.stringify(value));
const workspace = () => ({
  entryId: entry,
  memberId: member,
  eventName: '合成本人报名杯',
  teamName: '合成青锋',
  startDate: '2028-05-01',
  endDate: '2028-05-03',
  rules: { requireInsurance: true, termsVersion: 'registration-materials-v1' },
  enabled: true,
  frozen: false,
  material: null,
  capabilities: { canSave: true, canSubmit: false, canWithdrawPublicity: false },
});
function setup({ canSave = true } = {}) {
  const calls = [];
  let current = workspace(),
    chosen = 0;
  current.capabilities.canSave = canSave;
  current.frozen = !canSave;
  const client = {
    viewerId: () => actor,
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    async request(url, method = 'GET', body) {
      calls.push({ url, method, body: copy(body || {}) });
      if (url.startsWith('/v1/insurance'))
        throw Object.assign(Error('在线投保尚未开放'), { status: 403 });
      if (url === '/v1/auth/session')
        return { data: { user: { id: actor }, organizations: [], teamContexts: [] } };
      assert.equal(url, base + '/mine');
      if (method === 'PUT') {
        assert.equal(canSave, true);
        current = {
          ...current,
          material: {
            id: id(6),
            memberId: member,
            memberName: '合成本人',
            status: 'DRAFT',
            version: 1,
            realName: body.realName,
            identityMasked: null,
            portrait: null,
            acceptedTerms: body.acceptedTerms,
            publicityConsent: body.publicityConsent,
            reviewReason: null,
            blockers: [],
            capabilities: { canReadPrivate: true, canReview: false },
            insurance: {
              insurer: body.insurance.insurer || null,
              policyNumberMasked: '***0001',
              startDate: body.insurance.startDate || null,
              endDate: body.insurance.endDate || null,
              document: {
                fileName: body.insurance.document.fileName,
                contentType: 'application/pdf',
                byteLength: 3,
                sha256: 'a'.repeat(64),
              },
            },
          },
        };
      } else assert.equal(method, 'GET');
      return { data: copy(current) };
    },
  };
  const api = { ...require('../utils/api'), getClient: () => client };
  const wx = createWx({ modalAnswers: [true] });
  wx.chooseMessageFile = (options) => {
    chosen++;
    options.success({
      tempFiles: [{ path: '/synthetic-policy.pdf', name: 'synthetic-policy.pdf', size: 3 }],
    });
  };
  wx.getFileSystemManager = () => ({ readFile: (options) => options.success({ data: 'YWJj' }) });
  const h = loadPage({ root, route, wx, modules: { [path.join(root, 'utils/api.js')]: api } });
  h.page.onLoad({ orgId: org, entryId: entry });
  return { ...h, calls, chosen: () => chosen };
}
const render = (page, width = 390) => buildPreview({ root, route, data: page.data, width }).phone;
const entryButton = (html) => html.match(/<button\b[^>]*data-panel="insurance"[^>]*>/)?.[0];
const uploadButton = (html) => html.match(/<button\b[^>]*data-kind="insurance"[^>]*>/)?.[0];
function openFromControl(h) {
  const button = entryButton(render(h.page));
  assert.ok(button, 'default material navigation must expose the existing external-policy panel');
  const handler = button.match(/data-mini-bindtap="([^"]+)"/)[1];
  h.page[handler]({
    currentTarget: { dataset: { panel: button.match(/data-panel="([^"]+)"/)[1] } },
  });
  return button;
}

test('the default material panel reaches existing policy fields and private upload at every width', async () => {
  const h = setup();
  await h.page.load();
  assert.equal(h.page.data.materialPanel, 'profile');
  for (const width of [320, 390, 430]) assert.ok(entryButton(render(h.page, width)));
  openFromControl(h);
  assert.equal(h.page.data.materialPanel, 'insurance');
  const html = render(h.page);
  for (const field of ['insurer', 'policyNumber', 'startDate', 'endDate'])
    assert.match(html, new RegExp('data-field="' + field + '"'));
  assert.ok(uploadButton(html));
  assert.match(html, /上传不等于已投保、保障有效或审核通过/);
});

test('external policy upload uses private materials while online insurance purchase remains unavailable', async () => {
  const h = setup();
  await h.page.load();
  openFromControl(h);
  for (const [field, value] of Object.entries({
    insurer: '合成外部保障机构',
    policyNumber: 'SYNTHETIC-EXTERNAL-0001',
    startDate: '2028-05-01',
    endDate: '2028-05-03',
  }))
    h.page.field({ currentTarget: { dataset: { field } }, detail: { value } });
  const button = uploadButton(render(h.page));
  await h.page.upload({
    currentTarget: { dataset: { kind: button.match(/data-kind="([^"]+)"/)[1] } },
  });
  const writes = h.calls.filter((call) => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PUT');
  assert.equal(writes[0].url, base + '/mine');
  assert.equal(writes[0].body.insurance.insurer, '合成外部保障机构');
  assert.equal(writes[0].body.insurance.document.contentType, 'application/pdf');
  assert.equal(
    h.calls.some((call) => call.url.startsWith('/v1/insurance')),
    false,
  );
  assert.equal(h.chosen(), 1);
  assert.ok(
    h.wx.calls.some(
      (call) => call.type === 'showModal' && call.content.includes('不会要求你重复购买保险'),
    ),
  );
});

test('read-only materials may view the panel without editing fields, choosing files or writing', async () => {
  const h = setup({ canSave: false });
  await h.page.load();
  openFromControl(h);
  const html = render(h.page);
  for (const input of html.match(
    /<input\b[^>]*data-field="(?:insurer|policyNumber|startDate|endDate)"[^>]*>/g,
  ) || [])
    assert.match(input, /\sdisabled(?:\s|>)/);
  assert.match(uploadButton(html), /\sdisabled(?:\s|>)/);
  h.page.field({ currentTarget: { dataset: { field: 'insurer' } }, detail: { value: '不得写入' } });
  await h.page.upload({ currentTarget: { dataset: { kind: 'insurance' } } });
  assert.equal(h.page.data.form.insurer, '');
  assert.equal(h.chosen(), 0);
  assert.equal(h.calls.filter((call) => call.method !== 'GET').length, 0);
});

test('busy, loading and unknown material requests keep the restored navigation closed', async () => {
  for (const flag of ['busy', 'loading', 'pending']) {
    const h = setup();
    await h.page.load();
    h.page.setData({ [flag]: true });
    const button = openFromControl(h);
    assert.match(button, /\sdisabled(?:\s|>)/);
    assert.equal(h.page.data.materialPanel, 'profile');
    assert.equal(h.chosen(), 0);
    assert.equal(h.calls.filter((call) => call.method !== 'GET').length, 0);
  }
});

test('an already open policy panel retains busy and unknown upload protections', async () => {
  for (const flag of ['busy', 'pending']) {
    const h = setup();
    await h.page.load();
    openFromControl(h);
    h.page.setData({ [flag]: true });
    const html = render(h.page);
    assert.match(uploadButton(html), /\sdisabled(?:\s|>)/);
    h.page.field({
      currentTarget: { dataset: { field: 'insurer' } },
      detail: { value: '不得绕过原请求' },
    });
    await h.page.upload({ currentTarget: { dataset: { kind: 'insurance' } } });
    assert.equal(h.page.data.form.insurer, '');
    assert.equal(h.chosen(), 0);
    assert.equal(h.calls.filter((call) => call.method !== 'GET').length, 0);
  }
});

test('the default-profile CI fixture reaches the actual external-policy form through its visible entry', async () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../tests/mini-program/fixtures/int01-external-policy-panel.json',
      ),
      'utf8',
    ),
  );
  assert.equal(fixture.data.materialPanel, 'profile');
  const h = setup();
  await h.page.load();
  h.page.setData(fixture.data);
  for (const width of [320, 390, 430]) {
    const html = render(h.page, width);
    for (const text of fixture.expectText) assert.ok(html.includes(text), text);
    assert.ok(entryButton(html));
    assert.doesNotMatch(html, /data-field="policyNumber"/);
  }
  openFromControl(h);
  assert.equal(h.page.data.materialPanel, 'insurance');
  assert.match(render(h.page), /data-field="policyNumber"/);
  assert.ok(uploadButton(render(h.page)));
});
