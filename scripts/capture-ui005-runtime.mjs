import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [outputArg, endpointArg = 'ws://127.0.0.1:9420', sdkArg] = process.argv.slice(2);
if (!outputArg) {
  console.error(
    'Usage: node scripts/capture-ui005-runtime.mjs <new-output-directory> [ws-endpoint] [automator-module]',
  );
  process.exit(2);
}
const output = path.resolve(outputArg);
if (fs.existsSync(output) && fs.readdirSync(output).length)
  throw new Error(`Runtime evidence output must be new or empty: ${output}`);
fs.mkdirSync(output, { recursive: true });

const automatorPath =
  sdkArg ||
  'C:/Users/Administrator/AppData/Local/Temp/scb-mp-auto/node_modules/miniprogram-automator';
const automator = require(automatorPath);
const routes = [
  ['home', 'pages/home/index'],
  ['watch', 'pages/watch/index'],
  ['local', 'pages/local/index'],
  ['teams', 'pages/teams/index'],
  ['account', 'pages/account/index'],
  ['city-select', 'pages/city-select/index'],
  ['search', 'pages/search/index'],
  ['media', 'pages/media/index'],
  ['event-detail', 'pages/event/index'],
  ['match-detail', 'pages/match/index'],
  ['registration-events', 'pages/registration-events/index'],
  ['entry-form', 'pages/entry/index'],
  ['booking-create', 'pages/booking-create/index'],
  ['booking-detail', 'pages/booking-detail/index'],
  ['participant-materials', 'pages/participant-materials/index'],
  ['qualification-precheck', 'pages/qualification-precheck/index'],
  ['scorer', 'pages/scorer/index'],
  ['org-event', 'pages/org-event/index'],
];

const pngInfo = (filename) => {
  const bytes = fs.readFileSync(filename);
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Automation did not create a valid PNG');
  return { bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};
const report = {
  createdAt: new Date().toISOString(),
  endpoint: endpointArg,
  expectedProject: path.resolve(import.meta.dirname, '../apps/wechat'),
  mode: 'connected-wechat-devtools-read-only-navigation',
  disclaimer:
    'Screenshots are from the connected WeChat DevTools project. Route opening and scrolling are verified; no write action, synthetic setData, payment, scoring, review, or production mutation is performed.',
  systemInfo: null,
  initialRoute: null,
  screenshots: [],
  failures: [],
  exceptions: [],
};
let mini;
try {
  mini = await automator.connect({ wsEndpoint: endpointArg });
  mini.on('exception', (error) =>
    report.exceptions.push(
      String(error?.message || error || 'AppService exception').slice(0, 1500),
    ),
  );
  const initial = await mini.currentPage();
  report.initialRoute = initial?.path || null;
  const system = await mini.systemInfo();
  report.systemInfo = Object.fromEntries(
    [
      'platform',
      'model',
      'SDKVersion',
      'windowWidth',
      'windowHeight',
      'pixelRatio',
      'statusBarHeight',
    ]
      .filter((key) => system?.[key] !== undefined)
      .map((key) => [key, system[key]]),
  );
  for (const [name, route] of routes) {
    try {
      const page = await mini.reLaunch('/' + route);
      await page.waitFor(1400);
      const current = await mini.currentPage();
      if (!current) throw new Error('No current page after relaunch');
      const actualRoute = String(current.path || '').replace(/^\//, '');
      const top = path.join(output, `${name}-top.png`);
      await mini.screenshot({ path: top });
      const topInfo = pngInfo(top);
      await mini.pageScrollTo(10000);
      await page.waitFor(350);
      const bottom = path.join(output, `${name}-bottom.png`);
      await mini.screenshot({ path: bottom });
      const bottomInfo = pngInfo(bottom);
      report.screenshots.push({
        name,
        requestedRoute: route,
        actualRoute,
        routeMatched: actualRoute === route,
        top: { path: path.basename(top), ...topInfo },
        bottom: { path: path.basename(bottom), ...bottomInfo },
      });
    } catch (error) {
      report.failures.push({ name, route, error: String(error?.message || error).slice(0, 1500) });
    }
  }
} catch (error) {
  report.connectionError = String(error?.message || error).slice(0, 1500);
} finally {
  if (mini) {
    try {
      await mini.disconnect();
    } catch (error) {
      report.disconnectError = String(error?.message || error).slice(0, 500);
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

console.log(JSON.stringify(report, null, 2));
if (report.connectionError || report.screenshots.length === 0) process.exitCode = 1;
