const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadComponent } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

test('workflow steps change only the visible section and reject locked or invalid destinations', () => {
  const h = loadComponent({
    root,
    route: 'components/steps/index',
    properties: {
      items: [
        { key: 'profile', label: '本人资料' },
        { key: 'review', label: '资格预审' },
        { key: 'closed', label: '未开放', disabled: true },
      ],
      current: 'profile',
    },
  });
  const emitted = [];
  h.instance.triggerEvent = (name, detail) => emitted.push({ name, detail });
  const click = (index) => h.instance.choose({ currentTarget: { dataset: { index } } });
  for (const index of [0, 2, -1, 1.5, 'invalid', 20]) click(index);
  assert.equal(emitted.length, 0);
  click(1);
  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [
    { name: 'change', detail: { key: 'review', index: 1 } },
  ]);
  h.instance.properties.busy = true;
  click(1);
  assert.equal(emitted.length, 1);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});

test('state recovery actions are explicit and cannot fire while an operation is pending', () => {
  const h = loadComponent({
    root,
    route: 'components/state/index',
    properties: { kind: 'unknown', busy: true },
  });
  const emitted = [];
  h.instance.triggerEvent = (name) => emitted.push(name);
  h.instance.action();
  h.instance.secondary();
  assert.deepEqual(emitted, []);
  h.instance.properties.busy = false;
  h.instance.action();
  h.instance.secondary();
  assert.deepEqual(emitted, ['action', 'secondary']);
  assert.equal(h.wx.calls.filter((x) => x.type === 'request').length, 0);
});

test('bottom navigation uses the actual safe area without changing finite route authorization', () => {
  const h = loadComponent({
    root,
    route: 'components/navigation/index',
    properties: { active: 'Home' },
  });
  assert.equal(h.instance.data.safeBottom, 0);
  h.wx.getWindowInfo = () => ({ screenHeight: 844, safeArea: { bottom: 810 } });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.safeBottom, 34);
  h.wx.getWindowInfo = () => ({ screenHeight: 844, safeArea: { bottom: -1000 } });
  h.definition.lifetimes.attached.call(h.instance);
  assert.equal(h.instance.data.safeBottom, 34);
  h.wx.getWindowInfo = () => ({ screenHeight: 844, safeArea: { bottom: 824 } });
  h.definition.pageLifetimes.resize.call(h.instance);
  assert.equal(h.instance.data.safeBottom, 20);
  h.instance.go({ currentTarget: { dataset: { key: 'Local' } } });
  assert.equal(h.wx.calls.find((x) => x.type === 'redirectTo').url, '/pages/local/index');
  h.instance.properties.disabled = true;
  h.instance.go({ currentTarget: { dataset: { key: 'Account' } } });
  assert.equal(h.wx.calls.filter((x) => x.type === 'redirectTo').length, 1);
});
