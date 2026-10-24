const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { parseWxml, bindingParts, eventHandlers, evaluate } = require('./helpers/wxml.cjs');
const { renderWxml, buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');

test('XML binding entities decode once before expression parsing, including quoted delimiters', () => {
  const source =
    '<view wx:if="{{a &lt; b &amp;&amp; b &gt; 0}}">{{&quot;}}&quot; + &apos;ok&apos;}}</view><view wx:else>no</view>';
  assert.doesNotThrow(() => parseWxml(source));
  const result = renderWxml(source, { a: 1, b: 2 });
  assert.match(result, />}}ok<\/div>/);
  assert.doesNotMatch(result, />no</);
  assert.match(renderWxml(source, { a: 3, b: 2 }), />no<\/div>/);
  const expression = bindingParts('{{a &#38;&#38; b}}')[0].value;
  assert.equal(evaluate(expression, { a: true, b: 'yes' }), 'yes');
  const once = renderWxml('<text>&amp;lt; {{&quot;&amp;lt;&quot;}}</text>', {});
  assert.match(once, /&amp;lt; &amp;lt;/);
  assert.doesNotMatch(once, /<text>/);
  assert.deepEqual(eventHandlers(parseWxml('<view bindtap="do&#84;hing"/>')), ['doThing']);
});

test('entity-normalized bindings still reject calls, globals, unsafe properties and malformed XML', () => {
  for (const source of [
    '<view>{{danger&#40;&#41;}}</view>',
    '<view>{{item&#46;constructor}}</view>',
    '<view>{{proce&#115;s.env}}</view>',
    '<view bindtap="doThing&#40;&#41;"/>',
    '<view wx:if="{{a &amp;&amp;}}"/>',
    '<view><text>unclosed</view>',
  ])
    assert.throws(() => eventHandlers(parseWxml(source)), source);
});

test('local named templates expand their real data maps without broadening normal binding syntax', () => {
  const source =
    '<template name="fees"><view class="fee">{{quote.total}}</view></template><template is="fees" data="{{quote: source}}"/>';
  const result = renderWxml(source, { source: { total: '¥660' } });
  assert.match(result, /class="fee">¥660<\/div>/);
  assert.equal((result.match(/¥660/g) || []).length, 1);
  for (const unsafe of [
    '<text>{{quote: source}}</text>',
    '<template is="fees" data="{{quote: call()}}"/>',
    '<template is="fees" data="{{quote: process.env}}"/>',
    '<template is="fees" data="{{constructor: source}}"/>',
  ])
    assert.throws(() => parseWxml(unsafe));
  assert.throws(
    () => renderWxml('<template name="x"><template is="x"/></template><template is="x"/>', {}),
    /Recursive local template/,
  );
});

function componentFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scb-mini-components-'));
  function write(file, value) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  write(
    'app.json',
    JSON.stringify({
      pages: ['pages/home/index'],
      window: { navigationBarTitleText: '合成组件预览' },
      usingComponents: { 'mini-menu': './components/menu/index' },
    }),
  );
  write('app.wxss', 'page { color:#123; }');
  write('pages/home/index.js', 'Page({data:{}})');
  write('pages/home/index.wxml', '<view><mini-menu active="B"/></view>');
  write('components/menu/index.json', '{"component":true}');
  write(
    'components/menu/index.js',
    "Component({properties:{active:{type:String,value:'A'}},data:{items:[{id:'A',label:'甲'},{id:'B',label:'乙'}]},methods:{choose(){}},lifetimes:{attached(){throw Error('Static preview must not attach')}}})",
  );
  write(
    'components/menu/index.wxml',
    '<button wx:for="{{items}}" wx:key="id" class="item {{active===item.id ? \'selected\' : \'\'}}" data-id="{{item.id}}" bindtap="choose">{{item.label}}</button>',
  );
  write(
    'components/menu/index.wxss',
    '.item { min-height:44px; } .item.selected { color: #132c49; }',
  );
  return { directory, write };
}

test('preview expands actual Component properties, data, WXML and scoped WXSS without lifetimes or requests', () => {
  const fixture = componentFixture();
  try {
    const result = buildPreview({ root: fixture.directory, route: 'pages/home/index' });
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].properties.active, 'B');
    assert.match(result.phone, /class="item selected" data-id="B"/);
    assert.match(result.phone, />甲<\/button>/);
    assert.match(result.phone, />乙<\/button>/);
    assert.match(result.phone, /data-mini-component-id[^}]+\.item\.selected/);
    assert.doesNotMatch(result.phone, /<script/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('component expansion rejects recursion and directory escapes instead of silently omitting components', () => {
  const fixture = componentFixture();
  try {
    fixture.write('components/menu/index.wxml', '<mini-menu/>');
    assert.throws(
      () => buildPreview({ root: fixture.directory, route: 'pages/home/index' }),
      /Recursive component/,
    );
    fixture.write(
      'app.json',
      JSON.stringify({
        pages: ['pages/home/index'],
        window: {},
        usingComponents: { 'mini-menu': '/../outside/index' },
      }),
    );
    assert.throws(
      () => buildPreview({ root: fixture.directory, route: 'pages/home/index' }),
      /escaped mini-program root/,
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('page and nested component mappings resolve relative to their actual native files', () => {
  const fixture = componentFixture();
  try {
    fixture.write(
      'pages/home/index.json',
      JSON.stringify({ usingComponents: { 'mini-menu': '../../components/alternate/index' } }),
    );
    fixture.write(
      'components/alternate/index.json',
      JSON.stringify({
        component: true,
        usingComponents: { 'mini-leaf': '../leaf/index' },
      }),
    );
    fixture.write('components/alternate/index.js', 'Component({properties:{active:String}})');
    fixture.write('components/alternate/index.wxml', '<mini-leaf label="{{active}}"/>');
    fixture.write('components/leaf/index.json', '{"component":true}');
    fixture.write('components/leaf/index.js', 'Component({properties:{label:String}})');
    fixture.write('components/leaf/index.wxml', '<text>{{label}}</text>');
    const result = buildPreview({ root: fixture.directory, route: 'pages/home/index' });
    assert.deepEqual(
      result.components.map((component) => component.path),
      ['components/alternate/index', 'components/leaf/index'],
    );
    assert.match(result.phone, /data-mini-tag="text">B<\/span>/);
    assert.doesNotMatch(result.phone, /甲|乙/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('component templates, styles and modules cannot follow symlinks outside the project', () => {
  const fixture = componentFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scb-mini-outside-'));
  try {
    for (const extension of ['wxml', 'wxss', 'js']) {
      const target = path.join(fixture.directory, 'components/menu/index.' + extension);
      const original = fs.readFileSync(target);
      const external = path.join(outside, 'external.' + extension);
      fs.writeFileSync(external, original);
      fs.rmSync(target);
      fs.symlinkSync(external, target);
      assert.throws(
        () => buildPreview({ root: fixture.directory, route: 'pages/home/index' }),
        /symlink escaped mini-program root/,
        extension,
      );
      fs.rmSync(target);
      fs.writeFileSync(target, original);
    }
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('static preview refuses components with top-level request side effects', () => {
  const fixture = componentFixture();
  try {
    fixture.write(
      'components/menu/index.js',
      "wx.request({url:'https://example.invalid'}); Component({})",
    );
    assert.throws(
      () => buildPreview({ root: fixture.directory, route: 'pages/home/index' }),
      /top-level request side effects/,
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
if (manifest.usingComponents?.['scb-nav']) {
  test('actual scb-nav reads active Account and exposes its four navigation labels', () => {
    const result = buildPreview({ root, route: 'pages/account/index' });
    const navigation = result.components.find((component) => component.tag === 'scb-nav');
    assert.equal(navigation?.properties.active, 'Account');
    for (const label of ['首页', '赛事', '视频', '我的'])
      assert.ok(result.phone.includes('>' + label + '</div>'), label);
    assert.match(result.phone, /class="nav-item selected" data-key="Account"/);
  });
}
