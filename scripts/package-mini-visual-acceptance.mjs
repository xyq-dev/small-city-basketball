#!/usr/bin/env node
// Package original compatibility-renderer evidence. This does not execute tests.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [320, 390, 430];
const VARIANTS = ['native-top.png', 'native-bottom.png', 'native-compare-last-column.png'];
const SEGMENT_NAME = /^native-segment-\d{2,3}\.png$/;
const SEGMENT_SIDECAR = 'native-scroll-segments.json';
const LIMITATIONS = [
  '本包来自真实 WXML/WXSS 的离线 Chromium 兼容渲染，动态资料为合成数据。',
  '官方微信编译、微信开发者工具与真机验收未由本工具执行；用户视觉签收待定。',
  '打包完整性与文件哈希核验不等于测试通过、像素一致或业务验收通过。',
  '长页保留连续滚动的原始844px视口分段，600px步进并重叠，不拼接为全长图；原稿映射的派生差异以逐页说明为准。',
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${file}: ${error.message}`);
  }
}
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function relative(base, file) {
  return path.relative(base, file).split(path.sep).join('/');
}
function inside(base, file) {
  const rel = path.relative(base, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function strings(value) {
  if (value === undefined || value === null) return [];
  check(
    typeof value === 'string' ||
      (Array.isArray(value) && value.every((item) => typeof item === 'string')),
    'Expected text or text array',
  );
  return Array.isArray(value) ? value : [value];
}
function html(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function git(...args) {
  const result = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
function pngInfo(bytes, label, width, height) {
  check(
    bytes.length >= 45 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    `Invalid PNG signature: ${label}`,
  );
  check(
    bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString() === 'IHDR',
    `Missing PNG IHDR: ${label}`,
  );
  const dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  check(dimensions.width > 0 && dimensions.height > 0, `Invalid PNG dimensions: ${label}`);
  check(bytes.subarray(-8, -4).toString() === 'IEND', `Truncated PNG: ${label}`);
  if (width !== undefined) check(dimensions.width === width, `Wrong PNG width: ${label}`);
  if (height !== undefined) check(dimensions.height === height, `Wrong PNG height: ${label}`);
  return dimensions;
}
function args(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') return { help: true };
    const match = /^--(results|out|run|source|artifact)=(.+)$/.exec(argument);
    check(match, `Unknown or empty argument: ${argument}`);
    check(options[match[1]] === undefined, `Repeated argument: --${match[1]}`);
    options[match[1]] = match[2];
  }
  check(
    options.results && options.out,
    'Required: --results=<extracted artifact directory> --out=<new or empty directory>',
  );
  return options;
}
function walk(directory, visit) {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    check(!entry.isSymbolicLink(), `Symlink in artifact is not supported: ${file}`);
    if (entry.isDirectory()) walk(file, visit);
    else if (entry.isFile()) visit(file);
  }
}
function existingDirectory(file, label) {
  check(
    fs.existsSync(file) && fs.statSync(file).isDirectory(),
    `${label} must be a directory: ${file}`,
  );
  return fs.realpathSync(file);
}
function outputPath(file) {
  const absolute = path.resolve(file);
  if (fs.existsSync(absolute)) {
    check(
      fs.lstatSync(absolute).isDirectory() && !fs.lstatSync(absolute).isSymbolicLink(),
      `Output must be a normal directory: ${absolute}`,
    );
    check(
      fs.readdirSync(absolute).length === 0,
      `Output is not empty; choose a new directory: ${absolute}`,
    );
    return fs.realpathSync(absolute);
  }
  // Resolve an existing ancestor so symlinked parents cannot conceal overlap.
  let ancestor = path.dirname(absolute);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  return path.join(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
}
function loadInputs() {
  const appFile = path.join(ROOT, 'apps/wechat/app.json');
  const catalogFile = path.join(ROOT, 'tests/mini-program/visual-catalog.json');
  const fixtureDirectory = path.join(ROOT, 'tests/mini-program/fixtures');
  const app = readJson(appFile);
  const catalog = readJson(catalogFile);
  check(
    Array.isArray(app.pages) && app.pages.length === 21 && new Set(app.pages).size === 21,
    'Expected exactly 21 registered mini-program routes',
  );
  check(
    app.pages.every((route) => /^pages\/[a-z0-9-]+\/index$/.test(route)),
    'Invalid app route',
  );
  check(
    catalog.version === 1 && Array.isArray(catalog.pages) && catalog.pages.length === 21,
    'Expected visual-catalog version 1 with 21 pages',
  );
  const scenarios = new Map(
    app.pages.map((route) => {
      const name = `initial-${route.split('/')[1]}`;
      return [
        name,
        {
          name,
          route,
          state: 'initial',
          group: 'initial',
          static: false,
          expectText: [],
          file: null,
        },
      ];
    }),
  );
  for (const fileName of fs
    .readdirSync(fixtureDirectory)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const file = path.join(fixtureDirectory, fileName);
    const fixture = readJson(file);
    check(
      /^[a-z0-9-]+$/.test(fixture.name) && app.pages.includes(fixture.route),
      `Invalid fixture identity: ${fileName}`,
    );
    check(!scenarios.has(fixture.name), `Duplicate scenario: ${fixture.name}`);
    check(
      fixture.data && typeof fixture.data === 'object' && !Array.isArray(fixture.data),
      `Missing fixture data: ${fileName}`,
    );
    check(
      fixture.state === undefined || /^[a-z0-9-]+$/.test(fixture.state),
      `Invalid fixture state: ${fileName}`,
    );
    scenarios.set(fixture.name, {
      name: fixture.name,
      route: fixture.route,
      state: fixture.state || 'ready',
      group: fixture.state || 'legacy',
      static: fixture.static === true,
      figmaNode: fixture.figmaNode || null,
      referenceKind: fixture.referenceKind || null,
      primary: fixture.primary === true,
      expectText: strings(fixture.expectText),
      file: relative(ROOT, file),
      fixtureSha256: sha(fs.readFileSync(file)),
    });
  }
  const routes = new Set();
  const pages = catalog.pages.map((page) => {
    check(
      app.pages.includes(page.route) && !routes.has(page.route),
      `Unknown or duplicate catalog route: ${page.route}`,
    );
    routes.add(page.route);
    check(
      typeof page.title === 'string' &&
        page.title &&
        typeof page.figmaNode === 'string' &&
        /^\d+:\d+$/.test(page.figmaNode),
      `Invalid catalog title/Figma node: ${page.route}`,
    );
    check(typeof page.primaryFixture === 'string', `Missing primary fixture: ${page.route}`);
    const primary = scenarios.get(page.primaryFixture);
    check(
      primary && primary.file && primary.route === page.route && primary.state === 'ready',
      `Primary must be a normal ready fixture on its own route: ${page.route}`,
    );
    check(
      typeof page.referenceImage === 'string' && page.referenceImage,
      `Missing reference image: ${page.route}`,
    );
    const referenceSource = path.resolve(ROOT, page.referenceImage);
    check(
      fs.existsSync(referenceSource) && fs.statSync(referenceSource).isFile(),
      `Missing reference image: ${referenceSource}`,
    );
    const referenceBytes = fs.readFileSync(referenceSource);
    const referenceDimensions = pngInfo(referenceBytes, page.referenceImage);
    const referenceSha256 = sha(referenceBytes);
    if (page.referenceSha256 !== undefined)
      check(page.referenceSha256 === referenceSha256, `Reference SHA256 mismatch: ${page.route}`);
    return {
      ...page,
      notes: strings(page.notes),
      notApplicableStates: strings(page.notApplicableStates),
      states: strings(page.states),
      referenceSource,
      referenceSha256,
      referenceDimensions,
      slug: page.route.split('/')[1],
    };
  });
  return { appFile, catalogFile, catalog, pages, scenarios };
}
function validateScrollSegments(sidecar, diagnostic, names) {
  const label = `${diagnostic.scenario}:${diagnostic.width}`;
  check(
    sidecar &&
      sidecar.route === diagnostic.route &&
      sidecar.scenario === diagnostic.scenario &&
      sidecar.width === diagnostic.width,
    `Scroll sidecar identity mismatch: ${label}`,
  );
  check(
    sidecar.viewportHeight === 844 && sidecar.step === 600,
    `Invalid scroll viewport/step: ${label}`,
  );
  check(
    Number.isSafeInteger(sidecar.maxScroll) && sidecar.maxScroll > 0,
    `Invalid maxScroll: ${label}`,
  );
  check(
    sidecar.top?.file === 'native-top.png' &&
      sidecar.top.scrollY === 0 &&
      sidecar.bottom?.file === 'native-bottom.png' &&
      sidecar.bottom.scrollY === sidecar.maxScroll,
    `Invalid scroll endpoints: ${label}`,
  );
  check(
    names.includes(sidecar.top.file) && names.includes(sidecar.bottom.file),
    `Missing scroll endpoint PNG: ${label}`,
  );
  const count = Math.ceil(sidecar.maxScroll / sidecar.step) - 1;
  check(
    Array.isArray(sidecar.segments) && sidecar.segments.length === count,
    `Missing or extra scroll segments: ${label}`,
  );
  sidecar.segments.forEach((segment, index) => {
    const expectedName = `native-segment-${String(index + 1).padStart(2, '0')}.png`;
    check(
      segment &&
        SEGMENT_NAME.test(segment.file) &&
        segment.file === expectedName &&
        segment.scrollY === (index + 1) * sidecar.step &&
        segment.scrollY < sidecar.maxScroll,
      `Invalid scroll segment sequence: ${label}`,
    );
    check(names.includes(segment.file), `Missing scroll segment PNG: ${label} / ${segment.file}`);
  });
  check(
    names.filter((name) => SEGMENT_NAME.test(name)).length === count,
    `Unexpected scroll segment PNG: ${label}`,
  );
  return sidecar;
}
function scanEvidence(results, scenarios) {
  const records = new Map();
  walk(results, (file) => {
    if (path.basename(file) !== 'native-layout.json') return;
    const diagnostic = readJson(file);
    const scenario = scenarios.get(diagnostic.scenario);
    check(
      scenario && diagnostic.route === scenario.route && WIDTHS.includes(diagnostic.width),
      `Unexpected route/scenario/width in ${file}`,
    );
    check(diagnostic.state === scenario.state, `State does not match current fixture in ${file}`);
    check(
      diagnostic.innerWidth === diagnostic.width,
      `Reported innerWidth differs from width in ${file}`,
    );
    for (const field of ['overflow', 'smallButtons', 'unreadableFields'])
      check(Array.isArray(diagnostic[field]), `Missing ${field} diagnostics in ${file}`);
    const key = `${diagnostic.scenario}:${diagnostic.width}`;
    check(
      !records.has(key),
      `Duplicate evidence for ${key}; do not combine retries or different runs`,
    );
    const siblings = fs.readdirSync(path.dirname(file));
    const segmentNames = siblings.filter((name) => name.startsWith('native-segment-'));
    check(
      segmentNames.every((name) => SEGMENT_NAME.test(name)),
      `Invalid scroll segment filename: ${key}`,
    );
    const images = [];
    for (const variant of [
      ...VARIANTS,
      ...segmentNames.sort(
        (a, b) => Number(a.match(/segment-(\d+)/)[1]) - Number(b.match(/segment-(\d+)/)[1]),
      ),
    ]) {
      const imageFile = path.join(path.dirname(file), variant);
      if (!fs.existsSync(imageFile)) continue;
      check(
        fs.lstatSync(imageFile).isFile() && !fs.lstatSync(imageFile).isSymbolicLink(),
        `Invalid screenshot file: ${imageFile}`,
      );
      const bytes = fs.readFileSync(imageFile);
      const dimensions = pngInfo(bytes, imageFile, diagnostic.width, 844);
      images.push({
        variant,
        source: imageFile,
        sourceRelative: relative(results, imageFile),
        sha256: sha(bytes),
        bytes: bytes.length,
        ...dimensions,
      });
    }
    check(
      images.some((image) => image.variant === 'native-top.png'),
      `Missing native-top.png for ${key}`,
    );
    const isLong = Boolean(scenario.file && diagnostic.contentHeight > 844);
    if (isLong)
      check(
        images.some((image) => image.variant === 'native-bottom.png'),
        `Missing native-bottom.png for long scenario ${key}`,
      );
    const sidecarFile = path.join(path.dirname(file), SEGMENT_SIDECAR);
    let scrollSegments = null;
    if (fs.existsSync(sidecarFile)) {
      check(
        fs.lstatSync(sidecarFile).isFile() && !fs.lstatSync(sidecarFile).isSymbolicLink(),
        `Invalid scroll sidecar file: ${key}`,
      );
      const data = validateScrollSegments(
        readJson(sidecarFile),
        diagnostic,
        images.map((image) => image.variant),
      );
      scrollSegments = {
        data,
        file: sidecarFile,
        sourceRelative: relative(results, sidecarFile),
        sourceSha256: sha(fs.readFileSync(sidecarFile)),
      };
      for (const segment of data.segments)
        images.find((image) => image.variant === segment.file).scrollY = segment.scrollY;
    }
    check(!segmentNames.length || scrollSegments, `Scroll segments need their sidecar: ${key}`);
    if (isLong && diagnostic.width === 390)
      check(scrollSegments, `Missing ${SEGMENT_SIDECAR} for long 390px scenario ${key}`);
    if (['compare-three', 'c10-core-compare-ready'].includes(diagnostic.scenario))
      check(
        images.some((image) => image.variant === 'native-compare-last-column.png'),
        `Missing comparison last-column image for ${key}`,
      );
    records.set(key, {
      key,
      scenario,
      diagnostic,
      file,
      sourceSha256: sha(fs.readFileSync(file)),
      sourceRelative: relative(results, file),
      images,
      scrollSegments,
      reportedFindings: ['overflow', 'smallButtons', 'unreadableFields'].reduce(
        (sum, name) => sum + diagnostic[name].length,
        0,
      ),
    });
  });
  const missing = [];
  for (const scenario of scenarios.values())
    for (const width of WIDTHS)
      if (!records.has(`${scenario.name}:${width}`)) missing.push(`${scenario.name}:${width}`);
  check(
    missing.length === 0,
    `Incomplete matrix: missing ${missing.length}/${scenarios.size * WIDTHS.length} JSON/PNG records: ${missing.slice(0, 12).join(', ')}`,
  );
  return records;
}
function createHtml(pages, records, manifest) {
  const recordFor = (name, width) => records.get(`${name}:${width}`);
  function evidenceLinks(record) {
    const labels = {
      'native-top.png': '顶部原图',
      'native-bottom.png': '底部原图',
      'native-compare-last-column.png': '对比末列',
    };
    return record.images
      .filter((image) => image.output)
      .map(
        (image) =>
          `<a href="${html(image.output)}">${labels[image.variant] || `分段${Number(image.variant.match(/segment-(\d+)/)[1])}（Y=${image.scrollY}px）`}</a>`,
      )
      .concat(
        record.scrollSegments?.output
          ? `<a href="${html(record.scrollSegments.output)}">滚动位置 JSON</a>`
          : [],
      )
      .concat(`<a href="${html(record.output)}">原始 JSON</a>`)
      .join('');
  }
  function screen(record, compact = false) {
    const top = record.images.find((image) => image.variant === 'native-top.png');
    return `<figure class="screen${compact ? ' compact' : ''}"><figcaption><strong>${record.diagnostic.width}px</strong><span>${html(record.scenario.name)}</span></figcaption><a class="image-link" href="${html(top.output)}"><img loading="lazy" src="${html(top.output)}" width="${top.width}" height="${top.height}" alt="${html(record.scenario.name)} ${record.diagnostic.width}px 本轮顶部截图"></a><div class="image-links">${evidenceLinks(record)}</div>${record.reportedFindings ? `<p class="finding">原 JSON 报告 ${record.reportedFindings} 项布局问题，请核对。</p>` : ''}</figure>`;
  }
  function stateCard(record) {
    const meta = record.scenario;
    return `<details class="state"><summary><span>${html(meta.name)}</span><span class="tag">${html(meta.group)}${meta.static ? ' · 静态' : ''}</span></summary>${screen(record, true)}<div class="state-info"><p>${meta.file ? `合成 fixture：<code>${html(meta.file)}</code>` : '真实模板初始态：未注入 fixture。'}</p>${meta.expectText.length ? `<p>期望文字：${meta.expectText.map((text) => `<code>${html(text)}</code>`).join(' ')}</p>` : ''}<p>人工视觉签收：待定。320/430 的测量原件：${[320, 430].map((width) => `<a href="${html(recordFor(meta.name, width).output)}">${width}px JSON</a>`).join(' · ')}</p></div></details>`;
  }
  const directory = pages
    .map(
      (page, index) =>
        `<a href="#${page.slug}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${html(page.title)}</strong><small>${html(page.route)}</small></a>`,
    )
    .join('');
  const sections = pages
    .map((page, index) => {
      const primary = recordFor(page.primaryFixture, 390);
      const routeRecords = [...records.values()]
        .filter(
          (record) =>
            record.diagnostic.route === page.route &&
            record.diagnostic.width === 390 &&
            record.scenario.name !== page.primaryFixture,
        )
        .sort(
          (a, b) =>
            a.scenario.group.localeCompare(b.scenario.group) ||
            a.scenario.name.localeCompare(b.scenario.name),
        );
      const figureUrl = `https://www.figma.com/design/${encodeURIComponent(manifest.figmaFile)}?node-id=${encodeURIComponent(page.figmaNode.replace(':', '-'))}`;
      return `<section class="page" id="${page.slug}"><div class="page-heading"><div><p class="eyebrow">PAGE ${String(index + 1).padStart(2, '0')} / 21</p><h2>${html(page.title)}</h2><code>${html(page.route)}</code></div><span class="pending">待用户视觉签收</span></div><div class="mapping"><span class="tag">${html(page.referenceKind || '未声明映射类型')}</span><a href="${html(figureUrl)}">Figma ${html(page.figmaNode)}</a><span>${routeRecords.length + 1} 个390px场景</span></div>${page.notes.map((note) => `<p class="note">${html(note)}</p>`).join('')}<div class="comparison"><figure class="screen reference"><figcaption><strong>Figma 原稿</strong><span>${html(page.figmaNode)} · ${page.referenceDimensions.width}×${page.referenceDimensions.height}</span></figcaption><a class="image-link" href="${html(page.referenceOutput)}"><img loading="lazy" src="${html(page.referenceOutput)}" width="${page.referenceDimensions.width}" height="${page.referenceDimensions.height}" alt="${html(page.title)} Figma原稿"></a><div class="image-links"><a href="${html(page.referenceOutput)}">打开原稿</a></div></figure>${screen(primary)}</div><details class="widths"><summary>展开主要正常态的320 / 430px截图</summary><div class="comparison">${screen(recordFor(page.primaryFixture, 320), true)}${screen(recordFor(page.primaryFixture, 430), true)}</div></details><details class="states"><summary>展开全部${routeRecords.length}个其他场景（390px）</summary><div class="state-list">${routeRecords.map(stateCard).join('')}</div></details>${page.notApplicableStates.length ? `<div class="na"><strong>不适用状态 / N/A</strong><ul>${page.notApplicableStates.map((state) => `<li>${html(state)}</li>`).join('')}</ul></div>` : ''}<a class="back" href="#directory">返回21页目录 ↑</a></section>`;
    })
    .join('');
  const evidenceSummary = manifest.summary;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>小城市篮球 · 21页UI截图验收</title><style>
:root{color-scheme:light;--ink:#172139;--muted:#667289;--line:#dce3ec;--accent:#b94a15;--paper:#f3f5f8}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}a{color:#a64012;text-decoration:none}a:hover{text-decoration:underline}code{overflow-wrap:anywhere;font-size:12px}header{padding:56px max(24px,calc((100vw - 1180px)/2));background:#142138;color:#fff;border-bottom:5px solid #ed8246}.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;margin:0 0 10px;color:#d78252}h1{font-size:clamp(28px,5vw,44px);line-height:1.2;margin:0 0 16px}header p{max-width:850px;color:#c9d3e3}header a{color:#ffd0ae}.metrics{display:flex;flex-wrap:wrap;gap:12px;margin:26px 0}.metrics div{padding:12px 20px;border:1px solid #42516a;border-radius:10px;min-width:125px}.metrics strong{display:block;font-size:25px;line-height:1.2}.metrics span{color:#c9d3e3;font-size:12px}.utility{display:flex;flex-wrap:wrap;gap:20px}main{max-width:1230px;margin:auto;padding:32px 24px 70px}h2{margin:0;font-size:25px;line-height:1.4}h3{font-size:18px}.intro,.directory,.page{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px;margin-bottom:28px}.intro h2{font-size:19px}.intro ul{padding-left:20px;color:var(--muted)}.directory-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:18px}.directory a{display:grid;grid-template-columns:30px 1fr;gap:0 8px;padding:12px;border:1px solid var(--line);border-radius:10px;color:var(--ink)}.directory a span{grid-row:span 2;color:var(--accent);font-weight:700}.directory small{grid-column:2;color:var(--muted);font-size:10px;overflow-wrap:anywhere}.page{scroll-margin-top:18px}.page-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.page-heading code{color:var(--muted)}.pending,.tag{display:inline-block;border-radius:6px;background:#fff0dd;color:#89511e;padding:4px 9px;font-size:12px}.pending{white-space:nowrap}.mapping{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:18px 0;font-size:12px;color:var(--muted)}.tag{background:#edf2f9;color:#51617c}.note{border-left:3px solid #ed8246;padding:8px 14px;background:#fff8f2;font-size:13px}.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start;margin-top:22px}.screen{margin:0;min-width:0;border:1px solid var(--line);border-radius:12px;background:#f7f8fa;padding:14px}.screen figcaption{display:flex;flex-direction:column;gap:3px;margin-bottom:12px;font-size:14px}.screen figcaption span{color:var(--muted);font-size:11px;overflow-wrap:anywhere}.image-link{display:block;max-width:390px;margin:auto;line-height:0;border:1px solid #e3e6eb;background:#fff}.screen img{display:block;width:100%;height:auto}.image-links{display:flex;flex-wrap:wrap;gap:8px 14px;margin:13px 0 0;font-size:12px}.reference .image-link{max-height:844px;overflow:auto}.reference img{max-width:100%;height:auto}.compact .image-link{max-width:320px}.widths,.states{margin-top:20px;border:1px solid var(--line);border-radius:10px;padding:14px}summary{cursor:pointer;font-weight:600;line-height:1.7}summary::marker{color:var(--accent)}.state-list{margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}.state{min-width:0;border:1px solid var(--line);border-radius:9px;padding:12px}.state summary{font-size:12px;overflow-wrap:anywhere}.state summary .tag{margin-left:6px;font-weight:400}.state .screen{margin-top:12px}.state-info{font-size:11px;color:var(--muted);overflow-wrap:anywhere}.state-info code{font-size:10px}.na{font-size:12px;background:#f2f5f9;padding:14px;border-radius:8px;margin-top:20px;color:var(--muted)}.na ul{margin-bottom:0;padding-left:18px}.back{display:block;margin-top:20px;font-size:12px}.finding{color:#a52d25;font-size:12px}footer{text-align:center;color:var(--muted);font-size:12px;padding:0 24px 40px}@media(max-width:760px){header{padding:34px 20px}main{padding:20px 12px}.intro,.directory,.page{padding:18px}.directory-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.comparison,.state-list{grid-template-columns:1fr}.page-heading{display:block}.pending{margin-top:12px}.screen{padding:10px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{header{background:#fff;color:#172139;padding:20px}header p{color:#172139}.directory{break-after:page}.page{break-before:page}details:not([open]){display:none}.pending{border:1px solid #89511e}.back{display:none}}
</style></head><body><header><p class="eyebrow">SMALL CITY BASKETBALL / VISUAL REVIEW</p><h1>21页界面 · 整套截图验收</h1><p>原Figma与本轮真实模板截图逐页对照。先看390px正常态，再展开三宽适配、业务与异常状态。所有人工验收均保持待定。</p><div class="metrics"><div><strong>21</strong><span>原生路由 / 原稿映射</span></div><div><strong>${evidenceSummary.scenarios}</strong><span>初始与合成场景</span></div><div><strong>${evidenceSummary.diagnostics}</strong><span>三宽原始JSON</span></div><div><strong>${evidenceSummary.copiedScreenshots}</strong><span>实际PNG原件</span></div></div><div class="utility"><a href="#directory">浏览21页</a><a href="checklist.csv">逐页 / 状态验收CSV</a><a href="manifest.json">SHA256与来源记录</a><a href="inputs/visual-catalog.json">原稿映射原件</a></div></header><main><section class="intro"><h2>验收边界与证据来源</h2><ul>${LIMITATIONS.concat(
    manifest.catalogLimitations,
  )
    .map((item) => `<li>${html(item)}</li>`)
    .join(
      '',
    )}</ul><p><strong>CI来源版本（调用者提供）：</strong><code>${html(manifest.provenance.requestedSource || '未提供')}</code><br><strong>CI run：</strong>${html(manifest.provenance.run || '未提供')}　<strong>Artifact：</strong>${html(manifest.provenance.artifact || '未提供')}<br><strong>打包时间：</strong>${html(manifest.createdAt)}　<strong>原JSON布局问题计数：</strong>${evidenceSummary.reportedLayoutFindings}（报告值，非重新执行）</p><p>本页无外部资源与JavaScript，下载后可直接离线打开。截图可点击查看原尺寸；长页可按“分段1/2…”打开原始滚动视口图，滚动位置JSON记录每段偏移；各段未拼接。320/430非主要场景仅保留JSON，PNG选择策略详见manifest。</p></section><nav class="directory" id="directory" aria-label="21页目录"><h2>页面目录</h2><div class="directory-grid">${directory}</div></nav>${sections}</main><footer>小城市篮球 · Chromium兼容截图 / 合成数据 · 官方微信与用户验收待完成</footer></body></html>`;
}

function main() {
  const options = args(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/package-mini-visual-acceptance.mjs --results=<extracted CI artifact> --out=<new or empty directory> [--run=<CI run>] [--source=<tested commit>] [--artifact=<artifact name/id>]\nUses the app manifest, fixtures and visual-catalog.json from this script's repository. Packages original PNG/JSON; does not execute or certify tests.",
    );
    return;
  }
  const results = existingDirectory(path.resolve(options.results), 'Results');
  const out = outputPath(options.out);
  check(
    !inside(results, out) && !inside(out, results),
    'Results and output directories must not overlap',
  );
  check(!inside(out, ROOT), 'Output must not contain the source repository');
  const inputs = loadInputs();
  const records = scanEvidence(results, inputs.scenarios);
  const files = [];
  fs.mkdirSync(out, { recursive: true });
  function save(output, bytes, origin = {}) {
    const destination = path.join(out, output);
    check(inside(out, destination), 'Unsafe output path');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    const entry = { path: output, bytes: bytes.length, sha256: sha(bytes), ...origin };
    check(sha(fs.readFileSync(destination)) === entry.sha256, `Copied SHA256 mismatch: ${output}`);
    files.push(entry);
    return entry;
  }
  function original(source, output, origin) {
    const bytes = fs.readFileSync(source);
    save(output, bytes, { original: true, sourceSha256: sha(bytes), ...origin });
    return output;
  }
  original(inputs.catalogFile, 'inputs/visual-catalog.json', {
    source: relative(ROOT, inputs.catalogFile),
    sourceKind: 'repository',
  });
  original(inputs.appFile, 'inputs/wechat-app.json', {
    source: relative(ROOT, inputs.appFile),
    sourceKind: 'repository',
  });
  save(
    'inputs/fixture-metadata.json',
    Buffer.from(`${JSON.stringify([...inputs.scenarios.values()], null, 2)}\n`),
  );
  const primaries = new Set(inputs.pages.map((page) => page.primaryFixture));
  for (const record of records.values()) {
    check(
      sha(fs.readFileSync(record.file)) === record.sourceSha256,
      `Diagnostic changed during packaging: ${record.sourceRelative}`,
    );
    record.output = original(
      record.file,
      `diagnostics/${record.scenario.name}-${record.diagnostic.width}.json`,
      {
        source: record.sourceRelative,
        sourceKind: 'ci-artifact',
        route: record.diagnostic.route,
        scenario: record.scenario.name,
        width: record.diagnostic.width,
      },
    );
    if (record.scrollSegments) {
      const sidecar = record.scrollSegments;
      check(
        sha(fs.readFileSync(sidecar.file)) === sidecar.sourceSha256,
        `Scroll sidecar changed during packaging: ${sidecar.sourceRelative}`,
      );
      sidecar.output = original(
        sidecar.file,
        `diagnostics/${record.scenario.name}-${record.diagnostic.width}-scroll-segments.json`,
        {
          source: sidecar.sourceRelative,
          sourceKind: 'ci-artifact',
          route: record.diagnostic.route,
          scenario: record.scenario.name,
          width: record.diagnostic.width,
        },
      );
    }
    if (record.diagnostic.width !== 390 && !primaries.has(record.scenario.name)) continue;
    for (const image of record.images) {
      // Verify scan-to-copy identity as well as original-to-output identity.
      check(
        sha(fs.readFileSync(image.source)) === image.sha256,
        `Artifact changed during packaging: ${image.sourceRelative}`,
      );
      image.output = original(
        image.source,
        `screenshots/${record.scenario.name}-${record.diagnostic.width}/${image.variant}`,
        {
          source: image.sourceRelative,
          sourceKind: 'ci-artifact',
          route: record.diagnostic.route,
          scenario: record.scenario.name,
          width: record.diagnostic.width,
          pixelWidth: image.width,
          pixelHeight: image.height,
        },
      );
    }
  }
  for (const page of inputs.pages) {
    check(
      sha(fs.readFileSync(page.referenceSource)) === page.referenceSha256,
      `Reference changed during packaging: ${page.route}`,
    );
    page.referenceOutput = original(page.referenceSource, `references/${page.slug}.png`, {
      source: page.referenceImage,
      sourceKind: 'figma-reference',
      route: page.route,
      figmaNode: page.figmaNode,
    });
  }
  const createdAt = new Date().toISOString();
  const packagingStatus = git('status', '--porcelain');
  const manifest = {
    version: 1,
    createdAt,
    figmaFile: inputs.catalog.figmaFile || '2jAHpYjdIHqal1nXeoVqm6',
    renderer: 'Offline Chromium compatibility rendering of native WXML/WXSS; synthetic data',
    limitations: LIMITATIONS,
    catalogLimitations: strings(inputs.catalog.limitations),
    acceptance: {
      officialWeChat: 'not-executed-by-packager',
      userVisual: 'pending',
      testRunStatus: 'not-inferred-from-artifact',
      fileCompleteness: 'checked',
    },
    provenance: {
      run: options.run || null,
      requestedSource: options.source || null,
      artifact: options.artifact || null,
      suppliedMetadataVerifiedAgainstProvider: false,
      longPageCapture:
        'Original overlapping 844px viewport captures at 600px scroll steps, with original scroll-position sidecars; no image stitching or full-body screenshot',
      packagingRepositoryHead: git('rev-parse', 'HEAD'),
      packagingRepositoryTree: git('rev-parse', 'HEAD^{tree}'),
      packagingRepositoryDirty: packagingStatus === null ? null : packagingStatus !== '',
      node: process.version,
      platform: process.platform,
    },
    selection: {
      widths: WIDTHS,
      viewportHeight: 844,
      json: 'All registered initial and fixture scenarios at all three widths',
      png: 'All 390px scenarios and all three widths of each primary ready fixture; preserve top/bottom/compare-last-column and sidecar-indexed viewport segment variants; native-full.png excluded',
      references: 'One original PNG per route; catalog SHA256 verified when provided',
      omittedNonPrimaryWidths: [320, 430],
      hashes:
        'SHA256 covers every packaged file below except manifest.json itself (avoids a circular hash)',
    },
    summary: {
      routes: inputs.pages.length,
      scenarios: inputs.scenarios.size,
      diagnostics: records.size,
      scrollSidecars: [...records.values()].filter((record) => record.scrollSegments).length,
      copiedScreenshots: files.filter(
        (file) => file.sourceKind === 'ci-artifact' && file.path.endsWith('.png'),
      ).length,
      sourceScreenshots: [...records.values()].reduce(
        (sum, record) => sum + record.images.length,
        0,
      ),
      references: inputs.pages.length,
      reportedLayoutFindings: [...records.values()].reduce(
        (sum, record) => sum + record.reportedFindings,
        0,
      ),
    },
    pages: inputs.pages.map(({ referenceSource, ...page }) => ({
      ...page,
      userVisualAcceptance: 'pending',
    })),
    scenarios: [...inputs.scenarios.values()],
    evidence: [...records.values()].map((record) => ({
      route: record.diagnostic.route,
      scenario: record.scenario.name,
      state: record.scenario.state,
      group: record.scenario.group,
      width: record.diagnostic.width,
      json: record.output,
      scrollSegments: record.scrollSegments
        ? {
            ...record.scrollSegments.data,
            source: record.scrollSegments.sourceRelative,
            sourceSha256: record.scrollSegments.sourceSha256,
            output: record.scrollSegments.output,
          }
        : null,
      reportedLayoutFindings: record.reportedFindings,
      images: record.images.map(({ source, ...image }) => ({
        ...image,
        copied: Boolean(image.output),
      })),
    })),
    files,
  };
  const csvRows = [
    [
      'rowType',
      'route',
      'title',
      'scenario',
      'state',
      'width',
      'primary',
      'static',
      'figmaNode',
      'referenceKind',
      'expectText',
      'screenshot',
      'scrollSegments',
      'originalJson',
      'reportedLayoutFindings',
      'userVisualAcceptance',
      'reviewer',
      'reviewDate',
      'notes',
    ],
  ];
  for (const page of inputs.pages) {
    for (const record of [...records.values()]
      .filter((item) => item.diagnostic.route === page.route)
      .sort(
        (a, b) =>
          a.scenario.name.localeCompare(b.scenario.name) || a.diagnostic.width - b.diagnostic.width,
      )) {
      const top = record.images.find((image) => image.variant === 'native-top.png');
      const segmentPaths = record.images
        .filter((image) => SEGMENT_NAME.test(image.variant))
        .map((image) => `${image.scrollY}px: ${image.output || 'not copied by size policy'}`);
      if (record.scrollSegments) segmentPaths.unshift(`sidecar: ${record.scrollSegments.output}`);
      csvRows.push([
        'scenario',
        page.route,
        page.title,
        record.scenario.name,
        record.scenario.group,
        record.diagnostic.width,
        record.scenario.name === page.primaryFixture ? 'yes' : '',
        record.scenario.static ? 'yes' : '',
        record.scenario.figmaNode || page.figmaNode,
        record.scenario.referenceKind || page.referenceKind,
        record.scenario.expectText.join(' | '),
        top.output || 'not copied by size policy',
        segmentPaths.join(' | '),
        record.output,
        record.reportedFindings,
        'pending',
        '',
        '',
        page.notes.join(' | '),
      ]);
    }
    for (const reason of page.notApplicableStates)
      csvRows.push([
        'N/A',
        page.route,
        page.title,
        '',
        'N/A',
        '',
        '',
        '',
        page.figmaNode,
        page.referenceKind,
        '',
        '',
        '',
        '',
        '',
        'not-applicable',
        '',
        '',
        reason,
      ]);
  }
  save(
    'checklist.csv',
    Buffer.from(`\ufeff${csvRows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`),
  );
  save('index.html', Buffer.from(createHtml(inputs.pages, records, manifest)));
  // Every other file is hashed; the manifest intentionally does not hash itself.
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });
  console.log(
    `Packaged ${manifest.summary.routes} routes, ${records.size} original JSON files, ${manifest.summary.copiedScreenshots} original screenshots and 21 references into ${out}`,
  );
  console.log(
    `Reported layout findings: ${manifest.summary.reportedLayoutFindings}. User visual acceptance: pending. Official WeChat acceptance: not executed by this tool.`,
  );
}
export { args as parseArguments, pngInfo, validateScrollSegments, scanEvidence, createHtml };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Visual evidence packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
