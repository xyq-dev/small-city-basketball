const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const unused = [
  'assets/approved-ui/court-night.jpg',
  'assets/approved-ui/player-sample-a.jpg',
  'assets/approved-ui/player-sample-b.jpg',
  'assets/approved-ui/player-sample-a-hero.jpg',
  'assets/approved-ui/player-sample-b-hero.jpg',
];

test('preview packaging leaves tests and unused photos in the repo but out of the mini program', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  const ignore = config.packOptions && config.packOptions.ignore;
  assert.ok(Array.isArray(ignore));
  assert.ok(ignore.some((item) => item.type === 'folder' && item.value === 'test'));
  assert.ok(ignore.some((item) => item.type === 'suffix' && item.value === '.md'));
  for (const file of unused) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
    assert.ok(
      ignore.some((item) => item.type === 'file' && item.value === file),
      file,
    );
  }
  const runtime = [];
  for (const dir of ['pages', 'components', 'utils']) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (typeof file === 'string' && /\.(js|wxml|wxss|json)$/.test(file))
        runtime.push(path.join(root, dir, file));
    }
  }
  runtime.push(path.join(root, 'app.js'), path.join(root, 'app.json'));
  const names = unused.map((file) => path.basename(file)).join('|');
  const pattern = new RegExp(names);
  for (const file of runtime) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), pattern, file);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /(?:^|[^A-Za-z])test\//);
  }
});
