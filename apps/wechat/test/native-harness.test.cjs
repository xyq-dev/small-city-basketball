const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createWx, loadPage, setPath } = require('./helpers/native-page.cjs');
const { evaluate, parseWxml } = require('./helpers/wxml.cjs');
const { renderWxml, convertWxss, buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

test('setData supports nested array paths while rejecting prototype writes', () => {
  const data = {};
  setPath(data, 'rows[1].name', 'new');
  assert.equal(data.rows[1].name, 'new');
  for (const key of ['__proto__.polluted', 'rows.constructor.x', 'rows[-1].name', 'a..b'])
    assert.throws(() => setPath(data, key, true));
  assert.equal({}.polluted, undefined);
});

test('actual local Page module gets independent initial data and explicit request transport', async () => {
  const wx = createWx({
    request: () => ({ statusCode: 401, data: { error: { message: 'fixture unauthenticated' } } }),
  });
  const first = loadPage({ root, route: 'pages/home/index', wx });
  const second = loadPage({ root, route: 'pages/home/index', wx });
  first.page.setData({ value: 'private-draft' });
  assert.notEqual(second.page.data.value, 'private-draft');
  first.page.setData({ value: 'a'.repeat(43) });
  first.page.open();
  assert.equal(
    wx.calls.some(
      (call) => call.type === 'navigateTo' && call.url.includes('/pages/event/index?event='),
    ),
    true,
  );
  assert.equal(
    wx.calls.some((call) => call.type === 'request'),
    false,
  );
});

test('VM transport can hold a real page request and settle without timers or network', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const wx = createWx({ request: () => pending });
  const instance = loadPage({ root, route: 'pages/event/index', wx });
  instance.page.id = 'a'.repeat(43);
  const loading = instance.page.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wx.pendingRequests, 1);
  release({ statusCode: 404, data: { error: { code: 'NOT_FOUND', message: 'fixture revoked' } } });
  await loading;
  await instance.flush();
  assert.equal(instance.page.data.event, null);
  assert.equal(wx.pendingRequests, 0);
});

test('template renderer handles nested loops, chained conditionals and escaping without JS eval', () => {
  const source =
    '<view><block wx:for="{{groups}}" wx:for-item="group" wx:key="id"><text wx:if="{{group.allowed}}">{{group.name}}</text><text wx:else>hidden</text><text wx:for="{{group.rows}}" wx:key="id">{{item.value}}</text></block></view>';
  const html = renderWxml(source, {
    groups: [
      { id: 'g', name: '<script>bad</script>', allowed: true, rows: [{ id: 'r', value: 0 }] },
    ],
  });
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, />hidden</);
  assert.match(html, />0<\/span>/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(evaluate('missing.child || 0', {}), 0);
  assert.equal(evaluate('a + 3 * 4 === 15 ? "ok" : "bad"', { a: 3 }), 'ok');
  assert.equal(evaluate('items[key]', { items: {}, key: 'constructor' }), undefined);
  assert.doesNotThrow(() => parseWxml('<text>{{ x < 2 ? "}}" : ">" }}</text>'));
});

test('default unchecked and denied capability controls stay unselected and disabled in rendered WXML', () => {
  const source =
    '<checkbox checked="{{consent}}"/><button wx:if="{{canSubmit}}" disabled="{{!consent || busy}}">submit</button><button wx:else disabled>no access</button>';
  const unchecked = renderWxml(source, { consent: false, canSubmit: true, busy: false });
  assert.doesNotMatch(unchecked, /type="checkbox" checked/);
  assert.match(unchecked, /<button[^>]*disabled>submit/);
  const selected = renderWxml(source, { consent: true, canSubmit: true, busy: false });
  assert.match(selected, /checked/);
  assert.doesNotMatch(selected, /<button[^>]*disabled/);
  const denied = renderWxml(source, { consent: true, canSubmit: false, busy: false });
  assert.doesNotMatch(denied, />submit</);
  assert.match(denied, /disabled>no access/);
});

test('preview uses actual local template/styles, contains explicit limitation, and fetches no remote assets', () => {
  const result = buildPreview({ root, route: 'pages/home/index', width: 390, height: 844 });
  assert.match(result.html, /非微信运行时/);
  assert.match(result.html, /<iframe[^>]+sandbox/);
  // The actual app navigation brand stays part of this preview; hero copy is
  // intentionally free to follow the current approved design.
  assert.match(result.phone, /小城市篮球/);
  assert.match(result.phone, /img-src data:/);
  assert.doesNotMatch(result.phone, /<script/);
  assert.equal(
    convertWxss('page{padding:30rpx} .row view{gap:10rpx}', 375),
    'body{padding:15.0000px} .row div{gap:5.0000px}',
  );
  assert.doesNotMatch(
    renderWxml(
      '<image src="{{src}}"/>',
      { src: 'https://private.example/file' },
      { root, pageDirectory: root },
    ),
    /src="https:/,
  );
});

test('local preview assets stay byte-identical and cannot escape mini-program directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scb-mini-preview-'));
  try {
    const bytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0 0"/></svg>',
    );
    fs.writeFileSync(path.join(temp, 'icon.svg'), bytes);
    const html = renderWxml('<image src="/icon.svg"/>', {}, { root: temp, pageDirectory: temp });
    assert.ok(html.includes(bytes.toString('base64')));
    assert.throws(() =>
      renderWxml('<image src="../outside.svg"/>', {}, { root: temp, pageDirectory: temp }),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
