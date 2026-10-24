import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Frame, Page, TestInfo } from '@playwright/test';

type Scenario = { name: string; route: string; data: Record<string, unknown>; filled: boolean };
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
      const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, file), 'utf8')) as {
        name: string;
        route: string;
        data: Record<string, unknown>;
      };
      if (
        !/^[a-z0-9-]+$/.test(fixture.name) ||
        !/^pages\/[a-z0-9-]+\/index$/.test(fixture.route) ||
        !fixture.data ||
        typeof fixture.data !== 'object' ||
        Array.isArray(fixture.data)
      )
        throw new Error('Invalid synthetic mini-program fixture: ' + file);
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
  await testInfo.attach(name, {
    body: await page.locator('iframe.preview-frame').screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
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
        if (scenario.filled) await expect(frame.locator('body')).toContainText('合成');
        const layout = await measureLayout(frame);
        await testInfo.attach('native-layout.json', {
          body: Buffer.from(
            JSON.stringify(
              { route: scenario.route, scenario: scenario.name, width, ...layout },
              null,
              2,
            ),
          ),
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

        if (scenario.name === 'compare-three') {
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
        }
      });
    }
  }
});
