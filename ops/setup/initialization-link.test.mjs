import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { privateInitializationInvocation, runInitializationLink } from './initialization-link.mjs';

const privateFile = '/srv/scb/production.env';
const interactive = { args: [privateFile], stdinIsTTY: true, stdoutIsTTY: true, ci: '' };

test('host refuses CI and piped terminal surfaces before invoking Docker or reading a file', () => {
  for (const changes of [
    { stdinIsTTY: false },
    { stdoutIsTTY: false },
    { stdinIsTTY: false, stdoutIsTTY: false },
    { ci: 'true' },
    { ci: 'false' },
  ]) {
    let touched = false;
    assert.throws(() =>
      runInitializationLink({
        ...interactive,
        ...changes,
        env: { CI: changes.ci ?? '' },
        inspectFile() {
          touched = true;
        },
        launch() {
          touched = true;
        },
      }),
    );
    assert.equal(touched, false);
  }
});

test('host accepts only the deployment file path and fixed link-delivery invocation', () => {
  const invocation = privateInitializationInvocation(interactive);
  assert.deepEqual(invocation, [
    'compose',
    '--env-file',
    privateFile,
    '-p',
    'scb',
    '-f',
    'compose.production.yaml',
    '--profile',
    'ops',
    'run',
    '--rm',
    '--no-deps',
    'initialization-link',
  ]);
  for (const args of [[], ['relative.env'], [privateFile, '--anything'], ['/srv/\nenv']])
    assert.throws(() => privateInitializationInvocation({ ...interactive, args }));
});

test('private delivery inherits terminal streams without capturing output', () => {
  let calls = 0;
  runInitializationLink({
    ...interactive,
    env: {},
    inspectFile() {
      return { isFile: () => true, mode: 0o100600 };
    },
    launch(command, args, options) {
      calls += 1;
      assert.equal(command, 'docker');
      assert.equal(args.at(-1), 'initialization-link');
      assert.equal(options.stdio, 'inherit');
      return { status: 0 };
    },
  });
  assert.equal(calls, 1);
});

test('public or symbolic-link environment files are rejected before invoking Docker', () => {
  for (const file of [
    { isFile: () => true, mode: 0o100644 },
    { isFile: () => false, mode: 0o120600 },
  ]) {
    let called = false;
    assert.throws(() =>
      runInitializationLink({
        ...interactive,
        env: {},
        inspectFile: () => file,
        launch() {
          called = true;
        },
      }),
    );
    assert.equal(called, false);
  }
});

test('actual piped host invocation exits before Docker and prints only fixed failure', () => {
  const result = spawnSync(
    process.execPath,
    [new URL('./initialization-link.mjs', import.meta.url).pathname, privateFile],
    { encoding: 'utf8', env: { ...process.env, CI: '' } },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Initialization link delivery requires a private terminal and valid deployment\n',
  );
});
