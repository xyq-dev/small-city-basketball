import fs from 'node:fs';
import path from 'node:path';

const [resultsArg, outputArg] = process.argv.slice(2);
if (!resultsArg || !outputArg) {
  console.error(
    'Usage: node scripts/collect-ui005-evidence.mjs <playwright-results> <output-directory>',
  );
  process.exit(2);
}

const repo = path.resolve(import.meta.dirname, '..');
const resultsRoot = path.resolve(resultsArg);
const outputRoot = path.resolve(outputArg);
if (!fs.existsSync(resultsRoot)) throw new Error(`Playwright results not found: ${resultsRoot}`);
if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length)
  throw new Error(`Evidence output must be new or empty: ${outputRoot}`);
fs.mkdirSync(outputRoot, { recursive: true });

const routeNodes = {
  'pages/home/index': '35:38',
  'pages/watch/index': '36:53',
  'pages/local/index': '36:54',
  'pages/teams/index': '36:55',
  'pages/account/index': '36:56',
  'pages/city-select/index': '36:57',
  'pages/search/index': '36:58',
  'pages/media/index': '36:59',
  'pages/event/index': '36:60',
  'pages/match/index': '36:61',
  'pages/public-archives/index': '36:63',
  'pages/public-archive/index': '36:64',
  'pages/follows/index': '36:65',
  'pages/recruitment/index': '36:66',
  'pages/poster/index': '36:67',
  'pages/team/index': '36:68',
  'pages/team-request/index': '36:69',
  'pages/team-requests/index': '36:70',
  'pages/team-join/index': '36:71',
  'pages/memberships/index': '36:72',
  'pages/invitation/index': '36:73',
  'pages/registration-events/index': '36:74',
  'pages/entry/index': '36:75',
  'pages/players/index': '36:76',
  'pages/player/index': '36:77',
  'pages/compare/index': '36:78',
  'pages/booking-create/index': '36:79',
  'pages/bookings/index': '36:80',
  'pages/booking-detail/index': '36:81',
  'pages/player-center/index': '36:82',
  'pages/performance/index': '36:83',
  'pages/local-manage/index': '36:84',
  'pages/local-bookings/index': '36:85',
  'pages/local-matchups/index': '36:86',
  'pages/matching/index': '36:87',
  'pages/dispatch/index': '36:88',
  'pages/training/index': '36:89',
  'pages/training-manage/index': '36:90',
  'pages/org-event/index': '36:92',
  'pages/event-setup/index': '36:93',
  'pages/staff-configuration/index': '36:94',
  'pages/entry-review/index': '36:95',
  'pages/schedule/index': '36:96',
  'pages/bracket/index': '36:97',
  'pages/reschedule/index': '36:98',
  'pages/seasons/index': '36:99',
  'pages/scoring-tasks/index': '36:100',
  'pages/org-match/index': '36:101',
  'pages/scorer/index': '36:102',
  'pages/match-exceptions/index': '36:103',
  'pages/season-grants/index': '36:104',
  'pages/match-media/index': '36:105',
  'pages/live-studio/index': '36:106',
  'pages/media-jobs/index': '36:107',
  'pages/participant-materials/index': '36:108',
  'pages/insurance/index': '36:109',
  'pages/qualification-precheck/index': '36:110',
  'pages/guardian/index': '36:111',
  'pages/youth-review/index': '36:112',
  'pages/planned/index': '36:113',
  'pages/account-recovery/index': '36:117',
  'pages/messages/index': '36:118',
  'pages/notification-settings/index': '36:119',
  'pages/account-closure/index': '36:120',
  'pages/governance/index': '36:121',
  'pages/governance-reviews/index': '36:122',
  'pages/platform/index': '36:123',
  'pages/sponsorships/index': '36:124',
  'pages/sponsor-commerce/index': '36:125',
  'pages/public-ledgers/index': '36:126',
  'pages/trade-order/index': '36:127',
  'pages/trade-manage/index': '36:128',
  'pages/city-operations/index': '36:129',
};

const stateNodes = [
  ['36:62', 'pages/event/index', 'ui005-event-standings', '赛程与积分'],
  ['36:91', 'pages/local/index', 'ui005-local-map', '地图找服务'],
  ['36:114', 'pages/participant-materials/index', 'ui005-materials-returned', '报名资料待补充'],
  ['36:115', 'pages/qualification-precheck/index', 'ui005-qualification-progress', '资格核验进度'],
  ['36:116', 'pages/account/index', 'ui005-account-guest', '游客态'],
  ['36:130', 'pages/trade-order/index', 'ui005-refund-progress', '退款进度'],
  ['36:131', 'pages/sponsor-commerce/index', 'ui005-settlement-check', '分账核对'],
  ['36:132', 'pages/watch/index', 'ui005-watch-empty', '观赛空态'],
  ['36:133', 'pages/local/index', 'ui005-local-location', '选城与距离起点'],
  ['36:134', 'pages/account/index', 'ui005-account-wechat-progress', '微信登录状态'],
  ['36:135', 'pages/event/index', 'ui005-event-access-limited', '访问受限'],
  ['36:136', 'pages/player-center/index', 'ui005-profile-result-unknown', '提交结果待核对'],
  ['36:137', 'pages/scorer/index', 'ui005-scorer-readonly', '记分台暂不可写'],
  ['36:138', 'pages/trade-order/index', 'ui005-funds-result-unknown', '资金结果待核对'],
  ['36:139', 'pages/reschedule/index', 'ui005-reschedule-changed', '服务与赛程变更'],
  ['39:53', 'pages/participant-materials/index', 'ui005-materials-list', '我的本人报名'],
  ['39:54', 'pages/participant-materials/index', 'ui005-materials-review', '本人资料审核与进度'],
].map(([node, route, scenario, title]) => ({ node, route, scenario, title }));

const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'apps/wechat/app.json'), 'utf8'));
const routes = [
  ...(manifest.pages || []),
  ...(manifest.subpackages || []).flatMap((pkg) =>
    (pkg.pages || []).map((page) => `${pkg.root}/${page}`),
  ),
];
if (routes.length !== 73 || Object.keys(routeNodes).length !== 73)
  throw new Error(
    `UI005 route mapping mismatch: manifest=${routes.length}, mapping=${Object.keys(routeNodes).length}`,
  );
for (const route of routes)
  if (!routeNodes[route]) throw new Error(`Missing Figma route mapping: ${route}`);

const walk = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'attachments' ? [] : walk(target);
    return entry.name === 'native-layout.json' ? [target] : [];
  });
const records = walk(resultsRoot).map((layoutPath) => {
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  return { ...layout, sourceDirectory: path.dirname(layoutPath) };
});
const key = (route, scenario, width) => `${route}|${scenario}|${width}`;
const byKey = new Map(
  records.map((record) => [key(record.route, record.scenario, record.width), record]),
);

const fixtureDirectory = path.join(repo, 'tests/mini-program/fixtures');
const fixtureByName = new Map(
  fs
    .readdirSync(fixtureDirectory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
      return [fixture.name, fixture];
    }),
);

const scenarioScore = (record) => {
  const fixture = fixtureByName.get(record.scenario);
  const state = String(record.state || fixture?.state || '').toLowerCase();
  let score = record.scenario.startsWith('initial-') ? -200 : 0;
  if (/ready|real-api|synthetic-populated/.test(state)) score += 90;
  if (/ready|workflow|filled|home|console|directory/.test(record.scenario)) score += 45;
  if (
    /loading|error|empty|permission|unknown|pending|readonly|returned/.test(state + record.scenario)
  )
    score -= 55;
  if (record.scenario.startsWith('ui005-')) score -= 20;
  score += Math.min(30, Number(record.contentHeight || 0) / 1000);
  return score;
};
const primaryScenario = new Map();
for (const route of routes) {
  const candidates = records.filter((record) => record.route === route && record.width === 390);
  candidates.sort((a, b) => scenarioScore(b) - scenarioScore(a));
  if (candidates[0]) primaryScenario.set(route, candidates[0].scenario);
}

const safe = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '');
const copyRecord = (record, category) => {
  if (!record) return null;
  const destination = path.join(
    outputRoot,
    category,
    safe(record.route.replace(/^pages\//, '').replace(/\/index$/, '')),
    safe(record.scenario),
    `${record.width}px`,
  );
  fs.mkdirSync(destination, { recursive: true });
  const files = fs
    .readdirSync(record.sourceDirectory)
    .filter((name) =>
      /^(native-(?:top|bottom|segment-\d+)\.png|native-(?:layout|scroll-segments)\.json)$/.test(
        name,
      ),
    );
  for (const name of files)
    fs.copyFileSync(path.join(record.sourceDirectory, name), path.join(destination, name));
  return path.relative(outputRoot, destination).replaceAll('\\', '/');
};
const cleanRecord = (record, evidencePath) =>
  record
    ? {
        route: record.route,
        scenario: record.scenario,
        state: record.state,
        figmaNode: record.figmaNode,
        designSource: record.designSource,
        width: record.width,
        contentHeight: record.contentHeight,
        overflow: record.overflow,
        smallButtons: record.smallButtons,
        unreadableFields: record.unreadableFields,
        evidencePath,
      }
    : null;

const pageCoverage = routes.map((route) => {
  const scenario = primaryScenario.get(route);
  const widthRecords = [320, 390, 430].map((width) => {
    const record = byKey.get(key(route, scenario, width));
    return cleanRecord(record, copyRecord(record, 'routes'));
  });
  const pageBase = path.join(repo, 'apps/wechat', route);
  const files = ['.wxml', '.js', '.json']
    .map((extension) => pageBase + extension)
    .filter(fs.existsSync)
    .map((name) => path.relative(repo, name).replaceAll('\\', '/'));
  const wxss = pageBase + '.wxss';
  files.push(
    fs.existsSync(wxss) ? path.relative(repo, wxss).replaceAll('\\', '/') : 'apps/wechat/app.wxss',
  );
  return {
    route,
    figmaNode: routeNodes[route],
    files,
    primaryScenario: scenario || null,
    widths: widthRecords,
    isolatedVerified:
      widthRecords.every(Boolean) &&
      widthRecords.every(
        (record) =>
          record.overflow.length === 0 &&
          record.smallButtons.length === 0 &&
          record.unreadableFields.length === 0,
      ),
  };
});

const stateCoverage = stateNodes.map((state) => {
  const widthRecords = [320, 390, 430].map((width) => {
    const record = byKey.get(key(state.route, state.scenario, width));
    return cleanRecord(record, copyRecord(record, 'states'));
  });
  return {
    ...state,
    widths: widthRecords,
    isolatedVerified:
      widthRecords.every(Boolean) &&
      widthRecords.every(
        (record) =>
          record.overflow.length === 0 &&
          record.smallButtons.length === 0 &&
          record.unreadableFields.length === 0,
      ),
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  sourceResults: resultsRoot,
  syntheticEnvironment: true,
  disclaimer:
    'Static native WXML/WXSS compatibility rendering with synthetic fixtures; not WeChat runtime, real identity, payment, scoring, or production success evidence.',
  matrixRecords: records.length,
  routes: {
    total: pageCoverage.length,
    isolatedVerified: pageCoverage.filter((page) => page.isolatedVerified).length,
  },
  states: {
    total: stateCoverage.length,
    isolatedVerified: stateCoverage.filter((state) => state.isolatedVerified).length,
  },
};
fs.writeFileSync(
  path.join(outputRoot, 'manifest.json'),
  JSON.stringify({ summary, pageCoverage, stateCoverage }, null, 2) + '\n',
);

const evidenceLink = (record) => (record ? `${record.evidencePath}/native-top.png` : 'MISSING');
const markdown = [
  '# UI005 隔离视觉证据清单',
  '',
  `- 生成时间：${summary.generatedAt}`,
  `- 三宽矩阵记录：${summary.matrixRecords}`,
  `- 路由通过：${summary.routes.isolatedVerified}/${summary.routes.total}`,
  `- 状态通过：${summary.states.isolatedVerified}/${summary.states.total}`,
  `- 环境：${summary.disclaimer}`,
  '',
  '## 73 个注册路由',
  '',
  '| 路由 | Figma | 实现文件 | 390px 证据 | 320/390/430 |',
  '|---|---:|---|---|---|',
  ...pageCoverage.map((page) => {
    const middle = page.widths[1];
    return `| \`${page.route}\` | ${page.figmaNode} | ${page.files.map((file) => `\`${file}\``).join('<br>')} | [${page.primaryScenario || 'missing'}](${evidenceLink(middle)}) | ${page.isolatedVerified ? '通过' : '缺失/失败'} |`;
  }),
  '',
  '## 17 个补充状态',
  '',
  '| 状态 | 路由 | Figma | 390px 证据 | 320/390/430 |',
  '|---|---|---:|---|---|',
  ...stateCoverage.map((state) => {
    const middle = state.widths[1];
    return `| ${state.title} | \`${state.route}\` | ${state.node} | [${state.scenario}](${evidenceLink(middle)}) | ${state.isolatedVerified ? '通过' : '缺失/失败'} |`;
  }),
  '',
].join('\n');
fs.writeFileSync(path.join(outputRoot, 'COVERAGE.md'), markdown);

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const card = (title, subtitle, record) => {
  const image = record ? `${record.evidencePath}/native-top.png` : '';
  const bottom = record ? `${record.evidencePath}/native-bottom.png` : '';
  return `<article><h2>${escape(title)}</h2><p>${escape(subtitle)}</p>${image ? `<a href="${escape(image)}"><img loading="lazy" src="${escape(image)}" alt="${escape(title)}"></a>` : '<strong>缺少证据</strong>'}${bottom && fs.existsSync(path.join(outputRoot, bottom)) ? `<a href="${escape(bottom)}">查看底部截图</a>` : ''}</article>`;
};
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>UI005 隔离视觉证据</title><style>body{margin:0;background:#eef2f7;color:#18283f;font-family:system-ui,"Microsoft YaHei",sans-serif}header{padding:24px;background:#123c73;color:#fff}main{padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}article{background:#fff;border-radius:16px;padding:14px;box-shadow:0 1px 4px #123c7320}h1,h2{margin:0 0 8px}h2{font-size:16px}p{font-size:12px;color:#63758b;overflow-wrap:anywhere}img{display:block;width:100%;height:auto;border:1px solid #e6ebf2;border-radius:10px}a{display:block;margin-top:8px;color:#123c73}</style></head><body><header><h1>UI005 隔离视觉证据</h1><p style="color:#fff">${escape(summary.disclaimer)}</p><p style="color:#fff">路由 ${summary.routes.isolatedVerified}/${summary.routes.total} · 状态 ${summary.states.isolatedVerified}/${summary.states.total}</p></header><main><h1>73 个路由 · 390px</h1><div class="grid">${pageCoverage.map((page) => card(page.route, `Figma ${page.figmaNode} · ${page.primaryScenario}`, page.widths[1])).join('')}</div><h1 style="margin-top:32px">17 个状态 · 390px</h1><div class="grid">${stateCoverage.map((state) => card(state.title, `${state.route} · Figma ${state.node}`, state.widths[1])).join('')}</div></main></body></html>`;
fs.writeFileSync(path.join(outputRoot, 'index.html'), html);

console.log(JSON.stringify(summary, null, 2));
