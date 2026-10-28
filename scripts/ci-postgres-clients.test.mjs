import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isolatedDatabaseUrl, pgClientScript } from './prepare-ci-postgres-clients.mjs';

test('archive client wrappers preserve argument boundaries and expose only their owned directory', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'scb-pg-wrapper-test-'));
  try {
    const capture = path.join(directory, 'capture.json');
    const docker = path.join(directory, 'docker');
    writeFileSync(
      docker,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2), password:process.env.PGPASSWORD}));\n`,
    );
    chmodSync(docker, 0o700);
    const workspace = path.join(directory, "owned quote' and spaces");
    for (const tool of ['pg_dump', 'pg_restore']) {
      const wrapper = path.join(directory, tool);
      writeFileSync(wrapper, pgClientScript(tool, workspace, 1001, 1001), { mode: 0o700 });
      const file = path.join(workspace, "archive '$() name.dump");
      const input = ['--dbname', 'postgresql://127.0.0.1/scb_test_fixture', '--file', file];
      const result = spawnSync(wrapper, input, {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          CAPTURE: capture,
          PGPASSWORD: 'synthetic-private-test-password',
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const called = JSON.parse(readFileSync(capture, 'utf8'));
      assert.deepEqual(called.args.slice(-input.length), input);
      assert.equal(called.args.filter((arg) => arg === '--mount').length, 1);
      assert.equal(
        called.args[called.args.indexOf('--mount') + 1],
        `type=bind,src=${workspace},dst=${workspace}`,
      );
      assert.equal(called.args[called.args.indexOf('--entrypoint') + 1], tool);
      assert.equal(called.args[called.args.indexOf('--user') + 1], '1001:1001');
      assert.ok(called.args.includes('postgres:18.6-alpine3.24'));
      assert.ok(called.args.includes('PGPASSWORD'));
      assert.equal(called.password, 'synthetic-private-test-password');
      assert.ok(!called.args.join(' ').includes(called.password));
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('client wrapper rejects non-archive commands, ambiguous mounts and root execution', () => {
  assert.throws(() => pgClientScript('postgres', '/tmp/owned', 1001, 1001));
  for (const directory of ['relative', '/tmp/a,b', '/tmp/a:b', '/tmp/a\nEVIL=1', '/tmp/../etc'])
    assert.throws(() => pgClientScript('pg_dump', directory, 1001, 1001));
  assert.throws(() => pgClientScript('pg_dump', '/tmp/owned', 0, 0));
});

test('CI role preparation accepts only loopback test database targets', () => {
  assert.equal(
    isolatedDatabaseUrl('postgresql://scb:synthetic@127.0.0.1:5432/scb_test_application').pathname,
    '/scb_test_application',
  );
  for (const value of [
    'postgresql://scb:synthetic@production.invalid/scb_test_application',
    'postgresql://scb:synthetic@127.0.0.1/scb',
    'postgresql://scb@127.0.0.1/scb_test_application',
    'https://scb:synthetic@127.0.0.1/scb_test_application',
    'postgresql://scb:synthetic@127.0.0.1/scb_test_application?host=production.invalid',
  ])
    assert.throws(() => isolatedDatabaseUrl(value));
});
