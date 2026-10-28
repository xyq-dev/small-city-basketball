// Renders the project-authored SVG icon sources into the transparent PNGs used by scb-icon.
// The WeChat image component is not assumed to display SVG, so runtime assets stay PNG.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = path.join(ROOT, 'tools/wechat-icons/src');
const OUTPUT = path.join(ROOT, 'apps/wechat/assets/approved-ui');
// Existing palette only: content, accent, inactive navigation, dark backgrounds, success.
export const TONES = {
  navy: '#132c49',
  orange: '#ff6b2d',
  gray: '#617286',
  white: '#ffffff',
  green: '#16a575',
};
export const PIXELS = 120;

export function iconNames(source = SOURCE) {
  return fs
    .readdirSync(source)
    .filter((file) => /^[a-z][a-z-]*\.svg$/.test(file))
    .map((file) => file.slice(0, -4))
    .sort();
}

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: PIXELS, height: PIXELS },
      deviceScaleFactor: 1,
    });
    let written = 0;
    for (const name of iconNames()) {
      const svg = fs.readFileSync(path.join(SOURCE, name + '.svg'), 'utf8');
      for (const [tone, color] of Object.entries(TONES)) {
        await page.setContent(
          '<!doctype html><style>html,body{margin:0;background:transparent}' +
            'svg{display:block;width:' +
            PIXELS +
            'px;height:' +
            PIXELS +
            'px;color:' +
            color +
            '}</style>' +
            svg,
        );
        await page.screenshot({
          path: path.join(OUTPUT, 'icon-' + name + '-' + tone + '.png'),
          omitBackground: true,
        });
        written++;
      }
    }
    console.log('icons written: ' + written);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
