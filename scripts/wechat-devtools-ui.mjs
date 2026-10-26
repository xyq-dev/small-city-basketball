import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { loadPage } = require('../apps/wechat/test/helpers/native-page.cjs');
const SDK_VERSION = '0.13.0';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const probes = {
  home: '按位置找球员',
  players: '林越',
  player: '林越',
  compare: '同为',
  'booking-create': '青锋杯',
  bookings: '青锋杯',
};
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function windowsLaunchSpec(cliPath, projectPath, port) {
  // PowerShell invokes a trusted batch file. Refuse cmd expansion/control chars
  // rather than interpolating a shell command. Spaces, Chinese and (x86) work.
  for (const value of [cliPath, projectPath]) {
    if (typeof value !== 'string' || !value || /[\u0000-\u001f"%!?&|<>^`]/.test(value))
      throw new Error('Windows验收路径含批处理控制字符，请使用普通项目/安装路径');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效自动化端口');
  return {
    command: path.win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    ),
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(ROOT, 'scripts/start-wechat-ui-cli.ps1'),
      '-CliPath',
      cliPath,
      '-ProjectPath',
      projectPath,
      '-AutomationPort',
      String(port),
    ],
  };
}

export function spawnWindowsCli(cliPath, projectPath, port) {
  const spec = windowsLaunchSpec(cliPath, projectPath, port);
  return spawn(spec.command, spec.args, { shell: false, stdio: 'ignore', windowsHide: true });
}

async function unusedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function launchWeChat(sdk, options) {
  if (process.platform !== 'win32') return sdk.launch(options);
  const port = await unusedLoopbackPort();
  const child = spawnWindowsCli(options.cliPath, options.projectPath, port);
  let failure;
  child.on('error', () => {
    failure = new Error('无法启动Windows PowerShell桥接');
  });
  child.on('exit', (code) => {
    if (code !== 0) failure = new Error('微信CLI启动失败；请检查登录和服务端口设置');
  });
  child.unref();
  const start = Date.now();
  try {
    while (Date.now() - start < options.timeout) {
      if (failure) throw failure;
      const ready = await new Promise((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const finish = (value) => {
          socket.destroy();
          resolve(value);
        };
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.setTimeout(500, () => finish(false));
      });
      if (ready) return await sdk.connect({ wsEndpoint: 'ws://127.0.0.1:' + port });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('等待微信自动化端口超时');
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runtimeFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((item) => {
    const name = path.join(relative, item.name);
    if (!relative && (item.name === 'test' || item.name === 'project.private.config.json'))
      return [];
    if (item.isSymbolicLink()) throw new Error('验收源码不能包含软链：' + name);
    return item.isDirectory() ? runtimeFiles(root, name) : [name];
  });
}

function writeStub(project, route, original, data) {
  const methods = Object.entries(original.definition).filter(
    ([key, value]) => key !== 'data' && typeof value === 'function',
  );
  const stub = methods.map(([key]) => JSON.stringify(key) + ': function () {}').join(',\n');
  // Only the disposable copy loses business lifecycle/handlers. Original templates,
  // styles, components and images remain byte-identical; this is UI evidence only.
  fs.writeFileSync(
    path.join(project, route + '.js'),
    '// C12 disposable UI-only fixture; business and network lifecycle disabled.\nPage({data:' +
      JSON.stringify(data) +
      (stub ? ',\n' + stub : '') +
      '});\n',
  );
}

export function prepare({ root = ROOT, out, appId } = {}) {
  const source = path.join(root, 'apps/wechat');
  const base = path.join(root, 'artifacts/wechat-ui');
  // All output stays in one ignored directory; never overwrite an existing run.
  fs.mkdirSync(path.dirname(base), { recursive: true });
  if (fs.realpathSync(path.dirname(base)) !== path.join(fs.realpathSync(root), 'artifacts'))
    throw new Error('验收输出父目录不能是软链');
  fs.mkdirSync(base, { recursive: true });
  if (fs.realpathSync(base) !== path.join(fs.realpathSync(root), 'artifacts/wechat-ui'))
    throw new Error('验收输出目录不能是软链');
  const destination = path.resolve(
    out || path.join(base, new Date().toISOString().replace(/[:.]/g, '-')),
  );
  if (path.dirname(destination) !== base || fs.existsSync(destination))
    throw new Error('输出必须是artifacts/wechat-ui下尚不存在的直接子目录');
  if (appId && !/^wx[0-9a-f]{16}$/i.test(appId))
    throw new Error('AppID格式无效；不要提供AppSecret');
  const catalog = read(path.join(root, 'tests/mini-program/visual-catalog.json'));
  const selected = catalog.pages.filter((page) => page.sourceKind === 'approved-image');
  if (selected.length !== 6) throw new Error('需要C11六页确认稿映射');
  const fixtures = new Map(
    selected.map((page) => {
      if (!/^pages\/[a-z-]+\/index$/.test(page.route) || !/^[a-z0-9-]+$/.test(page.primaryFixture))
        throw new Error('无效fixture路径');
      const filename = path.join(
        root,
        'tests/mini-program/fixtures',
        page.primaryFixture + '.json',
      );
      const fixture = read(filename);
      if (
        fixture.route !== page.route ||
        (fixture.designSource || fixture.figmaNode) !== 'approved:C11'
      )
        throw new Error('fixture来源与确认稿不一致');
      return [page.route, { page, fixture, fixtureSha256: hash(fs.readFileSync(filename)) }];
    }),
  );
  const sourceFiles = runtimeFiles(source);
  const sourceSnapshots = sourceFiles.map((file) => ({
    path: file.split(path.sep).join('/'),
    sha256: hash(fs.readFileSync(path.join(source, file))),
  }));
  const sourceHead = git(root, 'rev-parse', 'HEAD');
  const runId = randomUUID();
  const sourceDirty = git(root, 'status', '--porcelain', '--', 'apps/wechat') !== '';
  fs.mkdirSync(destination);
  const project = path.join(destination, 'project');
  fs.mkdirSync(project);
  for (const file of sourceFiles) {
    const target = path.join(project, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.writeFileSync(
    path.join(project, 'app.js'),
    '// C12 disposable UI-only fixture.\nApp({ onLaunch() {}, onShow() {} });\n',
  );
  const apiFile = path.join(project, 'utils/api.js');
  const apiSource = fs.readFileSync(apiFile, 'utf8');
  const originDeclaration = "const API_ORIGIN = 'https://basketball.playhubs.cn';";
  if (!apiSource.includes(originDeclaration))
    throw new Error('API来源配置变化，需重新审核验收隔离');
  fs.writeFileSync(
    apiFile,
    apiSource.replace(originDeclaration, "const API_ORIGIN = 'https://scb-ui-fixture.invalid';"),
  );
  const app = read(path.join(source, 'app.json'));
  for (const route of app.pages) {
    if (!/^pages\/[a-z-]+\/index$/.test(route)) throw new Error('无效页面路径');
    const original = loadPage({ root: source, route });
    const selectedFixture = fixtures.get(route);
    const data = {
      ...original.page.data,
      ...selectedFixture?.fixture.data,
      __scbUiAcceptance: {
        sourceHead,
        runId,
        route,
        scenario: selectedFixture?.fixture.name || null,
        synthetic: true,
        businessDisabled: true,
      },
    };
    writeStub(project, route, original, data);
  }
  // Platform-alignment states reuse a real route's byte-identical template, style and page
  // config under a disposable alias page, so several synthetic states can be captured.
  const platformCatalog = read(path.join(root, 'tests/mini-program/platform-catalog.json'));
  const platform = platformCatalog.scenarios.map((item) => {
    const alias = 'pages/' + item.name + '/index';
    if (
      !/^platform-[a-z-]+$/.test(item.name) ||
      !app.pages.includes(item.baseRoute) ||
      !/^\.[a-z-]+$/.test(item.selector) ||
      typeof item.probe !== 'string' ||
      !item.probe ||
      (item.scrollTop !== undefined &&
        (!Number.isSafeInteger(item.scrollTop) || item.scrollTop < 1 || item.scrollTop > 20000))
    )
      throw new Error('无效平台场景：' + item.name);
    const filename = path.join(root, 'tests/mini-program/fixtures', item.name + '.json');
    const fixture = read(filename);
    if (
      fixture.name !== item.name ||
      fixture.route !== item.baseRoute ||
      fixture.designSource !== 'synthetic:platform-alignment'
    )
      throw new Error('平台fixture来源不一致：' + item.name);
    fs.mkdirSync(path.join(project, path.dirname(alias)), { recursive: true });
    for (const extension of ['.wxml', '.wxss', '.json']) {
      const from = path.join(source, item.baseRoute + extension);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(project, alias + extension));
    }
    const original = loadPage({ root: source, route: item.baseRoute });
    writeStub(project, alias, original, {
      ...original.page.data,
      ...fixture.data,
      __scbUiAcceptance: {
        sourceHead,
        runId,
        route: alias,
        baseRoute: item.baseRoute,
        scenario: fixture.name,
        synthetic: true,
        businessDisabled: true,
      },
    });
    return {
      route: alias,
      baseRoute: item.baseRoute,
      name: fixture.name,
      title: item.title,
      probe: item.probe,
      selector: item.selector,
      ...(item.scrollTop ? { scrollTop: item.scrollTop } : {}),
      fixtureSha256: hash(fs.readFileSync(filename)),
      reference: null,
      referenceSha256: null,
    };
  });
  write(path.join(project, 'app.json'), {
    ...app,
    pages: [...app.pages, ...platform.map((s) => s.route)],
  });
  const config = read(path.join(project, 'project.config.json'));
  config.projectname = 'SCB-C12-UI-FIXTURES-ONLY';
  if (appId) config.appid = appId;
  write(path.join(project, 'project.config.json'), config);
  const approved = selected.map((page) => ({
    route: page.route,
    baseRoute: page.route,
    name: fixtures.get(page.route).fixture.name,
    title: page.title,
    probe: probes[page.route.split('/')[1]],
    // The player name renders in the hero above .premium-page, not inside it.
    selector:
      page.route === 'pages/home/index'
        ? '.premium-home'
        : page.route === 'pages/player/index'
          ? '.profile-hero'
          : '.premium-page',
    fixtureSha256: fixtures.get(page.route).fixtureSha256,
    reference: 'references/' + page.route.split('/')[1] + '.png',
    referenceSha256: hash(fs.readFileSync(path.resolve(root, page.referenceImage))),
  }));
  const scenarios = [...approved, ...platform];
  fs.mkdirSync(path.join(destination, 'references'));
  for (const page of selected) {
    const reference = path.resolve(root, page.referenceImage);
    if (!reference.startsWith(path.join(root, 'docs/design/C11') + path.sep))
      throw new Error('参考图超出C11范围');
    fs.copyFileSync(
      reference,
      path.join(destination, 'references', page.route.split('/')[1] + '.png'),
    );
  }
  const plan = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHead,
    runId,
    sourceDirty,
    sdkVersion: SDK_VERSION,
    mode: 'isolated-native-template-fixtures',
    businessLifecycle: 'replaced-in-disposable-copy',
    networkOrigin: 'https://scb-ui-fixture.invalid',
    overriddenFiles: [
      'app.js',
      'app.json',
      'project.config.json',
      'utils/api.js',
      ...app.pages.map((route) => route + '.js'),
    ],
    aliasPages: platform.map((s) => ({ route: s.route, baseRoute: s.baseRoute })),
    runnerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    businessFlowVerified: false,
    realDeviceVerified: false,
    userVisualAccepted: false,
    nativeScreenshotsCaptured: false,
    sourceSnapshots,
    scenarios,
  };
  write(path.join(destination, 'plan.json'), plan);
  return { destination, project, plan };
}

async function deadline(action, label, timeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + '超时')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function capture(
  prepared,
  { sdk, cliPath, timeout = 60000, launchProject = (options) => launchWeChat(sdk, options) } = {},
) {
  const { destination, project, plan } = prepared;
  const report = {
    ...plan,
    renderer: 'WeChat DevTools SDK native screenshot; synthetic template fixtures',
    nativeScreenshotsCaptured: false,
    screenshots: [],
    exceptions: [],
    error: null,
  };
  let mini;
  fs.mkdirSync(path.join(destination, 'screenshots'));
  try {
    mini = await deadline(
      () => launchProject({ cliPath, projectPath: project, timeout, trustProject: true }),
      '启动微信开发工具',
      timeout,
    );
    mini.on('exception', (error) =>
      report.exceptions.push(String(error?.message || 'AppService exception').slice(0, 1500)),
    );
    const initial = await deadline(
      async () => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const page = await mini.currentPage();
          if (page) return page;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new Error('等待当前原生页面超时');
      },
      '核对当前验收窗口',
      timeout,
    );
    const initialMarker =
      initial && (await deadline(() => initial.data('__scbUiAcceptance'), '核对窗口来源', timeout));
    if (initialMarker?.runId !== plan.runId || initialMarker.businessDisabled !== true)
      throw new Error('当前窗口不是本次隔离验收副本；未执行任何页面导航');
    const system = await deadline(() => mini.systemInfo(), '读取模拟器', timeout);
    report.simulator = Object.fromEntries(
      [
        'platform',
        'model',
        'SDKVersion',
        'windowWidth',
        'windowHeight',
        'pixelRatio',
        'statusBarHeight',
      ]
        .filter((key) => system[key] !== undefined)
        .map((key) => [key, system[key]]),
    );
    for (const scenario of plan.scenarios) {
      const page = await deadline(
        () => mini.reLaunch('/' + scenario.route),
        '打开' + scenario.route,
        timeout,
      );
      if (!page || page.path.replace(/^\//, '') !== scenario.route)
        throw new Error('原生页面路由不符');
      const marker = await deadline(() => page.data('__scbUiAcceptance'), '核对验收副本', timeout);
      if (
        marker?.sourceHead !== plan.sourceHead ||
        marker.runId !== plan.runId ||
        marker.scenario !== scenario.name ||
        marker.businessDisabled !== true
      )
        throw new Error('连接目标不是本轮隔离验收副本');
      await deadline(() => page.waitFor(500), '等待原生渲染', timeout);
      // Lower sections (e.g. the home booking extension) are captured by an explicit scroll.
      if (scenario.scrollTop) {
        await deadline(() => mini.pageScrollTo(scenario.scrollTop), '滚动页面', timeout);
        await deadline(() => page.waitFor(300), '等待滚动渲染', timeout);
      }
      const body = await deadline(() => page.$(scenario.selector), '检查页面根节点', timeout);
      if (
        !body ||
        !(await deadline(() => body.text(), '检查页面文字', timeout)).includes(scenario.probe)
      )
        throw new Error('缺少预期原生页面内容：' + scenario.name);
      const filename = 'screenshots/' + scenario.name + '.png';
      await deadline(
        () => mini.screenshot({ path: path.join(destination, filename) }),
        '截图' + scenario.name,
        timeout,
      );
      const bytes = fs.readFileSync(path.join(destination, filename));
      if (
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.length < 100
      )
        throw new Error('SDK未生成有效PNG');
      report.screenshots.push({
        scenario: scenario.name,
        path: filename,
        bytes: bytes.length,
        sha256: hash(bytes),
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      });
    }
    if (report.exceptions.length) throw new Error('原生AppService报告异常；请查看report.json');
    report.nativeScreenshotsCaptured = true;
  } catch (error) {
    report.error = String(error.message || error).slice(0, 2000);
  } finally {
    if (mini) {
      try {
        await deadline(() => mini.disconnect(), '断开自动化连接', Math.min(timeout, 5000));
      } catch {
        report.disconnectError = true;
        report.nativeScreenshotsCaptured = false;
      }
    }
    if (report.exceptions.length) {
      report.nativeScreenshotsCaptured = false;
      report.error ||= '原生AppService报告异常；请查看report.json';
    }
    write(path.join(destination, 'report.json'), report);
    const rows = plan.scenarios
      .map((s) => {
        const shot = report.screenshots.find((image) => image.scenario === s.name);
        return (
          '<section><h2>' +
          escape(s.title) +
          '</h2><div><figure><figcaption>用户确认稿</figcaption>' +
          (s.reference
            ? '<img src="' + s.reference + '">'
            : '<p>无用户确认稿：平台定位修正新增状态，设计待签收</p>') +
          '</figure><figure><figcaption>微信开发工具 · 合成模板（人工待验）</figcaption>' +
          (shot ? '<img src="' + shot.path + '">' : '<p>未采集</p>') +
          '</figure></div></section>'
        );
      })
      .join('');
    fs.writeFileSync(
      path.join(destination, 'index.html'),
      '<!doctype html><meta charset="utf-8"><title>C12 原生UI验收</title><style>body{font:16px sans-serif;background:#eef2f7;color:#132c49;margin:24px}section>div{display:flex;gap:24px;flex-wrap:wrap}figure{margin:0}img{width:390px;max-width:90vw}section{margin:32px 0}figcaption{margin:12px 0}</style><h1>小城市篮球 · 原生模板验收</h1><p>隔离副本、合成资料；原业务生命周期与点击已停用。仅用于原生模板/样式/素材验收，业务流程、真机、用户签收仍待。</p><p>截图采集：' +
        (report.nativeScreenshotsCaptured ? '完成（不代表视觉签收）' : '未完成') +
        '</p>' +
        rows,
    );
  }
  return report;
}

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('需要Node.js >=22.12');
  const [command, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--cli', '--app-id', '--out'].includes(args[i]) || !args[i + 1])
      throw new Error('用法：prepare|capture [--cli 路径] [--app-id wx…] [--out 新子目录]');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!['prepare', 'capture'].includes(command)) throw new Error('请使用prepare或capture');
  let sdk;
  const cliPath = options.cli || process.env.WECHAT_DEVTOOLS_CLI;
  if (command === 'capture') {
    if (!cliPath || !fs.existsSync(cliPath))
      throw new Error('找不到微信开发工具CLI；使用scripts/accept-wechat-ui.ps1或--cli指定');
    const sdkRequire = createRequire(path.join(ROOT, 'tools/wechat-ui/package.json'));
    try {
      if (sdkRequire('miniprogram-automator/package.json').version !== SDK_VERSION)
        throw new Error('版本不符');
      sdk = sdkRequire('miniprogram-automator');
    } catch {
      throw new Error('先运行 npm ci --prefix tools/wechat-ui --ignore-scripts 安装锁定的本地SDK');
    }
  }
  const prepared = prepare({ out: options.out, appId: options['app-id'] });
  console.log('验收副本：' + prepared.destination);
  if (command === 'prepare') {
    console.log('仅准备成功，尚未执行官方微信截图。');
    return;
  }
  const report = await capture(prepared, { sdk, cliPath });
  console.log('对照报告：' + path.join(prepared.destination, 'index.html'));
  if (!report.nativeScreenshotsCaptured) throw new Error(report.error || '截图采集未完成');
  console.log('六屏原生截图采集完成；人工视觉签收/真机/业务流程仍待验收。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exit(2);
  });
}
