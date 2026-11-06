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
};
type Preview = { html: string; route: string; width: number; height: number };
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
      ] as const) {
        if (
          fixture[field] !== undefined &&
          (!Array.isArray(fixture[field]) ||
            fixture[field]!.some((value) => typeof value !== 'string' || !value))
        )
          throw new Error('Invalid native state expectations: ' + file);
      }
      if (fixture.name.startsWith('c10-') && (!fixture.state || !fixture.figmaNode))
        throw new Error('C10 fixture needs its state and Figma reference: ' + file);
      return { ...fixture, filled: true };
    }),
];

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
        while (walker.nextNode()) {
          const text = walker.currentNode;
          const parent = text.parentElement;
          if (!text.textContent?.trim() || !parent || !visible(parent)) continue;
          const font = Number.parseFloat(getComputedStyle(parent).fontSize);
          if (font < 13.9)
            unreadableFields.push({
              element: describe(parent),
              problem: 'picker text below 14px',
              value: font,
            });
        }
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
          element.classList.contains('quote-total-price') ? '.quote-total' : '.quote-service',
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

// Keep exact geometry assertions beside the generic overflow/touch/readability
// matrix. Home now follows the latest UI006 Figma frames; the other groups keep
// their established page-specific references until they are rebuilt.
async function checkDesignGeometry(frame: Frame, scenario: string, width: number) {
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
  const group = groups[scenario];
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
      };
    };
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      header: measure('.figma-header--home,.scb-header'),
      duplicateNativeHeader: document.querySelectorAll('.mini-native-bar').length,
      statusBars: document.querySelectorAll('.mini-custom-status').length,
      hero: measure('.home-hero'),
      homeSearch: measure('.figma-header__search'),
      homeQuick: measure('.home-quick'),
      homeAction: measure('.home-primary'),
      homeFilters: measure('.home-filters'),
      homeBall: measure('.home-brand-ball'),
      homeNav: measure('.figma-nav'),
      homeSelectedNav: measure('.figma-nav__item.is-active'),
      homeMark: measure('.figma-header__brand img,.figma-header__brand image'),
      homeVectors: Array.from(
        document.querySelectorAll<HTMLImageElement>('.home-brand-ball,.header-brand img'),
      ).map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.width,
        height: image.height,
      })),
      search: measure('.market-search'),
      playerCard: measure('.player-card'),
      portrait: measure('.player-portrait'),
      metricColumn: measure('.metric-labels'),
      playerColumn: measure('.compare-column'),
      tableHead: measure('.comparison-head'),
      tableCell: measure('.comparison-cell'),
      columns: document.querySelectorAll('.compare-column').length,
      profileHero: measure('.profile-hero'),
      profilePortrait: measure('.profile-portrait'),
      profileIdentity: measure('.profile-identity'),
      profileAvatar: measure('.profile-avatar'),
      profileAvatarIcon: measure('.profile-avatar-icon'),
      profileName: measure('.profile-name'),
      profileMeta: measure('.profile-meta'),
      profileSamples: measure('.profile-samples'),
      profileMetric: measure('.profile-metrics .metric-value'),
      profileFactCount: document.querySelectorAll('.profile-metric').length,
      profileAvailability: measure('.availability-card'),
      profileQuotePrice: measure('.profile-quote .quote-price'),
      profileQuoteTotal: measure('.profile-quote .quote-total-price'),
      profileFooter: measure('.profile-action'),
      profileSecondary: measure('.profile-action > .secondary'),
      wrappedMetricLabels: Array.from(document.querySelectorAll('.label-cell'))
        .filter((cell) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          return range.getClientRects().length > 1;
        })
        .map((cell) => cell.textContent),
      profileQuote: measure('.profile-quote'),
      scopeRail: measure('.scope-rail'),
      selectedPlayer: measure('.selected-player'),
      arrangement: measure('.arrangement-summary'),
      orderCard: measure('.booking-progress-card'),
      orderTabs: measure('.booking-view-tabs'),
      orderMore: Array.from(document.querySelectorAll('.cooperation-expand')).map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          text: button.textContent?.trim(),
          icons: button.querySelectorAll('img').length,
          width: rect.width,
          height: rect.height,
        };
      }),
      action: measure('.action-bar .primary'),
      compareSecondary: measure('.action-bar .secondary'),
      filterChip: measure('.filter-chip'),
      bookingField: measure('.booking-field'),
      photographs: Array.from(
        document.querySelectorAll<HTMLImageElement>('img[src^="data:image/jpeg"]'),
      ).map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.width,
        height: image.height,
        objectFit: getComputedStyle(image).objectFit,
        mode: image.getAttribute('data-mini-image-mode'),
        naturalRatio: image.naturalWidth / image.naturalHeight,
      })),
    };
  });
  expect(metrics.fontFamily).toContain('Noto Sans CJK SC');
  // Other measured screens keep the previous shared header until their own rebuild slice lands.
  if (group !== 'home') expect(metrics.header?.height).toBe(84);
  expect(metrics.duplicateNativeHeader).toBe(0);
  expect(metrics.statusBars).toBe(1);
  if (scenario.startsWith('c11-')) {
    const minimumPhotos: Record<string, number> = {
      home: 0,
      // UI002 draws these screens with vector icons. The player profile still uses one photograph.
      players: 0,
      player: 1,
      compare: 0,
      'booking-create': 0,
      bookings: 0,
    };
    expect(metrics.photographs.length).toBeGreaterThanOrEqual(minimumPhotos[group]);
    expect(
      metrics.photographs.every(
        (photo) =>
          photo.loaded &&
          photo.width > 0 &&
          photo.height > 0 &&
          (photo.mode === 'widthFix'
            ? Math.abs(photo.width / photo.height - photo.naturalRatio) < 0.01
            : photo.objectFit === 'cover'),
      ),
    ).toBe(true);
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
    if (!['player', 'booking-create', 'bookings', 'players', 'compare'].includes(group)) {
      expect(metrics.action?.x).toBe(12);
      expect(metrics.action?.width).toBe(width - 24);
    }
    if (group !== 'bookings') expect(metrics.action?.height).toBeGreaterThanOrEqual(48);
    if (group === 'players') {
      expect(metrics.action?.x).toBe(16);
      expect(metrics.action?.width).toBe(width - 32);
      expect(metrics.action?.radius).toBe(12);
      expect(metrics.action?.background).toBe('rgb(18, 60, 115)');
      expect(metrics.filterChip?.x).toBe(16);
      expect(metrics.filterChip?.height).toBe(44);
      expect(metrics.portrait?.width).toBe(22);
      expect(metrics.portrait?.height).toBe(22);
    } else if (group === 'compare') {
      const buttonWidth = (width - 32 - 12) / 2;
      expect(metrics.compareSecondary?.x).toBe(16);
      expect(metrics.compareSecondary?.width).toBeCloseTo(buttonWidth, 1);
      expect(metrics.action?.x).toBeCloseTo(16 + buttonWidth + 12, 1);
      expect(metrics.action?.width).toBeCloseTo(buttonWidth, 1);
      expect(metrics.compareSecondary?.height).toBeGreaterThanOrEqual(48);
      expect(metrics.wrappedMetricLabels).toEqual([]);
    } else if (group === 'player') {
      // UI001 T07 replaces the C11 photograph hero with a compact identity card.
      expect(metrics.profileHero).toBeNull();
      expect(metrics.header?.background).toBe('rgb(255, 255, 255)');
      for (const card of [
        metrics.profileIdentity,
        metrics.profileSamples,
        metrics.profileAvailability,
        metrics.profileQuote,
      ]) {
        expect(card?.x).toBe(16);
        expect(card?.width).toBe(width - 32);
        expect(card?.radius).toBe(16);
        expect(card?.padding).toBe(16);
      }
      expect(metrics.profileIdentity?.height).toBeGreaterThanOrEqual(126);
      if (width >= 390) expect(metrics.profileIdentity?.height).toBe(126);
      expect(metrics.profileAvatar?.width).toBe(64);
      expect(metrics.profileAvatar?.height).toBe(64);
      expect(metrics.profilePortrait?.width).toBe(64);
      expect(metrics.profilePortrait?.height).toBe(64);
      expect(metrics.profileName?.fontSize).toBe(24);
      expect(metrics.profileName?.lineHeight).toBe(34);
      expect(metrics.profileMeta?.fontSize).toBe(12);
      expect(metrics.profileMeta?.lineHeight).toBe(18);
      expect(metrics.profileSamples?.height).toBe(86);
      expect(metrics.profileFactCount).toBe(2);
      expect(metrics.profileMetric?.fontSize).toBe(24);
      expect(metrics.profileMetric?.lineHeight).toBe(32);
      expect(metrics.profileAvailability?.height).toBeGreaterThanOrEqual(112);
      for (const amount of [metrics.profileQuotePrice, metrics.profileQuoteTotal]) {
        expect(amount?.fontSize).toBe(14);
        expect(amount?.lineHeight).toBe(22);
      }
      expect(metrics.profileFooter?.height).toBe(88);
      expect(metrics.profileFooter?.background).toBe('rgb(255, 255, 255)');
      expect(metrics.profileSecondary?.x).toBe(16);
      expect(metrics.action?.x).toBe(width / 2 + 6);
      for (const button of [metrics.profileSecondary, metrics.action]) {
        expect(button?.width).toBe((width - 44) / 2);
        expect(button?.height).toBe(48);
        expect(button?.radius).toBe(12);
      }
      expect(metrics.profileSecondary?.background).toBe('rgb(234, 240, 248)');
      expect(metrics.action?.background).toBe('rgb(18, 60, 115)');
    } else if (group === 'booking-create') {
      expect(metrics.scopeRail?.height).toBe(44);
      expect(metrics.bookingField?.height).toBeGreaterThanOrEqual(74);
      expect(metrics.bookingField?.x).toBe(16);
      expect(metrics.bookingField?.width).toBe(width - 32);
      expect(metrics.action?.x).toBe(16);
      expect(metrics.action?.width).toBe(width - 32);
      expect(metrics.action?.radius).toBe(12);
      expect(metrics.action?.background).toBe('rgb(18, 60, 115)');
    } else if (group === 'bookings') {
      expect(metrics.orderTabs?.height).toBeGreaterThanOrEqual(44);
      expect(metrics.orderCard?.x).toBe(16);
      expect(metrics.orderCard?.width).toBe(width - 32);
      expect(metrics.orderCard?.radius).toBe(16);
      expect(metrics.orderMore.length).toBe(2);
      // An icon, not a text glyph, with a 44px target.
      expect(
        metrics.orderMore.every(
          (button) =>
            button.text === '' && button.icons === 1 && button.width >= 44 && button.height >= 44,
        ),
      ).toBe(true);
    }
  }
  return {
    source:
      group === 'home' ? 'latest:UI006:35:38/59:54' : group === 'player' ? 'UI001:T07' : 'approved:C11',
    group,
    ...metrics,
  };
}

test.describe('原生 WXML/WXSS 静态兼容布局（非微信运行时或真机验收）', () => {
  // This matrix owns its widths. Existing mobile-project web application tests
  // still run; repeating these same native-source previews adds no coverage.
  test.skip(({ isMobile }) => Boolean(isMobile), 'Explicit three-width desktop matrix');
  test.use({ deviceScaleFactor: 1 });

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
        if (scenario.filled && !scenario.static && (!scenario.state || scenario.state === 'ready'))
          await expect(frame.locator('body')).toContainText('合成');
        for (const text of scenario.expectText || [])
          await expect(frame.locator('body')).toContainText(text);
        for (const text of scenario.expectAbsentText || [])
          await expect(frame.locator('body')).not.toContainText(text);
        for (const name of scenario.expectDisabled || [])
          await expect(frame.getByRole('button', { name, exact: true }).first()).toBeDisabled();
        for (const name of scenario.expectEnabled || [])
          await expect(frame.getByRole('button', { name, exact: true }).first()).toBeEnabled();
        if (scenario.name === 'ui002-services-player-large' && width === 390) {
          const service = frame.locator('.profile-quote .quote-service');
          const previousStyle = await service.evaluate((element) => {
            const prior = element.getAttribute('style');
            // The new T07 uses 14px fee rows. Force an insufficient column,
            // rather than relying on the superseded C11 140px/big-price layout.
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
          await expect(frame.locator('.member-table-row')).toHaveCount(3);
          const clippedLabels = await frame.locator('.member-table-row').evaluateAll((rows) =>
            rows.flatMap((row) =>
              Array.from(row.children)
                .filter((cell) => ['本届设置', '已保存'].includes(cell.textContent?.trim() || ''))
                .filter((cell) => {
                  const style = getComputedStyle(cell);
                  const range = document.createRange();
                  range.selectNodeContents(cell);
                  const available =
                    cell.clientWidth -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight);
                  return (
                    range.getClientRects().length !== 1 ||
                    range.getBoundingClientRect().width > available + 1
                  );
                })
                .map((cell) => cell.textContent),
            ),
          );
          expect(clippedLabels, 'member status labels must fit on one line').toEqual([]);
        }
        await attachScreen(page, testInfo, 'native-top.png');
        const designGeometry = await checkDesignGeometry(frame, scenario.name, width);
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
