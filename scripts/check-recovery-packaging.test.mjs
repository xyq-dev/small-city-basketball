import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// Walk actual relative script imports from the shipped recovery entry point.
// Catch helpers excluded from the build context before an expensive image build.
test('the isolated tools image includes every transitive recovery helper', async () => {
  const root = new URL('../', import.meta.url);
  const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8');
  const ignored = (await readFile(new URL('.dockerignore', root), 'utf8')).split(/\r?\n/);
  const included = new Set(
    dockerfile
      .split(/\r?\n/)
      .filter((line) => line.startsWith('COPY ') && line.endsWith('./scripts/'))
      .flatMap((line) => line.split(/\s+/).slice(1, -1)),
  );
  const pending = ['scripts/check-database-restart.mjs'],
    seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(included.has(file), 'missing image COPY: ' + file);
    assert.ok(ignored.includes('!' + file), 'excluded build context: ' + file);
    const code = await readFile(new URL(file, root), 'utf8');
    for (const match of code.matchAll(/(?:from\s+|import\s*\()['"]\.\/([^'"]+\.mjs)['"]/g))
      pending.push('scripts/' + match[1]);
  }
  assert.ok(seen.has('scripts/r6-recovery-check.mjs'));
  assert.ok(seen.has('scripts/r6-recovery-training.mjs'));
});
