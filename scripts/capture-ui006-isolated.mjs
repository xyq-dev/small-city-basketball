#!/usr/bin/env node
// Captures current WXML/WXSS through the compatibility renderer. This is not a WeChat runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { buildPreview } = require('../apps/wechat/test/helpers/native-preview.cjs');
const { loadPage } = require('../apps/wechat/test/helpers/native-page.cjs');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repository, 'apps', 'wechat');
const fixtureRoot = path.join(repository, 'tests', 'mini-program', 'fixtures');
const argumentsMap = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const at = argument.indexOf('=');
    if (!argument.startsWith('--') || at < 3) throw new Error('Use --name=value arguments');
    return [argument.slice(2, at), argument.slice(at + 1)];
  }),
);
for (const key of Object.keys(argumentsMap)) {
  if (!['catalog', 'out', 'names'].includes(key)) throw new Error(`Unknown option: ${key}`);
}
if (!argumentsMap.out) throw new Error('--out is required');

const output = path.resolve(argumentsMap.out);
const relativeOutput = path.relative(repository, output);
if (
  relativeOutput === '' ||
  (!relativeOutput.startsWith(`..${path.sep}`) && relativeOutput !== '..')
) {
  throw new Error('UI006 full screenshot evidence must stay outside the repository');
}
const catalogFile = path.resolve(
  argumentsMap.catalog || path.join(repository, 'tests', 'mini-program', 'ui006-state-scenarios.json'),
);
const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const selected = new Set(
  (argumentsMap.names || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const scenarios = catalog.filter((scenario) => !selected.size || selected.has(scenario.name));
if (!scenarios.length) throw new Error('No scenarios selected');

function merge(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const outputValue = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    outputValue[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? merge(outputValue[key], value)
        : structuredClone(value);
  }
  return outputValue;
}

function dataFor(scenario) {
  let data = loadPage({ root, route: scenario.route }).page.data;
  let fixtureExpectText = [];
  if (scenario.fixture) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, scenario.fixture), 'utf8'));
    if (fixture.route !== scenario.route) throw new Error(`${scenario.name}: fixture route mismatch`);
    data = merge(data, fixture.data || {});
    fixtureExpectText = fixture.expectText || [];
  }
  return {
    data: merge(data, scenario.data || {}),
    expectText: scenario.expectText || fixtureExpectText,
  };
}

fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const report = {
  environment:
    'isolated synthetic fixture; current native WXML/WXSS compatibility renderer; not WeChat runtime',
  screenshotScope:
    'phone iframe only; deviceScaleFactor 1; filenames and report widths are the measured iframe viewport',
  generatedAt: new Date().toISOString(),
  catalog: path.relative(repository, catalogFile).split(path.sep).join('/'),
  widths: [320, 390, 430],
  cases: [],
};
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const scenario of scenarios) {
    const scenarioInput = dataFor(scenario);
    for (const width of report.widths) {
      const preview = buildPreview({
        root,
        route: scenario.route,
        data: scenarioInput.data,
        width,
        height: 844,
      });
      // buildPreview wraps the logical phone in a diagnostic page with 20px side padding.
      // Give the wrapper that extra space, then capture only the iframe so 390 means a
      // measured 390px mini-program viewport rather than the historical 350px inner frame.
      await page.setViewportSize({ width: width + 40, height: 1064 });
      await page.setContent(preview.html, { waitUntil: 'load' });
      const iframe = page.locator('.preview-frame');
      await iframe.waitFor({ state: 'visible' });
      const frame = page
        .frames()
        .find((candidate) => candidate.parentFrame() === page.mainFrame());
      if (!frame) throw new Error(`${scenario.name}: preview iframe unavailable`);
      await frame.waitForLoadState('load');
      const metrics = await frame.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        bodyText: [
          document.body.innerText,
          ...[...document.querySelectorAll('input, textarea')].flatMap((control) => [
            control.value,
            control.getAttribute('placeholder') || '',
          ]),
        ].join('\n'),
      }));
      if (metrics.clientWidth !== width || metrics.clientHeight !== 844) {
        throw new Error(
          `${scenario.name}: measured viewport ${metrics.clientWidth}x${metrics.clientHeight}, expected ${width}x844`,
        );
      }
      for (const expected of scenarioInput.expectText) {
        if (!metrics.bodyText.includes(expected)) {
          throw new Error(`${scenario.name}: rendered state missing expected text: ${expected}`);
        }
      }
      const stem = `${scenario.name}-${width}`;
      await frame.evaluate(() => window.scrollTo(0, 0));
      await iframe.screenshot({ path: path.join(output, `${stem}-top.png`) });
      await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(40);
      await iframe.screenshot({ path: path.join(output, `${stem}-bottom.png`) });
      report.cases.push({
        name: scenario.name,
        figmaNode: scenario.figmaNode || null,
        route: scenario.route,
        fixture: scenario.fixture || null,
        width,
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
        scrollHeight: metrics.scrollHeight,
        clientHeight: metrics.clientHeight,
        screenshotPixelWidth: width,
        screenshotPixelHeight: 844,
        overflow: metrics.scrollWidth > metrics.clientWidth,
      });
    }
  }
} finally {
  await browser.close();
}
report.summary = {
  scenarios: scenarios.length,
  viewports: report.cases.length,
  screenshots: report.cases.length * 2,
  overflowFailures: report.cases.filter((item) => item.overflow).length,
};
fs.writeFileSync(
  path.join(output, 'README.txt'),
  [
    'UI006 isolated visual evidence',
    'Synthetic fixture rendered from the current native WXML/WXSS compatibility renderer.',
    'Not WeChat DevTools or real-device runtime evidence. No clicks, login, payment, or network requests were executed.',
    'PNG dimensions equal the measured mini-program iframe viewport at deviceScaleFactor 1.',
    '',
  ].join('\n'),
);
fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
