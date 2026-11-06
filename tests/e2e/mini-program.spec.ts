import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Frame, Page, TestInfo } from '@playwright/test';

type Scenario = {
  name: string;
  route: string;
  data: Record<string, unknown>;
  filled: boolean;
  state?: string;
  figmaNode?: string;
  designSource?: string;
  static?: boolean;
  expectText?: string[];
  expectAbsentText?: string[];
  expectDisabled?: string[];
  expectEnabled?: string[];
  expectVisible?: string[];
  expectAbsentSelectors?: string[];
  expectValues?: Array<{ selector: string; value: string }>;
};
type Preview = { html: string; route: string; width: number; height: number };
type StateAlias = Partial<Scenario> & {
  name: string;
  sourceFixture: string;
  route: string;
  state: string;
  figmaNode: string;
  data?: Record<string, unknown>;
};
const root = path.resolve(__dirname, '../../apps/wechat');
const { buildPreview } = require('../../apps/wechat/test/helpers/native-preview.cjs') as {
  buildPreview(options: {
    root: string;
    route: string;
    data: Record<string, unknown>;
    width: number;
    height: number;
  }): Preview;
};
const { registeredRoutes } = require('../../apps/wechat/test/helpers/registered-routes.cjs') as {
  registeredRoutes(manifest: {
    pages?: string[];
    subpackages?: { root?: string; pages?: string[] }[];
  }): string[];
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  pages: string[];
  subpackages?: { root?: string; pages?: string[] }[];
};
const routes = registeredRoutes(manifest);
const fixtureDirectory = path.resolve(__dirname, '../mini-program/fixtures');
const deepMerge = (
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> => {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    const prior = result[key];
    result[key] =
      value &&
      prior &&
      typeof value === 'object' &&
      typeof prior === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(prior)
        ? deepMerge(prior as Record<string, unknown>, value as Record<string, unknown>)
        : structuredClone(value);
  }
  return result;
};
const scenarios: Scenario[] = [
  ...routes.map((route) => ({
    name: 'initial-' + route.split('/')[1],
    route,
    data: {},
    filled: false,
  })),
  ...fs
    .readdirSync(fixtureDirectory)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(
        fs.readFileSync(path.join(fixtureDirectory, file), 'utf8'),
      ) as Scenario;
      if (
        !/^[a-z0-9-]+$/.test(fixture.name) ||
        !/^pages\/[a-z0-9-]+\/index$/.test(fixture.route) ||
        !fixture.data ||
        typeof fixture.data !== 'object' ||
        Array.isArray(fixture.data)
      )
        throw new Error('Invalid synthetic mini-program fixture: ' + file);
      for (const field of [
        'expectText',
        'expectAbsentText',
        'expectDisabled',
        'expectEnabled',
        'expectVisible',
        'expectAbsentSelectors',
      ] as const) {
        if (
          fixture[field] !== undefined &&
          (!Array.isArray(fixture[field]) ||
            fixture[field]!.some((value) => typeof value !== 'string' || !value))
        )
          throw new Error('Invalid native state expectations: ' + file);
      }
      if (
        fixture.expectValues !== undefined &&
        (!Array.isArray(fixture.expectValues) ||
          fixture.expectValues.some(
            (field) =>
              !field ||
              typeof field.selector !== 'string' ||
              !field.selector ||
              typeof field.value !== 'string',
          ))
      )
        throw new Error('Invalid native field value expectations: ' + file);
      if (fixture.name.startsWith('c10-') && (!fixture.state || !fixture.figmaNode))
        throw new Error('C10 fixture needs its state and Figma reference: ' + file);
      return { ...fixture, filled: true };
    }),
];
// Keep the supplemental states contributed by UI005 in the current templates.
// The evidence guard expects these states as well as the direct fixture files.
const stateAliases = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../mini-program/ui005-state-aliases.json'), 'utf8'),
) as StateAlias[];
if (!Array.isArray(stateAliases)) throw new Error('Invalid UI005 state alias list');
const scenarioNames = new Set(scenarios.map((scenario) => scenario.name));
if (scenarioNames.size !== scenarios.length) throw new Error('Duplicate native fixture scenario');
for (const alias of stateAliases) {
  if (
    !/^[a-z0-9-]+$/.test(alias.name) ||
    scenarioNames.has(alias.name) ||
    !/^[a-z0-9-]+\.json$/.test(alias.sourceFixture) ||
    !routes.includes(alias.route) ||
    !alias.state ||
    !alias.figmaNode ||
    (alias.data !== undefined &&
      (!alias.data || typeof alias.data !== 'object' || Array.isArray(alias.data)))
  )
    throw new Error('Invalid UI005 state alias: ' + alias.name);
  const sourcePath = path.join(fixtureDirectory, alias.sourceFixture);
  if (!fs.existsSync(sourcePath)) throw new Error('Missing UI005 alias source: ' + alias.name);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Scenario;
  if (source.route !== alias.route)
    throw new Error(`UI005 state alias route mismatch: ${alias.name} -> ${source.route}`);
  for (const field of [
    'expectText',
    'expectAbsentText',
    'expectDisabled',
    'expectEnabled',
    'expectVisible',
    'expectAbsentSelectors',
  ] as const) {
    if (
      alias[field] !== undefined &&
      (!Array.isArray(alias[field]) ||
        alias[field]!.some((value) => typeof value !== 'string' || !value))
    )
      throw new Error('Invalid UI005 alias expectations: ' + alias.name);
  }
  if (
    alias.expectValues !== undefined &&
    (!Array.isArray(alias.expectValues) ||
      alias.expectValues.some(
        (field) =>
          !field ||
          typeof field.selector !== 'string' ||
          !field.selector ||
          typeof field.value !== 'string',
      ))
  )
    throw new Error('Invalid UI005 alias field values: ' + alias.name);
  scenarios.push({
    ...source,
    ...alias,
    data: deepMerge(source.data, alias.data || {}),
    designSource:
      alias.designSource ||
      `UI005 state ${alias.figmaNode}; current UI006 template; synthetic isolated state`,
    static: true,
    filled: true,
  });
  scenarioNames.add(alias.name);
}

async function nativeFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('iframe.preview-frame');
  await expect(iframe).toHaveCount(1);
  const element = await iframe.elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('Actual WXML compatibility iframe did not load');
  await frame.locator('body').waitFor();
  // Keep the preview sandbox and CSP intact. Callbacks scheduled inside a
  // script-disabled iframe need not run; poll synchronous state from the host.
  await expect
    .poll(() =>
      frame.evaluate(() => ({
        documentReady: document.readyState === 'complete',
        fontsReady: document.fonts.status === 'loaded',
        imagesReady: Array.from(document.images).every((image) => image.complete),
      })),
    )
    .toEqual({ documentReady: true, fontsReady: true, imagesReady: true });
  return frame;
}

async function measureLayout(frame: Frame) {
  return frame.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        !element.closest('[hidden]') &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const describe = (element: Element) =>
      [
        element.tagName.toLowerCase(),
        element.id ? '#' + element.id : '',
        element.classList.length ? '.' + Array.from(element.classList).join('.') : '',
        ' ' +
          (element.textContent || element.getAttribute('placeholder') || '').trim().slice(0, 70),
      ].join('');
    const dimensions = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    const overflow = Array.from(document.body.querySelectorAll('*'))
      .filter(visible)
      .filter((element) => {
        // A native scroll-view may have wider children. Its own viewport still
        // has to fit, and document/body overflow is always checked separately.
        if (element.parentElement?.closest('[data-mini-scroll*="x"]')) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewport + 1;
      })
      .map((element) => ({ element: describe(element), ...dimensions(element) }));
    const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
    const smallButtons = buttons
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.height < 43.5 || rect.width < 43.5;
      })
      .map((element) => ({ element: describe(element), ...dimensions(element) }));
    const fields = Array.from(
      document.querySelectorAll(
        'input:not([type="checkbox"]):not([type="radio"]), textarea, [data-mini-tag="picker"]',
      ),
    ).filter(visible);
    const unreadableFields: Array<{ element: string; problem: string; value: number }> = [];
    for (const field of fields) {
      if (field.getBoundingClientRect().height < 43.5)
        unreadableFields.push({
          element: describe(field),
          problem: 'control height below 44px',
          value: field.getBoundingClientRect().height,
        });
      if (field.matches('input,textarea')) {
        const font = Number.parseFloat(getComputedStyle(field).fontSize);
        if (font < 15.9)
          unreadableFields.push({
            element: describe(field),
            problem: 'input text below 16px',
            value: font,
          });
      } else {
        const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
        let primaryLabels = 0;
        while (walker.nextNode()) {
          const text = walker.currentNode;
          const parent = text.parentElement;
          if (!text.textContent?.trim() || !parent || !visible(parent)) continue;
          const font = Number.parseFloat(getComputedStyle(parent).fontSize);
          // UI006 gives picker values a readable field style, with a separate
          // 11px status badge. A badge is metadata, never the selection label.
          if (parent.closest('.figma-status')) {
            if (font < 10.9)
              unreadableFields.push({
                element: describe(parent),
                problem: 'picker status annotation below 11px',
                value: font,
              });
            continue;
          }
          primaryLabels += 1;
          if (font < 13.9)
            unreadableFields.push({
              element: describe(parent),
              problem: 'picker text below 14px',
              value: font,
            });
        }
        if (!primaryLabels)
          unreadableFields.push({
            element: describe(field),
            problem: 'picker has no visible selection label',
            value: 0,
          });
      }
    }
    const horizontalScrollers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-mini-scroll*="x"]'),
    )
      .filter(visible)
      .map((element) => ({
        element: describe(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    const localHeadingElement = document.querySelector('.local-heading');
    const localCopy = localHeadingElement?.firstElementChild;
    const localTitle = localCopy?.querySelector('.title');
    let localHeading: { copyWidth: number; titleWidth: number; titleLines: number } | null = null;
    if (localCopy && localTitle) {
      const range = document.createRange();
      range.selectNodeContents(localTitle);
      localHeading = {
        copyWidth: localCopy.getBoundingClientRect().width,
        titleWidth: localTitle.getBoundingClientRect().width,
        titleLines: new Set(
          Array.from(range.getClientRects()).map((rect) => Math.round(rect.top * 100) / 100),
        ).size,
      };
    } else if (localHeadingElement) {
      localHeading = { copyWidth: 0, titleWidth: 0, titleLines: 0 };
    }
    const quoteBounds = (rect: DOMRect) => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
    const wrappedQuoteAmounts: Array<{
      selector: string;
      text: string;
      lines: number;
      problem?: string;
      amountRect?: ReturnType<typeof quoteBounds>;
      columnRect?: ReturnType<typeof quoteBounds>;
    }> = [];
    for (const selector of [
      '.profile-quote .quote-total-price',
      '.profile-quote .quote-price',
      '.profile-quote .fee-amount',
      '.fee-row .fee-value',
      '.compare-fee-row .compare-total',
      '.booking-fee-row .booking-fee-value',
    ]) {
      for (const element of Array.from(document.querySelectorAll(selector)).filter(visible)) {
        const range = document.createRange();
        let text = element.textContent?.trim() || '';
        if (element.classList.contains('quote-price')) {
          // The service amount is the direct text node; the smaller / 场 unit
          // belongs to its own native text element and has a different baseline.
          const amount = Array.from(element.childNodes).find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          );
          if (!amount) {
            wrappedQuoteAmounts.push({ selector, text, lines: 0 });
            continue;
          }
          const value = amount.textContent || '';
          text = value.trim();
          range.setStart(amount, value.length - value.trimStart().length);
          range.setEnd(amount, value.trimEnd().length);
        } else {
          range.selectNodeContents(element);
        }
        const amountRects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        const lines = new Set(amountRects.map((rect) => Math.round(rect.top * 100) / 100)).size;
        if (lines !== 1) wrappedQuoteAmounts.push({ selector, text, lines });
        const column = element.closest(
          element.classList.contains('quote-total-price')
            ? '.quote-total'
            : '.quote-service,.fee-row,.compare-fee-row,.booking-fee-row',
        );
        if (column) {
          const bounds = column.getBoundingClientRect();
          for (const rect of amountRects) {
            if (
              rect.left < bounds.left - 1 ||
              rect.right > bounds.right + 1 ||
              rect.top < bounds.top - 1 ||
              rect.bottom > bounds.bottom + 1
            )
              wrappedQuoteAmounts.push({
                selector,
                text,
                lines,
                problem: 'outside containing quote column',
                amountRect: quoteBounds(rect),
                columnRect: quoteBounds(bounds),
              });
          }
        }
      }
    }
    const overlappingQuotes: Array<{
      service: ReturnType<typeof quoteBounds>;
      total: ReturnType<typeof quoteBounds>;
    }> = [];
    for (const quote of Array.from(document.querySelectorAll('.profile-quote')).filter(visible)) {
      const service = quote.querySelector('.quote-service');
      const total = quote.querySelector('.quote-total');
      if (!service || !total) continue;
      const left = service.getBoundingClientRect();
      const right = total.getBoundingClientRect();
      if (
        Math.min(left.right, right.right) > Math.max(left.left, right.left) &&
        Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top)
      )
        overlappingQuotes.push({ service: quoteBounds(left), total: quoteBounds(right) });
    }
    return {
      innerWidth: window.innerWidth,
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      contentHeight: document.documentElement.scrollHeight,
      customHeaderCount: document.querySelectorAll('.scb-header,.figma-header').length,
      nativeHeaderCount: document.querySelectorAll('.mini-native-bar').length,
      localHeading,
      wrappedQuoteAmounts,
      overlappingQuotes,
      buttonCount: buttons.length,
      fieldCount: fields.length,
      overflow,
      smallButtons,
      unreadableFields,
      horizontalScrollers,
    };
  });
}

async function attachScreen(page: Page, testInfo: TestInfo, name: string) {
  const target = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await page.locator('iframe.preview-frame').screenshot({ path: target, animations: 'disabled' });
  await testInfo.attach(name, { path: target, contentType: 'image/png' });
}

// Check the rebuilt UI006 screens against their shared visual tokens. The
// historical C11 fixtures still exercise the same data, not the retired DOM.
async function checkDesignGeometry(frame: Frame, scenario: Scenario, width: number) {
  const groups: Record<string, string> = {
    'initial-home': 'home',
    'c10-core-home-ready': 'home',
    'c11-home-ready': 'home',
    'ui002-root-home-public': 'home',
    'ui002-root-home-error': 'home',
    'players-collapsed': 'players',
    'c10-core-players-ready': 'players',
    'c11-player-market-ready': 'players',
    'compare-three': 'compare',
    'c10-core-compare-ready': 'compare',
    'c11-player-compare-ready': 'compare',
    'c11-player-detail-ready': 'player',
    'c11-booking-create-ready': 'booking-create',
    'c11-booking-orders-ready': 'bookings',
  };
  const group = groups[scenario.name];
  if (!group) return null;
  const metrics = await frame.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        radius: parseFloat(style.borderTopLeftRadius),
        padding: parseFloat(style.paddingLeft),
        background: style.backgroundColor,
        color: style.color,
        disabled: element instanceof HTMLButtonElement && element.disabled,
      };
    };
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[src^="data:image/jpeg"]'),
    ).filter(
      (image) =>
        image.getBoundingClientRect().width > 0 && image.getBoundingClientRect().height > 0,
    );
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      header: measure('.figma-header,.scb-header'),
      duplicateNativeHeader: document.querySelectorAll('.mini-native-bar').length,
      statusBars: document.querySelectorAll('.mini-custom-status').length,
      hero: measure('.home-hero'),
      homeSearch: measure('.figma-header__search'),
      homeQuick: measure('.home-quick'),
      homeNav: measure('.figma-nav'),
      homeSelectedNav: measure('.figma-nav__item.is-active'),
      homeMark: measure('.figma-header__brand img,.figma-header__brand image'),
      content: measure('.figma-page__content'),
      summary: measure('.figma-summary'),
      section: measure('.figma-section'),
      sectionTitle: measure('.figma-section__title'),
      footer: measure('.figma-fixed-actions'),
      secondary: measure('.figma-fixed-actions > .figma-action--ghost'),
      action: measure('.figma-fixed-actions > .figma-action--orange'),
      tabs: measure('.players-tabs,.compare-tabs,.player-tabs,.scope-tabs,.booking-tabs'),
      comparePeople: document.querySelectorAll('.compare-person').length,
      playerRows: document.querySelectorAll('.player-result').length,
      bookingRows: document.querySelectorAll('.booking-item').length,
      photographs: images.map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        objectFit: getComputedStyle(image).objectFit,
        mode: image.getAttribute('data-mini-image-mode'),
        naturalRatio: image.naturalWidth / image.naturalHeight,
        ratio: image.width / image.height,
      })),
    };
  });
  expect(metrics.fontFamily).toContain('Noto Sans CJK SC');
  expect(metrics.duplicateNativeHeader).toBe(0);
  expect(metrics.statusBars).toBe(1);
  for (const photo of metrics.photographs) {
    expect(photo.loaded).toBe(true);
    if (photo.mode === 'widthFix')
      expect(Math.abs(photo.ratio - photo.naturalRatio)).toBeLessThan(0.01);
    else expect(photo.objectFit).toBe('cover');
  }
  if (group === 'home') {
    expect(metrics.header?.height).toBe(width <= 360 ? 196 : 152);
    expect(metrics.homeSearch?.x).toBe(16);
    expect(metrics.homeSearch?.width).toBe(width - 32);
    expect(metrics.homeSearch?.height).toBe(44);
    expect(metrics.homeSearch?.radius).toBe(22);
    expect(metrics.homeSearch?.background).toBe('rgb(255, 255, 255)');
    expect(metrics.hero?.x).toBe(0);
    expect(metrics.hero?.width).toBe(width);
    expect(metrics.hero?.radius).toBe(0);
    expect(metrics.hero?.height).toBe(204);
    expect(metrics.homeQuick?.height).toBe(152);
    expect(metrics.homeMark?.width).toBe(28);
    expect(metrics.homeMark?.height).toBe(28);
    expect(metrics.homeNav?.height).toBe(50);
    expect(metrics.homeSelectedNav?.color).toBe('rgb(18, 60, 115)');
  } else {
    const pagePadding = width <= 360 ? 12 : 16;
    const cardPadding = width <= 360 ? 12 : 14;
    // Header component defaults to the Figma 44px status inset + 44px navigation row.
    expect(metrics.header?.height).toBe(88);
    expect(metrics.content?.padding).toBe(pagePadding);
    expect(metrics.summary?.x).toBe(pagePadding);
    expect(metrics.summary?.width).toBe(width - pagePadding * 2);
    expect(metrics.summary?.height).toBeGreaterThanOrEqual(92);
    expect(metrics.summary?.radius).toBe(16);
    expect(metrics.summary?.padding).toBe(cardPadding);
    expect(metrics.section?.padding).toBe(cardPadding);
    expect(metrics.section?.radius).toBe(16);
    expect(metrics.sectionTitle?.fontSize).toBe(17);
    expect(metrics.sectionTitle?.lineHeight).toBe(24);
    expect(metrics.tabs?.height).toBe(48);
    expect(metrics.footer?.x).toBe(0);
    expect(metrics.footer?.width).toBe(width);
    const secondaryWidth = (width - pagePadding * 2 - 8) * 0.4;
    expect(metrics.secondary?.x).toBe(pagePadding);
    expect(metrics.secondary?.width).toBeCloseTo(secondaryWidth, 1);
    expect(metrics.action?.x).toBeCloseTo(pagePadding + secondaryWidth + 8, 1);
    expect(metrics.action?.width).toBeCloseTo((width - pagePadding * 2 - 8) * 0.6, 1);
    for (const button of [metrics.secondary, metrics.action]) {
      expect(button?.height).toBe(48);
      expect(button?.radius).toBe(24);
      expect(button?.fontSize).toBe(16);
      expect(button?.lineHeight).toBe(24);
    }
    expect(metrics.action?.background).toBe(
      metrics.action?.disabled ? 'rgb(230, 235, 242)' : 'rgb(242, 140, 40)',
    );
    expect(metrics.action?.color).toBe(
      metrics.action?.disabled ? 'rgb(124, 142, 165)' : 'rgb(24, 40, 63)',
    );
    if (group === 'compare' && Array.isArray(scenario.data.columns))
      expect(metrics.comparePeople).toBe(scenario.data.columns.length);
    if (group === 'player') expect(metrics.photographs.length).toBe(width <= 360 ? 0 : 1);
  }
  const map = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../mini-program/ui006-route-map.json'), 'utf8'),
  ) as Array<{ route: string; figmaNode: string }>;
  return {
    source:
      group === 'home'
        ? 'latest:UI006:35:38/59:54'
        : `latest:UI006:${map.find((entry) => entry.route === scenario.route)?.figmaNode || 'unmapped'}`,
    group,
    ...metrics,
  };
}

test.describe('原生 WXML/WXSS 静态兼容布局（非微信运行时或真机验收）', () => {
  // This matrix owns its widths. Existing mobile-project web application tests
  // still run; repeating these same native-source previews adds no coverage.
  test.skip(({ isMobile }) => Boolean(isMobile), 'Explicit three-width desktop matrix');
  test.use({ deviceScaleFactor: 1 });

  test('保留可访问加载状态与惰性事件语义', async ({ page, context }) => {
    const attemptedNetwork: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) attemptedNetwork.push(request.url());
    });
    await context.setOffline(true);
    await page.route('**/*', (route) => route.abort('blockedbyclient'));
    const preview = buildPreview({
      root,
      route: 'pages/players/index',
      data: { loading: true },
      width: 390,
      height: 844,
    });
    await page.setContent(preview.html, { waitUntil: 'load' });
    const frame = await nativeFrame(page);
    await expect(frame.getByRole('status', { name: '正在加载', exact: true })).toHaveCount(1);
    await expect(frame.getByRole('status', { name: '正在加载', exact: true })).toBeVisible();
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', '');
    await expect(frame.locator('script,[onclick],[onerror]')).toHaveCount(0);
    expect(await frame.locator('[data-mini-bindtap]').count()).toBeGreaterThan(0);
    expect(attemptedNetwork).toEqual([]);
  });

  for (const width of [320, 390, 430]) {
    for (const scenario of scenarios) {
      test(`${width}px · ${scenario.name}`, async ({ page, context }, testInfo) => {
        expect(routes, scenario.route).toContain(scenario.route);
        const attemptedNetwork: string[] = [];
        page.on('request', (request) => {
          if (/^https?:/i.test(request.url())) attemptedNetwork.push(request.url());
        });
        await context.setOffline(true);
        await page.route('**/*', (route) => route.abort('blockedbyclient'));
        await page.setViewportSize({ width: width + 80, height: 1044 });
        const preview = buildPreview({
          root,
          route: scenario.route,
          data: scenario.data,
          width,
          height: 844,
        });
        await page.setContent(preview.html, { waitUntil: 'load' });
        await expect(page.getByText(/非微信运行时\/开发工具\/真机/)).toBeVisible();
        const frame = await nativeFrame(page);
        if (
          scenario.filled &&
          !scenario.static &&
          (!scenario.state || scenario.state === 'ready')
        ) {
          const visibleContent = await frame.evaluate(() => {
            const values = Array.from(
              document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
                'input:not([type="password"]):not([type="hidden"]),textarea',
              ),
            )
              .filter((field) => {
                const style = getComputedStyle(field);
                const rect = field.getBoundingClientRect();
                return (
                  !field.closest('[hidden]') &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  rect.width > 0 &&
                  rect.height > 0
                );
              })
              .map((field) => field.value);
            return [document.body.textContent || '', ...values].join(' ');
          });
          expect(
            visibleContent,
            'filled fixtures must expose a synthetic marker in content or a visible input value',
          ).toContain('合成');
        }
        for (const text of scenario.expectText || [])
          await expect(frame.locator('body')).toContainText(text);
        for (const text of scenario.expectAbsentText || [])
          await expect(frame.locator('body')).not.toContainText(text);
        const namedAction = (name: string) =>
          frame
            .getByRole('button', { name, exact: true })
            .or(frame.getByRole('tab', { name, exact: true }).and(frame.locator('button')))
            .first();
        for (const name of scenario.expectDisabled || [])
          await expect(namedAction(name)).toBeDisabled();
        for (const name of scenario.expectEnabled || [])
          await expect(namedAction(name)).toBeEnabled();
        for (const selector of scenario.expectVisible || []) {
          const element = frame.locator(selector);
          await expect(element).toHaveCount(1);
          await expect(element).toBeVisible();
        }
        for (const selector of scenario.expectAbsentSelectors || [])
          await expect(frame.locator(selector)).toHaveCount(0);
        for (const field of scenario.expectValues || []) {
          const element = frame.locator(field.selector);
          await expect(element).toHaveCount(1);
          await expect(element).toBeVisible();
          await expect(element).toHaveValue(field.value);
        }
        if (scenario.name === 'ui002-services-player-large' && width === 390) {
          const service = frame.locator('.fee-row').first();
          await expect(service.locator('.fee-value')).toHaveCount(1);
          const previousStyle = await service.evaluate((element) => {
            const prior = element.getAttribute('style');
            // UI006 presents each amount in a separate fee row. Force that
            // row too narrow to prove the amount boundary guard is active.
            (element as HTMLElement).style.flex = '0 0 24px';
            (element as HTMLElement).style.width = '24px';
            return prior;
          });
          try {
            const negative = await measureLayout(frame);
            const negativePath = testInfo.outputPath('native-quote-negative-control.json');
            fs.mkdirSync(path.dirname(negativePath), { recursive: true });
            fs.writeFileSync(negativePath, JSON.stringify(negative, null, 2));
            await testInfo.attach('native-quote-negative-control.json', {
              path: negativePath,
              contentType: 'application/json',
            });
            expect(
              negative.wrappedQuoteAmounts.some(
                (amount) => amount.problem === 'outside containing quote column',
              ),
              'an insufficient quote column must fail the amount boundary guard',
            ).toBe(true);
          } finally {
            await service.evaluate((element, prior) => {
              if (prior === null) element.removeAttribute('style');
              else element.setAttribute('style', prior);
            }, previousStyle);
          }
        }
        const layout = await measureLayout(frame);
        expect(
          layout.customHeaderCount > 0 && layout.nativeHeaderCount > 0,
          'custom scb-header and native navigation must not coexist',
        ).toBe(false);
        if (scenario.name === 'c10-team-team-ready') {
          const roster = frame
            .locator('.figma-section')
            .filter({ has: frame.getByText('球队名册', { exact: true }) });
          const members = roster.locator('.figma-row');
          await expect(members).toHaveCount(3);
          const clippedLabels = await members.locator('.figma-status').evaluateAll((labels) =>
            labels
              .filter((label) => {
                const style = getComputedStyle(label);
                const range = document.createRange();
                range.selectNodeContents(label);
                const available =
                  label.clientWidth -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight);
                return (
                  range.getClientRects().length !== 1 ||
                  range.getBoundingClientRect().width > available + 1
                );
              })
              .map((label) => label.textContent),
          );
          expect(clippedLabels, 'member status labels must fit on one line').toEqual([]);
        }
        await attachScreen(page, testInfo, 'native-top.png');
        const designGeometry = await checkDesignGeometry(frame, scenario, width);
        const diagnosticPath = testInfo.outputPath('native-layout.json');
        fs.mkdirSync(path.dirname(diagnosticPath), { recursive: true });
        fs.writeFileSync(
          diagnosticPath,
          JSON.stringify(
            {
              route: scenario.route,
              scenario: scenario.name,
              state: scenario.state || (scenario.filled ? 'ready' : 'initial'),
              figmaNode: scenario.figmaNode || null,
              designSource:
                scenario.designSource || (scenario.name.startsWith('c11-') ? 'approved:C11' : null),
              width,
              ...layout,
              designGeometry,
            },
            null,
            2,
          ),
        );
        await testInfo.attach('native-layout.json', {
          path: diagnosticPath,
          contentType: 'application/json',
        });

        if (layout.localHeading) {
          expect(
            layout.localHeading.copyWidth,
            'local heading copy must keep a readable column',
          ).toBeGreaterThanOrEqual(180);
          expect(
            layout.localHeading.titleWidth,
            'local title must not collapse beside the city',
          ).toBeGreaterThanOrEqual(180);
          expect(layout.localHeading.titleLines).toBeGreaterThan(0);
          expect(
            layout.localHeading.titleLines,
            'local title must not become a vertical column',
          ).toBeLessThanOrEqual(2);
        }
        expect(
          layout.wrappedQuoteAmounts,
          'player service and total quote amounts must each remain on one line',
        ).toEqual([]);
        expect(layout.overlappingQuotes, 'player quote columns must not overlap').toEqual([]);

        // Measure the iframe's document, never just the outer preview wrapper.
        expect(layout.innerWidth).toBe(width);
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
        expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
        expect(layout.overflow, 'elements outside the native viewport').toEqual([]);
        expect(
          layout.smallButtons,
          'visible button touch targets must be at least 44×44px',
        ).toEqual([]);
        expect(layout.unreadableFields, 'form controls must keep readable native text').toEqual([]);
        expect(attemptedNetwork, 'compatibility previews must remain entirely offline').toEqual([]);

        if (['compare-three', 'c10-core-compare-ready'].includes(scenario.name)) {
          expect(
            layout.horizontalScrollers.some(
              (region) => region.scrollWidth > region.clientWidth + 1,
            ),
          ).toBe(true);
          await frame.locator('[data-mini-scroll*="x"]').evaluate((element) => {
            element.scrollLeft = element.scrollWidth;
          });
          const scrolled = await measureLayout(frame);
          expect(scrolled.documentWidth).toBeLessThanOrEqual(scrolled.viewport + 1);
          expect(scrolled.bodyWidth).toBeLessThanOrEqual(scrolled.viewport + 1);
          expect(scrolled.overflow).toEqual([]);
          await attachScreen(page, testInfo, 'native-compare-last-column.png');
        }
        if (scenario.filled && layout.contentHeight > 844) {
          await frame.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await attachScreen(page, testInfo, 'native-bottom.png');
          if (width === 390) {
            // Keep the actual 844px viewport and fixed controls. Capturing a
            // taller child body is clipped by its iframe; preserve unstitched
            // overlapping viewport segments instead of claiming a full image.
            const maxScroll = await frame.evaluate(
              () => document.documentElement.scrollHeight - window.innerHeight,
            );
            const segments: Array<{ file: string; scrollY: number }> = [];
            for (let position = 600; position < maxScroll; position += 600) {
              const scrollY = await frame.evaluate((y) => {
                window.scrollTo(0, y);
                return window.scrollY;
              }, position);
              const file = `native-segment-${String(segments.length + 1).padStart(2, '0')}.png`;
              await attachScreen(page, testInfo, file);
              segments.push({ file, scrollY });
            }
            const segmentPath = testInfo.outputPath('native-scroll-segments.json');
            fs.writeFileSync(
              segmentPath,
              JSON.stringify(
                {
                  route: scenario.route,
                  scenario: scenario.name,
                  width,
                  viewportHeight: 844,
                  step: 600,
                  maxScroll,
                  top: { file: 'native-top.png', scrollY: 0 },
                  segments,
                  bottom: { file: 'native-bottom.png', scrollY: maxScroll },
                },
                null,
                2,
              ),
            );
            await testInfo.attach('native-scroll-segments.json', {
              path: segmentPath,
              contentType: 'application/json',
            });
          }
        }
      });
    }
  }
});
