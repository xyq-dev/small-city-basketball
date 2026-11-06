#!/usr/bin/env node
// Render the actual native templates. This gallery never executes product actions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPreview } = require('../apps/wechat/test/helpers/native-preview.cjs');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(
  process.argv[2] || path.join(repository, 'artifacts/wechat-ui/ui005-preview'),
);
fs.mkdirSync(output, { recursive: true });
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(repository, 'tests/mini-program/fixtures', name + '.json'), 'utf8'),
  ).data;
const city = { mode: 'REGION', label: '高州', source: '手动选择', guide: false, warning: '' };
const home = fixture('ui002-root-home-public');
home.citySelection = city;
home.publicEvents[0] = {
  ...home.publicEvents[0],
  name: '城市篮球邀请赛',
  displayCity: '高州',
  venueName: '文化体育中心',
  dateLabel: '11月08日 — 11月22日',
  statusLabel: '进行中',
};
const watch = fixture('ui002-root-watch-directory');
watch.citySelection = city;
watch.dir.items[0] = { ...watch.dir.items[0], ...home.publicEvents[0] };
const local = fixture('ui002-root-local-listed');
local.selection = city;
local.filtersOpen = false;
local.items[0] = {
  ...local.items[0],
  title: '城北篮球公园',
  address: '文化体育中心东区室外篮球场',
  organizationName: '城市体育服务中心',
  qualificationText: '供给资料已审核',
  distanceLabel: '未选择距离起点',
};
const teams = fixture('ui002-root-teams-managed');
teams.teams[0].name = '城北篮球队';
const account = fixture('ui002-root-account-personal');
account.user.displayName = '陈一鸣';
account.navigationMoreOpen = false;
const scenes = [
  { page: 'home', title: '首页', data: home },
  { page: 'watch', title: '赛事', data: watch },
  { page: 'local', title: '同城', data: local },
  { page: 'teams', title: '球队', data: teams },
  { page: 'account', title: '我的', data: account },
];
const escape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const cards = scenes.map((scene, index) => {
  const preview = buildPreview({
    root: path.join(repository, 'apps/wechat'),
    route: `pages/${scene.page}/index`,
    data: scene.data,
    width: 390,
    height: 844,
  });
  fs.writeFileSync(path.join(output, `${scene.page}.html`), preview.html);
  return `<section><div class="label"><span>0${index + 1}</span>${escape(scene.title)}</div><iframe title="${escape(scene.title)} · 示例数据" sandbox srcdoc="${escape(preview.phone)}"></iframe></section>`;
});
fs.writeFileSync(
  path.join(output, 'index.html'),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小城市篮球 · UI005 实际页面预览</title><style>*{box-sizing:border-box}body{margin:0;padding:36px 40px;background:#e8edf3;color:#18283f;font-family:'Noto Sans CJK SC','Microsoft YaHei',sans-serif}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:24px}h1{margin:0;font-size:32px;letter-spacing:1px}p{margin:6px 0 0;color:#63758b;font-size:14px}.version{padding:8px 14px;background:#fff;border-radius:8px;color:#123c73;font-size:12px}.screens{display:flex;gap:24px;align-items:flex-start}.label{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:16px;font-weight:700}.label span{font-size:12px;color:#f28c28}section{flex:none;width:390px}iframe{display:block;width:390px;height:844px;border:1px solid #d7e0eb;border-radius:22px;background:#fff;box-shadow:0 12px 24px #123c730c}footer{margin-top:22px;color:#63758b;font-size:12px} @media(max-width:900px){body{padding:24px}.screens{flex-wrap:wrap}header{align-items:flex-start;flex-direction:column}section,iframe{max-width:100%}}</style></head><body><header><div><h1>小城市篮球</h1><p>让热爱，有主场。全国赛事 · 同城服务 · 球队协作</p></div><div class="version">UI005 · 实际页面代码渲染</div></header><main class="screens">${cards.join('')}</main><footer>本图直接使用本次 WXML / WXSS，人物、赛事、球队与场地均为合成预览数据。静态兼容预览，不执行登录、付款或网络请求，不代表微信开发者工具或真机验收。</footer></body></html>`,
);
console.log(
  JSON.stringify({
    output,
    gallery: path.join(output, 'index.html'),
    routes: scenes.map((scene) => scene.page),
    syntheticData: true,
    compatibilityPreviewOnly: true,
  }),
);
