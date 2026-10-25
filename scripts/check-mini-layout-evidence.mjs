import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Check files produced by the actual Chromium run, not in-memory attachments.
// These are compatibility layouts with synthetic data, never WeChat acceptance.
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/wechat/app.json'), 'utf8'));
const scenarios = new Map(manifest.pages.map((route) => ['initial-' + route.split('/')[1], route]));
const filledScenarios = new Set();
const fixtures = path.join(root, 'tests/mini-program/fixtures');
for (const file of fs.readdirSync(fixtures).filter((file) => file.endsWith('.json'))) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
  assert.ok(!scenarios.has(fixture.name), 'Duplicate native layout scenario');
  assert.ok(manifest.pages.includes(fixture.route), 'Unregistered native fixture route');
  scenarios.set(fixture.name, fixture.route);
  filledScenarios.add(fixture.name);
}
const widths = [320, 390, 430];
const expected = new Set(
  widths.flatMap((width) => [...scenarios.keys()].map((s) => width + ':' + s)),
);
const found = new Set();
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.isFile() && entry.name === 'native-layout.json') {
      const result = JSON.parse(fs.readFileSync(file, 'utf8'));
      const key = result.width + ':' + result.scenario;
      assert.ok(expected.has(key), 'Unexpected native layout output: ' + key);
      assert.ok(!found.has(key), 'Duplicate native layout output: ' + key);
      assert.equal(result.route, scenarios.get(result.scenario));
      assert.equal(result.innerWidth, result.width);
      for (const name of ['overflow', 'smallButtons', 'unreadableFields'])
        assert.deepEqual(result[name], [], 'Failed native layout: ' + key + ' / ' + name);
      const png = fs.readFileSync(path.join(directory, 'native-top.png'));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Missing PNG signature');
      assert.equal(png.readUInt32BE(16), result.width, 'Wrong native screenshot width');
      assert.equal(png.readUInt32BE(20), 844, 'Wrong native screenshot height');
      if (
        result.width === 390 &&
        filledScenarios.has(result.scenario) &&
        result.contentHeight > 844
      ) {
        const segments = JSON.parse(
          fs.readFileSync(path.join(directory, 'native-scroll-segments.json'), 'utf8'),
        );
        assert.equal(segments.route, result.route);
        assert.equal(segments.scenario, result.scenario);
        assert.equal(segments.width, 390);
        assert.equal(segments.viewportHeight, 844);
        assert.equal(segments.step, 600);
        assert.equal(segments.maxScroll, result.contentHeight - 844);
        assert.deepEqual(segments.top, { file: 'native-top.png', scrollY: 0 });
        assert.deepEqual(segments.bottom, {
          file: 'native-bottom.png',
          scrollY: segments.maxScroll,
        });
        const expectedSegments = [];
        for (let y = 600; y < segments.maxScroll; y += 600) {
          const file = `native-segment-${String(expectedSegments.length + 1).padStart(2, '0')}.png`;
          expectedSegments.push({ file, scrollY: y });
          const image = fs.readFileSync(path.join(directory, file));
          assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.equal(image.readUInt32BE(16), 390);
          assert.equal(image.readUInt32BE(20), 844);
        }
        assert.deepEqual(
          segments.segments,
          expectedSegments,
          'Long-page viewport coverage must be complete',
        );
        assert.ok(
          !fs.existsSync(path.join(directory, 'native-full.png')),
          'Do not deliver iframe-clipped full images',
        );
      }
      found.add(key);
    }
  }
}
inspect(path.join(root, 'test-results'));
assert.deepEqual([...found].sort(), [...expected].sort(), 'Missing native PNG/JSON evidence');
console.log(
  'Native compatibility evidence: ' + found.size + ' layouts and PNGs; not WeChat runtime.',
);
