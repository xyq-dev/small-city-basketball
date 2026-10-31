const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('publication requires explicit independent consent and exact profile CAS', async () => {
  const wx = createWx({ modalAnswers: [true] });
  const h = loadPage({ root, route: 'pages/public-archives/index', wx }),
    sent = [];
  h.page.write = (...a) => sent.push(a);
  h.page.setData({ profiles: [{ id: id(1), version: 4 }], disclosureNotice: '独立公开用途' });
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } } });
  assert.equal(sent.length, 0);
  assert.match(h.page.data.error, /独立公开授权/);
  h.page.setData({ publicConsent: true });
  await h.page.profileCommand({ currentTarget: { dataset: { id: id(1), type: 'PUBLISH' } } });
  assert.equal(sent[0][1].expectedVersion, 4);
  assert.equal(sent[0][1].publicConsent, true);
});
test('nominating a source uses selected profile/member IDs and never a same-name match', () => {
  const h = loadPage({ root, route: 'pages/public-archives/index' }),
    sent = [];
  h.page.write = (...a) => sent.push(a);
  h.page.setData({
    publisherConsent: true,
    reason: '本届明确公开来源',
    events: [{ orgId: id(1), id: id(2) }],
    options: [{ profileId: id(3), teamId: id(4), memberId: id(5), label: '同名' }],
  });
  h.page.nominate();
  assert.equal(sent[0][1].profileId, id(3));
  assert.equal(sent[0][1].memberId, id(5));
  assert.equal('name' in sent[0][1], false);
  h.page.onSessionReset();
  assert.equal(h.page.data.profiles.length, 0);
  assert.equal(h.page.data.pendingSources.length, 0);
});
test('public sharing carries only revocable random public key and public layouts explain missing coverage', () => {
  const h = loadPage({ root, route: 'pages/public-archive/index' });
  h.page.key = 'A'.repeat(43);
  h.page.setData({
    archive: {
      publicKey: h.page.key,
      displayName: '公开昵称',
      kind: 'PLAYER',
      points: null,
      recordedMatchCount: 0,
      confirmedMatchCount: 0,
      recentRecords: [],
      technical: null,
    },
    notice: '仅有效授权确认',
  });
  const share = h.page.onShareAppMessage();
  assert.equal(share.path, '/pages/public-archive/index?key=' + h.page.key);
  assert.equal(share.path.includes('memberId'), false);
  for (const width of [320, 390, 430]) {
    const preview = buildPreview({
      root,
      route: 'pages/public-archive/index',
      data: h.page.data,
      width,
    });
    assert.match(preview.html, /专业数据保持未知/);
    assert.match(preview.html, /暂无当前有效/);
  }
});
test('private management layouts keep consent, source revoke and unknown-result retry visible', () => {
  const h = loadPage({ root, route: 'pages/public-archives/index' });
  h.page.setData({
    profiles: [
      {
        id: id(1),
        kind: 'PLAYER',
        displayName: '公开昵称',
        status: 'PUBLISHED',
        publicKey: 'A'.repeat(43),
        sources: [],
      },
    ],
    pending: { label: '发布档案' },
    disclosureNotice: '独立公开授权',
  });
  for (const width of [320, 390, 430]) {
    const preview = buildPreview({
      root,
      route: 'pages/public-archives/index',
      data: h.page.data,
      width,
    });
    assert.match(preview.html, /按原编号重试/);
    assert.match(preview.html, /旧链接失效/);
    assert.match(preview.html, /PUBLIC_ARCHIVE/);
  }
});

test('a refreshing or unavailable public read clears the previous archive and ranking immediately', async () => {
  const h = loadPage({ root, route: 'pages/public-archive/index' }),
    api = h.requireLocal('utils/api.js');
  let fail;
  api.getClient = () => ({
    sessionRevision: () => 1,
    onSessionChange: () => () => {},
    requestPublic: () =>
      new Promise((resolve, reject) => {
        fail = reject;
      }),
  });
  h.page.key = 'A'.repeat(43);
  h.page.setData({
    archive: { displayName: '已撤回的旧姓名' },
    entries: [{ key: 'old' }],
    notice: '旧数据',
  });
  const reading = h.page.load();
  assert.equal(h.page.data.archive, null);
  assert.equal(h.page.data.entries.length, 0);
  fail({ status: 503, code: 'PUBLIC_ARCHIVE_BUSY', message: '公开授权正在更新，请重新读取' });
  await reading;
  assert.equal(h.page.data.archive, null);
  assert.equal(h.page.data.entries.length, 0);
  assert.match(h.page.data.error, /授权正在更新/);
});
