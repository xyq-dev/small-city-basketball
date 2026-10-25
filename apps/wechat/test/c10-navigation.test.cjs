const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadComponent } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

test('navigation disabled during a page write cannot redirect away from the pending operation', () => {
  const harness = loadComponent({
    root,
    route: 'components/navigation/index',
    properties: { active: 'Account', disabled: true },
  });
  harness.instance.go({ currentTarget: { dataset: { key: 'Home' } } });
  assert.equal(
    harness.wx.calls.some((call) => call.type === 'redirectTo'),
    false,
  );
});

test('unlocked navigation keeps the original finite destinations and current-tab behavior', () => {
  const harness = loadComponent({
    root,
    route: 'components/navigation/index',
    properties: { active: 'Home' },
  });
  for (const key of ['Home', 'https://example.invalid', '__proto__'])
    harness.instance.go({ currentTarget: { dataset: { key } } });
  assert.equal(
    harness.wx.calls.some((call) => call.type === 'redirectTo'),
    false,
  );
  harness.instance.go({ currentTarget: { dataset: { key: 'Events' } } });
  assert.equal(harness.wx.calls.filter((call) => call.type === 'redirectTo').length, 1);
  assert.equal(
    harness.wx.calls.find((call) => call.type === 'redirectTo').url,
    '/pages/watch/index',
  );
});
