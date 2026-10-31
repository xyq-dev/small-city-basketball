const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Native WXML control attributes require explicit data bindings. Our preview
// evaluator also accepts bare expressions, so rendered screenshots cannot catch
// this source mismatch with the native compiler by themselves.
test('all shipped native conditional and list directives use explicit data bindings', () => {
  const root = path.resolve(__dirname, '..');
  let controls = 0;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(file);
      else if (entry.name.endsWith('.wxml')) {
        const source = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const match of source.matchAll(/\bwx:(if|elif|for)\s*=\s*(["'])([\s\S]*?)\2/g)) {
          controls++;
          assert.match(
            match[3],
            /^\{\{[\s\S]+\}\}$/,
            path.relative(root, file) + ': wx:' + match[1],
          );
        }
      }
    }
  }
  inspect(path.join(root, 'pages'));
  inspect(path.join(root, 'components'));
  assert.ok(controls > 100, 'Expected the actual shipped project, not a small fixture');
});
