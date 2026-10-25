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

// Geometry here is measured against the original 390px Figma frames. The
// existing overflow/touch matrix still owns all three adaptive viewport widths.
async function checkDesignGeometry(frame: Frame, scenario: string, width: number) {
  scenario =
    (
      {
        'c10-core-home-ready': 'initial-home',
        'c10-core-players-ready': 'players-collapsed',
        'c10-core-compare-ready': 'compare-three',
      } as Record<string, string>
    )[scenario] || scenario;
  const supported = ['initial-home', 'players-collapsed', 'compare-three'];
  if (!supported.includes(scenario)) return null;
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
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        radius: Number.parseFloat(style.borderTopLeftRadius),
      };
    };
    return {
      fontFamily: getComputedStyle(document.body).fontFamily,
      hero: measure('.home-hero'),
      heroTitle: measure('.home-hero .title'),
      homeAction: measure('.home-page > .accent'),
      homeCard: measure('.home-card'),
      marketIntro: measure('.market-intro'),
      filterToggle: measure('.filter-toggle'),
      playerCard: measure('.player-card'),
      playerName: measure('.player-name'),
      metricColumn: measure('.metric-labels'),
      playerColumn: measure('.compare-column'),
      tableCell: measure('.comparison-cell'),
      action: measure('.action-bar > .primary'),
    };
  });
  expect(metrics.fontFamily).toContain('Noto Sans CJK SC');
  if (scenario === 'initial-home') {
    expect(metrics.hero?.x).toBe(20);
    expect(metrics.hero?.width).toBe(width - 40);
    expect(metrics.heroTitle?.fontSize).toBe(22);
    expect(metrics.heroTitle?.lineHeight).toBe(34);
    expect(metrics.homeAction?.width).toBe(width - 40);
    expect(metrics.homeAction?.height).toBe(44);
    expect(metrics.homeCard?.radius).toBe(16);
    if (width === 390) {
      expect(metrics.hero?.y).toBe(116);
      expect(metrics.hero?.height).toBe(118);
      expect(metrics.homeAction?.y).toBe(250);
      expect(metrics.homeCard?.y).toBe(310);
      expect(metrics.homeCard?.height).toBe(124);
    }
  } else {
    expect(metrics.action?.x).toBe(20);
    expect(metrics.action?.width).toBe(width - 40);
    expect(metrics.action?.height).toBe(44);
    if (scenario === 'players-collapsed') {
      expect(metrics.marketIntro?.height).toBeGreaterThanOrEqual(80);
      expect(metrics.filterToggle?.height).toBe(44);
      expect(metrics.playerCard?.radius).toBe(16);
      expect(metrics.playerName?.fontSize).toBe(18);
      expect(metrics.playerName?.lineHeight).toBe(28);
      if (width === 390) {
        expect(metrics.marketIntro?.height).toBe(80);
        expect(metrics.playerCard?.y).toBe(332);
      }
    } else {
      expect(metrics.metricColumn?.width).toBe(100);
      expect(metrics.playerColumn?.width).toBe(125);
      expect(metrics.tableCell?.height).toBe(56);
      expect(metrics.tableCell?.fontSize).toBe(12);
    }
  }
  return metrics;
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
            await frame.evaluate(() => window.scrollTo(0, 0));
            const fullPath = testInfo.outputPath('native-full.png');
            await frame.locator('body').screenshot({ path: fullPath, animations: 'disabled' });
            await testInfo.attach('native-full.png', { path: fullPath, contentType: 'image/png' });
          }
        }
      });
    }
  }
});
