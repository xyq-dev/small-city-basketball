const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderWxml } = require('./helpers/native-preview.cjs');

test('native preview retains accessible status names and live announcements', () => {
  const html = renderWxml(
    '<view role="status" aria-label="{{label}}" aria-live="polite">{{text}}</view>',
    { label: '正在加载', text: '合成内容' },
  );
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="正在加载"/);
  assert.match(html, /aria-live="polite"/);
});

test('native preview escapes accessibility attributes without activating source events', () => {
  const html = renderWxml(
    '<view role="status" aria-label="{{label}}" aria-hidden="{{hidden}}" bindtap="activate"/>',
    { label: '\"><img src=x onerror=activate()>', hidden: false },
  );
  assert.match(html, /aria-label="&quot;&gt;&lt;img src=x onerror=activate\(\)&gt;"/);
  assert.match(html, /aria-hidden="false"/);
  assert.match(html, /data-mini-bindtap="activate"/);
  assert.doesNotMatch(html, /<img|\sbindtap=/);
});
