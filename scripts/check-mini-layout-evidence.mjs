import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Check files produced by the actual Chromium run, not in-memory attachments.
// These are compatibility layouts with synthetic data, never WeChat acceptance.
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/wechat/app.json'), 'utf8'));
const scenarios = new Map(manifest.pages.map((route) => ['initial-' + route.split('/')[1], route]));
const fixtures = path.join(root, 'tests/mini-program/fixtures');
for (const file of fs.readdirSync(fixtures).filter((file) => file.endsWith('.json'))) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
  assert.ok(!scenarios.has(fixture.name), 'Duplicate native layout scenario');
  assert.ok(manifest.pages.includes(fixture.route), 'Unregistered native fixture route');
  scenarios.set(fixture.name, fixture.route);
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
      found.add(key);
    }
  }
}
inspect(path.join(root, 'test-results'));
assert.deepEqual([...found].sort(), [...expected].sort(), 'Missing native PNG/JSON evidence');
console.log(
  'Native compatibility evidence: ' + found.size + ' layouts and PNGs; not WeChat runtime.',
);
