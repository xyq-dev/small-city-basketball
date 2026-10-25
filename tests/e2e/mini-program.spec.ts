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
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  pages: string[];
};
const fixtureDirectory = path.resolve(__dirname, '../mini-program/fixtures');
const scenarios: Scenario[] = [
  ...manifest.pages.map((route) => ({
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
    return {
      innerWidth: window.innerWidth,
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      contentHeight: document.documentElement.scrollHeight,
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

// C11 replaces the earlier four-screen C09 targets with the user's explicitly
// approved six-screen image. Geometry and real asset loading are checked in
// addition to the unchanged overflow/touch/readability matrix.
async function checkDesignGeometry(frame: Frame, scenario: string, width: number) {
  const groups: Record<string, string> = {
    'initial-home': 'home',
    'c10-core-home-ready': 'home',
    'c11-home-ready': 'home',
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
        background: style.backgroundColor,
      };
    };
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      header: measure('.scb-header'),
      duplicateNativeHeader: document.querySelectorAll('.mini-native-bar').length,
      statusBars: document.querySelectorAll('.mini-custom-status').length,
      hero: measure('.home-hero'),
      homeAction: measure('.home-primary'),
      search: measure('.market-search'),
      playerCard: measure('.player-card'),
      portrait: measure('.player-portrait'),
      metricColumn: measure('.metric-labels'),
      playerColumn: measure('.compare-column'),
      tableHead: measure('.comparison-head'),
      tableCell: measure('.comparison-cell'),
      columns: document.querySelectorAll('.compare-column').length,
      profileHero: measure('.profile-hero'),
      profileQuote: measure('.profile-quote'),
      scopeRail: measure('.scope-rail'),
      selectedPlayer: measure('.selected-player'),
      arrangement: measure('.arrangement-summary'),
      orderCard: measure('.booking-order-card'),
      orderTabs: measure('.booking-view-tabs'),
      action: measure('.action-bar > .primary'),
      photographs: Array.from(
        document.querySelectorAll<HTMLImageElement>('img[src^="data:image/jpeg"]'),
      ).map((image) => ({
        loaded: image.complete && image.naturalWidth > 0,
        width: image.width,
        height: image.height,
        objectFit: getComputedStyle(image).objectFit,
      })),
    };
  });
  expect(metrics.fontFamily).toContain('Noto Sans CJK SC');
  expect(metrics.header?.height).toBe(80);
  expect(metrics.duplicateNativeHeader).toBe(0);
  expect(metrics.statusBars).toBe(1);
  if (scenario.startsWith('c11-')) {
    const minimumPhotos: Record<string, number> = {
      home: 1,
      players: 2,
      player: 1,
      compare: 2,
      'booking-create': 1,
      bookings: 2,
    };
    expect(metrics.photographs.length).toBeGreaterThanOrEqual(minimumPhotos[group]);
    expect(
      metrics.photographs.every(
        (photo) =>
          photo.loaded && photo.width > 0 && photo.height > 0 && photo.objectFit === 'cover',
      ),
    ).toBe(true);
  }
  if (group === 'home') {
    expect(metrics.hero?.width).toBe(width);
    expect(metrics.hero?.height).toBe(width <= 360 ? 400 : 430);
    expect(metrics.homeAction?.width).toBe(214);
    expect(metrics.homeAction?.height).toBe(52);
    expect(metrics.homeAction?.background).toBe('rgb(255, 107, 45)');
  } else {
    expect(metrics.action?.x).toBe(12);
    expect(metrics.action?.width).toBe(width - 24);
    expect(metrics.action?.height).toBeGreaterThanOrEqual(48);
    if (group === 'players') {
      expect(metrics.search?.x).toBe(12);
      expect(metrics.search?.y).toBe(92);
      expect(metrics.search?.height).toBe(44);
      expect(metrics.playerCard?.x).toBe(12);
      expect(metrics.playerCard?.y).toBe(196);
      expect(metrics.playerCard?.width).toBe(width - 24);
      expect(metrics.playerCard?.radius).toBe(12);
      expect(metrics.portrait?.width).toBe(width <= 360 ? 76 : 94);
    } else if (group === 'compare') {
      const metricWidth = width <= 360 ? 94 : 100;
      expect(metrics.metricColumn?.width).toBe(metricWidth);
      const expected = metrics.columns === 2 ? (width - 24 - metricWidth) / 2 : 125;
      expect(metrics.playerColumn?.width).toBeCloseTo(expected, 1);
      expect(metrics.tableHead?.height).toBe(204);
      expect(metrics.tableCell?.height).toBe(38);
    } else if (group === 'player') {
      expect(metrics.profileHero?.height).toBe(width <= 360 ? 240 : 260);
      expect(metrics.profileQuote?.x).toBe(12);
      expect(metrics.profileQuote?.width).toBe(width - 24);
      expect(metrics.action?.background).toBe('rgb(255, 107, 45)');
    } else if (group === 'booking-create') {
      expect(metrics.scopeRail?.height).toBe(44);
      expect(metrics.selectedPlayer?.height).toBeGreaterThanOrEqual(84);
      expect(metrics.arrangement?.x).toBe(12);
      expect(metrics.arrangement?.width).toBe(width - 24);
      expect(metrics.action?.background).toBe('rgb(255, 107, 45)');
    } else if (group === 'bookings') {
      expect(metrics.orderTabs?.height).toBe(44);
      expect(metrics.orderCard?.x).toBe(12);
      expect(metrics.orderCard?.width).toBe(width - 24);
      expect(metrics.orderCard?.radius).toBe(12);
    }
  }
  return { source: 'approved:C11', group, ...metrics };
}

test.describe('原生 WXML/WXSS 静态兼容布局（非微信运行时或真机验收）', () => {
  // This matrix owns its widths. Existing mobile-project web application tests
  // still run; repeating these same native-source previews adds no coverage.
  test.skip(({ isMobile }) => Boolean(isMobile), 'Explicit three-width desktop matrix');
  test.use({ deviceScaleFactor: 1 });

  for (const width of [320, 390, 430]) {
    for (const scenario of scenarios) {
      test(`${width}px · ${scenario.name}`, async ({ page, context }, testInfo) => {
        expect(manifest.pages).toContain(scenario.route);
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
        const layout = await measureLayout(frame);
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
        await attachScreen(page, testInfo, 'native-top.png');

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
