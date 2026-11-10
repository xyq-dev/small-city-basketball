import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./run-api-browser-checks.mjs', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));
const secret = 'synthetic-secret-must-not-be-logged';
const control = `postgresql://synthetic:${secret}@127.0.0.1:5432/scb_test_guard`;
function list(suite, target, nodeEnv = 'test') {
  const result = spawnSync(
    process.execPath,
    [script, `--suite=${suite}`, '--list', '--project=desktop-api'],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: target, NODE_ENV: nodeEnv },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined, 'The fixed inspection command must terminate normally');
  const output = result.stdout + result.stderr;
  assert.ok(!output.includes(secret), 'Inspection must never print supplied credentials');
  return { ...result, output };
}

for (const suite of ['membership', 'account-security']) {
  test(`${suite} rejects host overrides and fragments before pool creation or child configuration`, () => {
    for (const target of [
      control.replace('127.0.0.1', 'example.invalid'),
      `${control}?host=example.invalid`,
      `${control}#unexpected`,
    ]) {
      const result = list(suite, target);
      assert.equal(result.status, 1);
      assert.match(result.output, /API browser checks require DATABASE_URL naming an isolated/);
      assert.doesNotMatch(result.output, /API browser setup\/cleanup failed|Listing tests/);
    }
  });
}

test('membership inspection rejects production before invoking Playwright', () => {
  const result = list('membership', control, 'production');
  assert.equal(result.status, 1);
  assert.match(result.output, /API browser checks require DATABASE_URL naming an isolated/);
  assert.doesNotMatch(result.output, /Listing tests/);
});

test('membership can list its fixed test on a canonical loopback target without connecting to PostgreSQL', () => {
  const result = list('membership', control);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Listing tests:/);
  assert.match(result.output, /membership\.spec\.ts/);
  assert.doesNotMatch(
    result.output,
    /isolated database|removed owned database|setup\/cleanup failed/,
  );
});
