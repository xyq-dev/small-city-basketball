const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const gate = require('../utils/figma-preview');

function runtime(version, options = {}) {
  const value = {
    getStorageSync() {
      return options.cachedVersion || '';
    },
  };
  if (options.missing !== true) {
    value.getAccountInfoSync = () => {
      if (options.throws) throw new Error('account info unavailable');
      return options.account || { miniProgram: { envVersion: version } };
    };
  }
  return value;
}

function pageWx(version, options = {}) {
  const value = createWx({ storage: new Map([['envVersion', 'develop']]) });
  const trusted = runtime(version, options);
  if (trusted.getAccountInfoSync) value.getAccountInfoSync = trusted.getAccountInfoSync;
  return value;
}

function previewPage(route, version, query, options = {}) {
  const wx = pageWx(version, options);
  const harness = loadPage({ root, route, wx });
  harness.page.onLoad(query);
  return { ...harness, wx };
}

test('Figma preview gate accepts only an explicit request in the trusted develop environment', () => {
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('develop')), true);
  assert.equal(gate.enabled({}, runtime('develop')), false);
  assert.equal(gate.enabled({ uiPreview: 'other' }, runtime('develop')), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('trial')), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('release')), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('unknown')), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('', { missing: true })), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('', { account: {} })), false);
  assert.equal(gate.enabled({ uiPreview: 'figma' }, runtime('', { throws: true })), false);
});

test('query fields and cached values cannot forge the trusted mini program environment', () => {
  const query = { uiPreview: 'figma', envVersion: 'develop', environment: 'develop' };
  assert.equal(gate.enabled(query, runtime('release', { cachedVersion: 'develop' })), false);
  assert.equal(gate.environment(runtime('release', { cachedVersion: 'develop' })), 'release');
});

test('home and account apply the same fail-closed environment matrix', () => {
  const cases = [
    ['develop', {}, true],
    ['trial', {}, false],
    ['release', {}, false],
    ['unknown', {}, false],
    ['', { missing: true }, false],
    ['', { throws: true }, false],
  ];
  for (const [version, options, expected] of cases) {
    const query = { uiPreview: 'figma', state: 'unknown', envVersion: 'develop' };
    const home = previewPage('pages/home/index', version, query, options);
    const account = previewPage('pages/account/index', version, query, options);
    assert.equal(home.page.data.uiPreview, expected, `home: ${version || 'missing'}`);
    assert.equal(account.page.data.uiPreview, expected, `account: ${version || 'missing'}`);
  }
  assert.equal(previewPage('pages/home/index', 'develop', {}).page.data.uiPreview, false);
  assert.equal(previewPage('pages/account/index', 'develop', {}).page.data.uiPreview, false);
});

test('develop preview uses synthetic presentation without requests, storage writes or actions', async () => {
  const home = previewPage('pages/home/index', 'develop', { uiPreview: 'figma' });
  home.page.onShow();
  assert.equal(home.page.data.citySelection.source, 'Figma UI 预览');
  assert.equal(home.page.data.publicEvents[0].publicEventId, 'figma-ui-preview');
  home.page.openPublicEvent({ currentTarget: { dataset: { id: 'figma-ui-preview' } } });

  const account = previewPage('pages/account/index', 'develop', {
    uiPreview: 'figma',
    state: 'unknown',
  });
  account.page.onShow();
  let invoked = false;
  await account.page.task(async () => {
    invoked = true;
  });
  account.page.retryWechat();
  assert.equal(account.page.data.wechatState, 'unknown');
  assert.equal(invoked, false);

  for (const harness of [home, account]) {
    assert.equal(
      harness.wx.calls.some((call) => call.type === 'request'),
      false,
    );
    assert.equal(
      harness.wx.calls.some((call) => call.type === 'setStorageSync'),
      false,
    );
    assert.equal(
      harness.wx.calls.some((call) => call.type === 'removeStorageSync'),
      false,
    );
    assert.equal(
      harness.wx.calls.some((call) =>
        ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab'].includes(call.type),
      ),
      false,
    );
  }
});

test('develop without preview and non-develop with preview retain normal data loading', async () => {
  for (const [version, query] of [
    ['develop', {}],
    ['trial', { uiPreview: 'figma' }],
    ['release', { uiPreview: 'figma' }],
  ]) {
    let directoryReads = 0;
    const client = { hasSession: () => false };
    const modules = {
      [path.join(root, 'utils/api.js')]: { getClient: () => client },
      [path.join(root, 'utils/directory.js')]: {
        fetchPage: async () => {
          directoryReads++;
          return { items: [] };
        },
        failure: () => '读取失败',
      },
      [path.join(root, 'utils/city-preference.js')]: {
        snapshot: () => ({
          mode: 'NATIONWIDE',
          label: '全国',
          source: '全国浏览',
          guide: true,
          warning: '',
        }),
        query: () => ({}),
      },
    };
    const home = loadPage({ root, route: 'pages/home/index', wx: pageWx(version), modules });
    home.page.onLoad(query);
    home.page.onShow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(home.page.data.uiPreview, false);
    assert.equal(home.page.data.citySelection.source, '全国浏览');
    assert.equal(
      home.page.data.publicEvents.some((item) => item.publicEventId === 'figma-ui-preview'),
      false,
    );
    assert.equal(directoryReads, 1);
  }

  const calls = [];
  const client = {
    hasSession: () => false,
    onSessionChange: () => () => {},
    request: async (url) => {
      calls.push(url);
      return {
        data: url.includes('/wechat/') ? { enabled: false } : { canRegisterParticipant: false },
      };
    },
  };
  const account = loadPage({
    root,
    route: 'pages/account/index',
    wx: pageWx('release'),
    modules: { [path.join(root, 'utils/api.js')]: { getClient: () => client } },
  });
  account.page.onLoad({ uiPreview: 'figma', state: 'unknown' });
  account.page.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(account.page.data.uiPreview, false);
  assert.deepEqual(calls, ['/v1/auth/wechat/capabilities', '/v1/auth/capabilities']);
});

test('runtime pages cannot bypass the centralized preview gate', () => {
  const pageRoot = path.join(root, 'pages');
  const pageScripts = fs
    .readdirSync(pageRoot, { recursive: true })
    .filter((file) => typeof file === 'string' && file.endsWith('.js'))
    .map((file) => path.join(pageRoot, file));
  for (const file of pageScripts) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /query\.uiPreview\s*===|query\[['"]uiPreview['"]\]/, file);
  }
  for (const page of ['home', 'account']) {
    const source = fs.readFileSync(path.join(pageRoot, page, 'index.js'), 'utf8');
    assert.match(source, /require\('\.\.\/\.\.\/utils\/figma-preview'\)/, page);
    assert.match(source, /figmaPreview\.enabled\(query, wx\)/, page);
  }
});
