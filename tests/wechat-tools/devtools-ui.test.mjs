import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import {
  prepare,
  capture,
  ROOT,
  windowsLaunchSpec,
  spawnWindowsCli,
} from '../../scripts/wechat-devtools-ui.mjs';

const require = createRequire(import.meta.url);
const { loadPage } = require('../../apps/wechat/test/helpers/native-page.cjs');
const { parseWxml } = require('../../apps/wechat/test/helpers/wxml.cjs');

function hasClassSelector(route, selector) {
  if (!/^\.[a-z-]+$/.test(selector)) return false;
  const tree = parseWxml(fs.readFileSync(path.join(ROOT, 'apps/wechat', route + '.wxml'), 'utf8'));
  function find(node) {
    const classes = String(node.attributes?.class || '').split(/\s+/);
    return classes.includes(selector.slice(1)) || (node.children || []).some(find);
  }
  return find(tree);
}
const runs = [];
afterEach(() => {
  for (const run of runs.splice(0)) fs.rmSync(run, { recursive: true, force: true });
});
function prepared() {
  const out = path.join(ROOT, 'artifacts/wechat-ui/test-' + randomUUID());
  runs.push(out);
  return prepare({ out });
}
const png = () => fs.readFileSync(path.join(ROOT, 'docs/design/C11/home.png'));
function captureFake(run, options) {
  return capture(run, {
    ...options,
    launchProject: (launchOptions) => options.sdk.launch(launchOptions),
  });
}

function fakeSdk(
  run,
  { badRoute = false, badMarker = false, invalidPng = false, exception = false } = {},
) {
  const mini = new EventEmitter();
  let index = -1;
  mini.disconnected = 0;
  mini.scrolls = [];
  mini.pageScrollTo = async (scrollTop) => {
    mini.scrolls.push([run.plan.scenarios[index].name, scrollTop]);
  };
  mini.currentPage = async () => ({
    data: async () => ({ runId: run.plan.runId, businessDisabled: true }),
  });
  mini.systemInfo = async () => ({
    windowWidth: 390,
    windowHeight: 844,
    SDKVersion: 'test-only',
    secret: 'never-copy',
  });
  mini.reLaunch = async (url) => {
    index++;
    const s = run.plan.scenarios[index];
    return {
      path: badRoute ? 'pages/account/index' : url.slice(1),
      data: async () => ({
        sourceHead: badMarker ? 'another-source' : run.plan.sourceHead,
        runId: run.plan.runId,
        scenario: s.name,
        businessDisabled: true,
      }),
      waitFor: async () => {},
      $: async (selector) =>
        hasClassSelector(s.baseRoute, selector) ? { text: async () => s.probe } : null,
    };
  };
  mini.screenshot = async ({ path: filename }) => {
    fs.writeFileSync(filename, invalidPng ? 'not an image' : png());
    if (exception) mini.emit('exception', { message: 'Synthetic AppService failure' });
  };
  mini.disconnect = async () => {
    mini.disconnected++;
  };
  return {
    mini,
    sdk: {
      launch: async (options) => {
        assert.equal(options.projectPath, run.project);
        assert.equal(options.trustProject, true);
        return mini;
      },
    },
  };
}

test('prepare preserves all source templates/assets and never mutates the runtime project', () => {
  const run = prepared();
  const catalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tests/mini-program/platform-catalog.json'), 'utf8'),
  );
  assert.equal(run.plan.scenarios.filter((s) => s.reference).length, 6);
  assert.equal(run.plan.scenarios.length, 6 + catalog.scenarios.length);
  assert.equal(run.plan.nativeScreenshotsCaptured, false);
  assert.equal(run.plan.businessFlowVerified, false);
  for (const scenario of run.plan.scenarios)
    assert.equal(hasClassSelector(scenario.baseRoute, scenario.selector), true, scenario.route);
  assert.equal(
    run.plan.scenarios.find((s) => s.route === 'pages/home/index').selector,
    '.premium-home',
  );
  assert.equal(
    run.plan.scenarios.find((s) => s.route === 'pages/player/index').selector,
    '.profile-hero',
  );
  for (const item of run.plan.sourceSnapshots) {
    const original = fs.readFileSync(path.join(ROOT, 'apps/wechat', item.path));
    assert.equal(createHash('sha256').update(original).digest('hex'), item.sha256);
    if (
      !/pages\/.*\.js$/.test(item.path) &&
      !['project.config.json', 'app.js', 'app.json', 'utils/api.js'].includes(item.path)
    )
      assert.deepEqual(fs.readFileSync(path.join(run.project, item.path)), original);
  }
  // Alias pages only add synthetic states; their templates/styles are the real source bytes.
  const copiedApp = JSON.parse(fs.readFileSync(path.join(run.project, 'app.json'), 'utf8'));
  for (const alias of run.plan.aliasPages) {
    assert.ok(copiedApp.pages.includes(alias.route), alias.route);
    for (const extension of ['.wxml', '.wxss'])
      assert.deepEqual(
        fs.readFileSync(path.join(run.project, alias.route + extension)),
        fs.readFileSync(path.join(ROOT, 'apps/wechat', alias.baseRoute + extension)),
        alias.route + extension,
      );
    const page = loadPage({ root: run.project, route: alias.route });
    assert.equal(page.page.data.__scbUiAcceptance.baseRoute, alias.baseRoute);
    assert.equal(page.page.data.__scbUiAcceptance.synthetic, true);
  }
  assert.equal(fs.existsSync(path.join(run.project, 'test')), false);
  assert.equal(fs.existsSync(path.join(run.project, 'project.private.config.json')), false);
  const home = loadPage({ root: run.project, route: 'pages/home/index' });
  assert.equal(home.page.data.positions.length, 5);
  assert.equal(home.page.data.__scbUiAcceptance.businessDisabled, true);
  assert.match(
    fs.readFileSync(path.join(run.project, 'utils/api.js'), 'utf8'),
    /const API_ORIGIN = 'https:\/\/scb-ui-fixture.invalid'/,
  );
});

test('all disposable page lifecycles and handlers are inert, including auth and writes', async () => {
  const run = prepared();
  const app = JSON.parse(fs.readFileSync(path.join(run.project, 'app.json'), 'utf8'));
  for (const route of app.pages) {
    const page = loadPage({ root: run.project, route });
    for (const value of Object.values(page.definition))
      if (typeof value === 'function') await value.call(page.page);
    await page.flush();
    assert.deepEqual(page.wx.calls, [], route);
  }
  assert.equal(
    fs
      .readFileSync(path.join(ROOT, 'apps/wechat/utils/api.js'), 'utf8')
      .includes("const API_ORIGIN = 'https://basketball.playhubs.cn'"),
    true,
  );
});

test('outputs cannot replace source files, escape the ignored directory or overwrite a run', () => {
  const run = prepared();
  assert.throws(() => prepare({ out: run.destination }), /输出必须/);
  assert.throws(() => prepare({ out: path.join(ROOT, 'apps/wechat/new-copy') }), /输出必须/);
  assert.throws(
    () => prepare({ out: path.join(ROOT, 'artifacts/wechat-ui/nested/new-copy') }),
    /输出必须/,
  );
  assert.throws(() => prepare({ appId: 'not-an-app-id' }), /AppID格式/);
});

test('successful SDK fixture capture records every original PNG hash without claiming business/device/signoff', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run);
  const report = await captureFake(run, { sdk, cliPath: 'test-cli' });
  assert.equal(report.nativeScreenshotsCaptured, true);
  assert.equal(report.screenshots.length, run.plan.scenarios.length);
  assert.deepEqual(
    mini.scrolls,
    run.plan.scenarios.filter((s) => s.scrollTop).map((s) => [s.name, s.scrollTop]),
  );
  assert.ok(mini.scrolls.some(([name]) => name === 'platform-home-extension'));
  assert.equal(report.businessFlowVerified, false);
  assert.equal(report.realDeviceVerified, false);
  assert.equal(report.userVisualAccepted, false);
  assert.equal(report.simulator.secret, undefined);
  assert.equal(mini.disconnected, 1);
  for (const shot of report.screenshots) {
    assert.equal(
      shot.sha256,
      createHash('sha256')
        .update(fs.readFileSync(path.join(run.destination, shot.path)))
        .digest('hex'),
    );
    assert.equal(shot.width, 390);
    assert.equal(shot.height, 844);
  }
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(run.destination, 'report.json'), 'utf8'))
      .nativeScreenshotsCaptured,
    true,
  );
  assert.match(
    fs.readFileSync(path.join(run.destination, 'index.html'), 'utf8'),
    /业务流程、真机、用户签收仍待/,
  );
});

test('unexpected route fails before capturing and disconnects', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run, { badRoute: true });
  const report = await captureFake(run, { sdk });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.match(report.error, /路由不符/);
  assert.equal(report.screenshots.length, 0);
  assert.equal(mini.disconnected, 1);
});

test('a selector absent from the real WXML cannot pass the capture check', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run);
  run.plan.scenarios[0].selector = '.premium-page';
  assert.equal(hasClassSelector('pages/home/index', '.premium-page'), false);
  const report = await captureFake(run, { sdk });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.match(report.error, /缺少预期原生页面内容/);
  assert.equal(report.screenshots.length, 0);
  assert.equal(mini.disconnected, 1);
});

test('source-marker mismatch cannot be accepted as this run', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run, { badMarker: true });
  const report = await captureFake(run, { sdk });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.match(report.error, /不是本轮隔离验收副本/);
  assert.equal(mini.disconnected, 1);
});

test('invalid screenshot and AppService exceptions remain failures', async () => {
  for (const flags of [{ invalidPng: true }, { exception: true }]) {
    const run = prepared(),
      { sdk, mini } = fakeSdk(run, flags);
    const report = await captureFake(run, { sdk });
    assert.equal(report.nativeScreenshotsCaptured, false);
    assert.ok(report.error);
    assert.equal(mini.disconnected, 1);
    if (flags.exception) assert.equal(report.exceptions.length, run.plan.scenarios.length);
  }
});

test('launch timeout writes an incomplete report instead of reporting success', async () => {
  const run = prepared();
  const report = await captureFake(run, {
    sdk: { launch: () => new Promise(() => {}) },
    timeout: 10,
  });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.match(report.error, /超时/);
  assert.equal(fs.existsSync(path.join(run.destination, 'report.json')), true);
});

test('disconnect errors are visible and do not produce a successful collection result', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run);
  mini.disconnect = async () => {
    throw new Error('synthetic disconnect failure');
  };
  const report = await captureFake(run, { sdk });
  assert.equal(report.disconnectError, true);
  assert.equal(report.nativeScreenshotsCaptured, false);
});

test('late AppService errors during disconnect cannot be reported as success', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run);
  mini.disconnect = async () => {
    mini.emit('exception', { message: 'late synthetic error' });
  };
  const report = await captureFake(run, { sdk });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.equal(report.exceptions.length, 1);
  assert.match(report.error, /AppService/);
});

test('a different run with the same source commit is rejected before any navigation', async () => {
  const run = prepared(),
    { sdk, mini } = fakeSdk(run);
  mini.currentPage = async () => ({
    data: async () => ({ runId: 'another-run', businessDisabled: true }),
  });
  mini.reLaunch = async () => {
    throw new Error('must never navigate');
  };
  const report = await captureFake(run, { sdk });
  assert.equal(report.nativeScreenshotsCaptured, false);
  assert.match(report.error, /未执行任何页面导航/);
  assert.equal(mini.disconnected, 1);
});

test('Windows startup invokes PowerShell with discrete arguments and rejects batch control characters', () => {
  const spec = windowsLaunchSpec(
    'C:\\Program Files (x86)\\微信开发工具\\cli.bat',
    'C:\\work space\\project',
    9420,
  );
  assert.match(spec.command, /powershell\.exe$/);
  assert.equal(spec.args.includes('-Command'), false);
  assert.equal(
    spec.args[spec.args.indexOf('-CliPath') + 1],
    'C:\\Program Files (x86)\\微信开发工具\\cli.bat',
  );
  assert.equal(spec.args[spec.args.indexOf('-ProjectPath') + 1], 'C:\\work space\\project');
  for (const bad of ['C:\\work&whoami', 'C:\\%PATH%', 'C:\\a"b', 'C:\\a\nb'])
    assert.throws(() => windowsLaunchSpec('C:\\cli.bat', bad, 9420), /控制字符/);
});

test(
  'Windows batch bridge passes native CLI arguments intact under Node 22',
  { skip: process.platform !== 'win32' },
  async () => {
    const run = prepared();
    const directory = path.join(run.destination, 'batch path with spaces');
    fs.mkdirSync(directory);
    const batch = path.join(directory, 'cli.bat');
    fs.writeFileSync(
      batch,
      '@echo off\r\nif not "%~1"=="auto" exit /b 41\r\nif not "%~2"=="--project" exit /b 42\r\nif not "%~3"=="' +
        run.project +
        '" exit /b 43\r\nif not "%~4"=="--auto-port" exit /b 44\r\nif not "%~5"=="9420" exit /b 45\r\nif not "%~6"=="--trust-project" exit /b 46\r\nexit /b 0\r\n',
    );
    const child = spawnWindowsCli(batch, run.project, 9420);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0);
  },
);
