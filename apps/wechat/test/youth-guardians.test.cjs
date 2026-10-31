const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const { renderWxml } = require('./helpers/native-preview.cjs');
const fs = require('node:fs');
const youth = require('../utils/youth-guardians');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const user = id(1),
  org = id(2),
  event = id(3),
  entry = id(4),
  member = id(5),
  request = id(6);
const tap = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const ticks = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
const row = (patch = {}) => ({
  id: request,
  orgId: org,
  eventId: event,
  entryId: entry,
  memberId: member,
  eventName: '合成青年杯',
  subjectName: '合成孩子',
  guardianName: '合成监护人',
  status: 'AWAITING_GUARDIAN',
  version: 1,
  role: 'GUARDIAN',
  current: true,
  reviewReason: null,
  blockers: [],
  subjectPurposes: ['PARTICIPATION'],
  guardianPurposes: [],
  capabilities: { canConfirm: true, canReview: false, canWithdraw: true, canReadProof: false },
  ...patch,
});
const adultScope = (patch = {}) => ({
  orgId: org,
  eventId: event,
  eventName: '合成成年本人资料',
  entryId: entry,
  memberId: member,
  expectedMaterialVersion: 4,
  expectedAdultVersion: 0,
  policyVersion: 1,
  evidenceQualificationId: id(14),
  termsVersion: 'youth-adult-data-processing-v1',
  canConsent: true,
  canWithdraw: false,
  lastDecision: null,
  blocker: '',
  ...patch,
});
function setup({
  review = false,
  current = row(),
  custom,
  storage = new Map(),
  answers = [true, true],
  adultScopes = [],
} = {}) {
  const wx = createWx({ storage, modalAnswers: answers }),
    calls = [];
  let viewer = user,
    revision = 0,
    listener;
  const client = {
    viewerId: () => viewer,
    sessionRevision: () => revision,
    onSessionChange: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    request: async (p, method = 'GET', body) => {
      calls.push({ p, method, body });
      if (custom) {
        const d = await custom(p, method, body);
        if (d !== undefined) return { data: d };
      }
      if (p === '/v1/auth/session')
        return { data: { user: { id: viewer }, organizations: [], teamContexts: [] } };
      if (p.startsWith('/v1/me/youth-guardian-commands/')) return { data: { found: false } };
      if (p.includes('/youth-policy'))
        return {
          data: {
            event: { name: '合成青年杯' },
            policy: {
              enabled: true,
              version: 1,
              guardianAgeThreshold: 18,
              termsVersion: 'youth-participation-v1',
            },
            capabilities: { canConfigure: review, canInviteData: !review },
          },
        };
      if (p.startsWith('/v1/me/youth-guardians'))
        return {
          data: {
            requests: [current],
            preconsents: [],
            adultDataScopes: adultScopes,
            nextCursor: null,
          },
        };
      if (p.includes('/youth-adult-data-consent') && method === 'GET') {
        const url = new URL('https://synthetic.invalid' + p);
        const match = adultScopes.find(
          (s) =>
            s.entryId === url.searchParams.get('entryId') &&
            s.memberId === url.searchParams.get('memberId'),
        );
        if (match) return { data: match };
      }
      if (p.startsWith('/v1/orgs/') && p.includes('/youth-guardian-requests'))
        return { data: { requests: [current], nextCursor: null } };
      if (p === '/v1/youth-guardian-requests/' + request) return { data: current };
      throw Object.assign(new Error('explicit synthetic rejection'), { status: 422 });
    },
  };
  const h = loadPage({
    root,
    route: 'pages/' + (review ? 'youth-review' : 'guardian') + '/index',
    wx,
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client, uuid: (v) => v } },
  });
  h.page.onLoad({ orgId: org, eventId: event, entryId: entry, memberId: member });
  return {
    ...h,
    calls,
    client,
    changeAccount(next) {
      viewer = next;
      revision++;
      listener?.();
    },
  };
}
test('normal DTO whitelist drops protected extras and each public purpose stays unselected', async () => {
  const h = setup({
    current: row({ identityNumber: 'synthetic-private', payload: { base64: 'private-bytes' } }),
  });
  await h.page.load();
  await h.page.select(tap({ id: request }));
  assert.equal(h.page.data.form.publicityConsent, false);
  assert.equal(h.page.data.form.archiveConsent, false);
  assert.equal(h.page.data.form.liveConsent, false);
  assert.equal(JSON.stringify(h.page.data).includes('synthetic-private'), false);
  assert.equal(JSON.stringify(h.page.data).includes('private-bytes'), false);
  h.page.setData({
    'form.identityNumber': 'synthetic-input',
    privateDetails: { identityNumber: 'synthetic-reveal' },
  });
  h.page.onHide();
  assert.equal(h.page.data.form.identityNumber, '');
  assert.equal(h.page.data.privateDetails, null);
  assert.deepEqual(h.page.data.requests, []);
});
test('hiding during secure request id generation cannot send a consent mutation', async () => {
  const h = setup();
  await h.page.load();
  h.page.setData({
    'form.subjectAlias': '合成别名',
    'form.guardianUserId': id(8),
    'form.declaredYouth': true,
  });
  let random;
  h.wx.getRandomValues = (o) => {
    random = o;
  };
  const pending = h.page.invite();
  await ticks();
  assert.ok(random);
  h.page.onHide();
  random.success({ randomValues: new Uint8Array(16).buffer });
  await pending;
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.equal(h.wx.storage.size, 0);
});
test('unknown guardian confirmation preserves only per-account command IDs and blocks duplicate sends', async () => {
  let sent = 0;
  const h = setup({
    custom: (p, method) => {
      if (method === 'POST' && p.endsWith('/confirm')) {
        sent++;
        throw new Error('synthetic transport interrupted');
      }
    },
  });
  await h.page.load();
  await h.page.select(tap({ id: request }));
  h.wx.getFileSystemManager = () => ({ readFile: (o) => o.success({ data: 'YWJj' }) });
  h.page._chosen = {
    path: '/synthetic-proof',
    name: 'synthetic.pdf',
    contentType: 'application/pdf',
    size: 3,
  };
  h.page.setData({
    proofName: 'synthetic.pdf',
    'form.realName': '合成监护人',
    'form.identityNumber': 'SYNTHETIC_SECRET',
    'form.relationshipExplanation': '合成关系说明',
    'form.acceptedTerms': true,
  });
  await h.page.confirmGuardian();
  assert.equal(sent, 1);
  assert.equal(h.page.data.pending, true);
  assert.equal(h.page.data.form.identityNumber, '');
  const stored = [...h.wx.storage.values()];
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['clientRequestId', 'userId']);
  assert.equal(JSON.stringify(stored).includes('SYNTHETIC_SECRET'), false);
  assert.equal(JSON.stringify(stored).includes('YWJj'), false);
  await h.page.confirmGuardian();
  assert.equal(sent, 1);
  const before = JSON.stringify(stored);
  h.changeAccount(id(9));
  assert.equal(h.page.data.privateDetails, null);
  assert.equal(h.page.data.selected, null);
  assert.equal(JSON.stringify([...h.wx.storage.values()]), before);
});
test('account change during a private read discards the late private result', async () => {
  let resolve;
  const h = setup({
    current: row({
      capabilities: { canConfirm: false, canReview: false, canWithdraw: true, canReadProof: true },
    }),
    custom: (p) =>
      p.endsWith('/private')
        ? new Promise((r) => {
            resolve = r;
          })
        : undefined,
  });
  await h.page.load();
  await h.page.select(tap({ id: request }));
  const read = h.page.reveal();
  await ticks();
  assert.ok(resolve);
  h.changeAccount(id(10));
  resolve({
    realName: '合成',
    identityNumber: 'PRIVATE_LATE',
    relationship: 'PARENT',
    relationshipExplanation: '合成关系',
    proof: { fileName: 'synthetic.pdf', contentType: 'application/pdf', byteLength: 3 },
  });
  await read;
  assert.equal(h.page.data.privateDetails, null);
  assert.equal(JSON.stringify(h.page.data).includes('PRIVATE_LATE'), false);
});
test('pending command protection remains separate for two accounts', () => {
  const wx = createWx(),
    a = { userId: user, clientRequestId: id(11) },
    b = { userId: id(12), clientRequestId: id(13) };
  assert.equal(youth.writePending(wx, a), true);
  assert.equal(youth.writePending(wx, b), true);
  assert.deepEqual(youth.readPending(wx, user), a);
  assert.deepEqual(youth.readPending(wx, id(12)), b);
  assert.equal(youth.clearPending(wx, b), true);
  assert.deepEqual(youth.readPending(wx, user), a);
});
test('actual guardian and reviewer templates render capability-limited controls with optional checks clear', async () => {
  for (const review of [false, true]) {
    const h = setup({
      review,
      current: row({
        role: review ? 'REVIEWER' : 'GUARDIAN',
        status: 'AWAITING_REVIEW',
        capabilities: {
          canConfirm: false,
          canReview: review,
          canWithdraw: !review,
          canReadProof: review,
        },
      }),
    });
    await h.page.load();
    await h.page.select(tap({ id: request }));
    const directory = path.join(root, 'pages', review ? 'youth-review' : 'guardian');
    const components = JSON.parse(
      fs.readFileSync(path.join(root, 'app.json'), 'utf8'),
    ).usingComponents;
    const html = renderWxml(
      fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8'),
      h.page.data,
      { root, pageDirectory: directory, usingComponents: components, globalComponents: components },
    );
    assert.ok(html.includes('独立'));
    assert.equal(h.page.data.identityChecked, false);
    assert.equal(h.page.data.relationshipChecked, false);
  }
});

test('adult processing capabilities expose only minimal scope and keep explicit self consent unselected', async () => {
  const h = setup({
    adultScopes: [
      adultScope({
        birthDate: 'SYNTHETIC_PRIVATE_BIRTH',
        identityNumber: 'SYNTHETIC_PRIVATE_ID',
        payload: { base64: 'SYNTHETIC_PRIVATE_BYTES' },
      }),
    ],
  });
  await h.page.load();
  assert.equal(h.page.data.form.adultAcceptedDataProcessing, false);
  assert.equal(h.page.data.adultDataScopes.length, 1);
  const selected = h.page.data.adultDataScopes[0];
  await h.page.adultSelect(tap({ key: selected.key }));
  assert.equal(h.page.data.adultSelected.entryId, entry);
  assert.equal(h.page.data.form.adultAcceptedDataProcessing, false);
  for (const secret of [
    'SYNTHETIC_PRIVATE_BIRTH',
    'SYNTHETIC_PRIVATE_ID',
    'SYNTHETIC_PRIVATE_BYTES',
  ])
    assert.equal(JSON.stringify(h.page.data).includes(secret), false);
  await h.page.adultDataCommand(tap({ decision: 'CONSENT' }));
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.match(h.page.data.error, /明确同意/);
});

test('a client age declaration cannot turn a blocked adult capability into permission', async () => {
  const h = setup({
    adultScopes: [adultScope()],
    custom: (p, method) =>
      p.includes('/youth-adult-data-consent') && method === 'GET'
        ? adultScope({
            canConsent: false,
            evidenceQualificationId: null,
            blocker: '合成独立身份复核待完成',
          })
        : undefined,
  });
  await h.page.load();
  await h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  h.page.field(tap({ field: 'age' }, '18'));
  h.page.field(tap({ field: 'birthDate' }, '2000-01-01'));
  h.page.checkbox(tap({ field: 'adultAcceptedDataProcessing' }, ['yes']));
  await h.page.adultDataCommand(tap({ decision: 'CONSENT' }));
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.equal(Object.hasOwn(h.page.data.form, 'age'), false);
  assert.equal(Object.hasOwn(h.page.data.form, 'birthDate'), false);
});

test('adult self consent posts the exact current material, policy and independent evidence without reopening public purposes', async () => {
  const h = setup({
    adultScopes: [adultScope()],
    custom: (p, method) =>
      p.includes('/youth-adult-data-consent') && method === 'GET'
        ? adultScope({
            expectedMaterialVersion: 5,
            expectedAdultVersion: 1,
            policyVersion: 2,
            evidenceQualificationId: id(15),
          })
        : method === 'POST' && p.endsWith('/youth-adult-data-consent')
          ? { adultConsentId: id(20), version: 2, decision: 'CONSENT' }
          : undefined,
  });
  await h.page.load();
  await h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  h.page.checkbox(tap({ field: 'adultAcceptedDataProcessing' }, ['yes']));
  await h.page.adultDataCommand(tap({ decision: 'CONSENT' }));
  const posted = h.calls.filter((c) => c.method === 'POST');
  assert.equal(posted.length, 1);
  const { clientRequestId, ...body } = posted[0].body;
  assert.match(clientRequestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(body, {
    entryId: entry,
    memberId: member,
    expectedAdultVersion: 1,
    decision: 'CONSENT',
    expectedMaterialVersion: 5,
    expectedPolicyVersion: 2,
    evidenceQualificationId: id(15),
    acceptedDataProcessing: true,
    termsVersion: 'youth-adult-data-processing-v1',
  });
  assert.equal(h.page.data.form.adultAcceptedDataProcessing, false);
  assert.equal(h.page.data.form.publicityConsent, false);
  assert.equal(h.page.data.form.archiveConsent, false);
  assert.equal(h.page.data.form.liveConsent, false);
  assert.equal(h.wx.storage.size, 0);
});

test('adult withdrawal needs no age evidence, key or consent checkbox and unknown outcomes preserve IDs only', async () => {
  let sent = 0;
  const h = setup({
    adultScopes: [
      adultScope({
        canConsent: false,
        canWithdraw: true,
        lastDecision: 'CONSENT',
        expectedAdultVersion: 3,
        evidenceQualificationId: null,
        blocker: '合成私有证明暂不可读',
      }),
    ],
    custom: (p, method) => {
      if (method === 'POST' && p.endsWith('/youth-adult-data-consent')) {
        sent++;
        throw new Error('synthetic unknown adult withdrawal');
      }
    },
  });
  await h.page.load();
  await h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  assert.equal(h.page.data.form.adultAcceptedDataProcessing, false);
  await h.page.adultDataCommand(tap({ decision: 'WITHDRAW' }));
  assert.equal(sent, 1);
  const posted = h.calls.find((c) => c.method === 'POST');
  const { clientRequestId, ...body } = posted.body;
  assert.deepEqual(body, {
    entryId: entry,
    memberId: member,
    expectedAdultVersion: 3,
    decision: 'WITHDRAW',
  });
  assert.equal(h.page.data.pending, true);
  const stored = [...h.wx.storage.values()];
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(stored[0]).sort(), ['clientRequestId', 'userId']);
  assert.equal(stored[0].clientRequestId, clientRequestId);
  await h.page.adultDataCommand(tap({ decision: 'WITHDRAW' }));
  assert.equal(sent, 1);
});

test('an account change while an adult command waits for a secure ID prevents the write and clears its capability', async () => {
  const h = setup({ adultScopes: [adultScope()] });
  await h.page.load();
  await h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  h.page.checkbox(tap({ field: 'adultAcceptedDataProcessing' }, ['yes']));
  let random;
  h.wx.getRandomValues = (o) => {
    random = o;
  };
  const pending = h.page.adultDataCommand(tap({ decision: 'CONSENT' }));
  await ticks();
  assert.ok(random);
  h.changeAccount(id(21));
  random.success({ randomValues: new Uint8Array(16).buffer });
  await pending;
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
  assert.equal(h.wx.storage.size, 0);
  assert.equal(h.page.data.adultSelected, null);
  assert.deepEqual(h.page.data.adultDataScopes, []);
  assert.equal(h.page.data.form.adultAcceptedDataProcessing, false);
});

test('a late adult capability read after account change cannot restore the previous actor scope', async () => {
  let resolve;
  const h = setup({
    adultScopes: [adultScope()],
    custom: (p, method) =>
      p.includes('/youth-adult-data-consent') && method === 'GET'
        ? new Promise((r) => {
            resolve = r;
          })
        : undefined,
  });
  await h.page.load();
  const pending = h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  await ticks();
  assert.ok(resolve);
  h.changeAccount(id(22));
  resolve(adultScope());
  await pending;
  assert.equal(h.page.data.adultSelected, null);
  assert.deepEqual(h.page.data.adultDataScopes, []);
});

test('an adult capability response for another entry is rejected before any mutation', async () => {
  const h = setup({
    adultScopes: [adultScope()],
    custom: (p, method) =>
      p.includes('/youth-adult-data-consent') && method === 'GET'
        ? adultScope({ entryId: id(23) })
        : undefined,
  });
  await h.page.load();
  await h.page.adultSelect(tap({ key: h.page.data.adultDataScopes[0].key }));
  assert.equal(h.page.data.adultSelected, null);
  assert.match(h.page.data.error, /返回不完整/);
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
});

test('independent review pages never start a personal adult-processing command', async () => {
  const h = setup({ review: true, adultScopes: [adultScope()] });
  await h.page.load();
  assert.deepEqual(h.page.data.adultDataScopes, []);
  h.page._adultSelected = adultScope();
  h.page.setData({ 'form.adultAcceptedDataProcessing': true });
  await h.page.adultDataCommand(tap({ decision: 'CONSENT' }));
  assert.equal(
    h.calls.some((c) => c.method === 'POST'),
    false,
  );
});
