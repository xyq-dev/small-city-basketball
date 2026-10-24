#!/usr/bin/env node
// Static layout aid using the real WXML/WXSS. It is not a WeChat runtime.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildPreview } = require('../apps/wechat/test/helpers/native-preview.cjs');
const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const at = item.indexOf('=');
    if (!item.startsWith('--') || at < 0) throw new Error('Use --name=value arguments');
    return [item.slice(2, at), item.slice(at + 1)];
  }),
);
for (const key of Object.keys(args)) {
  if (!['root', 'page', 'data', 'out', 'width', 'height'].includes(key))
    throw new Error('Unknown option: ' + key);
}
const root = path.resolve(args.root || 'apps/wechat');
const route = args.page?.startsWith('pages/')
  ? args.page
  : 'pages/' + (args.page || 'home') + '/index';
const data = args.data ? JSON.parse(fs.readFileSync(path.resolve(args.data), 'utf8')) : {};
const result = buildPreview({
  root,
  route,
  data,
  width: Number(args.width || 390),
  height: Number(args.height || 844),
});
if (args.out) {
  const target = path.resolve(args.out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, result.html);
  process.stdout.write(
    JSON.stringify({
      output: target,
      route,
      width: result.width,
      height: result.height,
      assets: result.assets,
      compatibilityPreviewOnly: true,
    }) + '\n',
  );
} else process.stdout.write(result.html);
