import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Validate the host terminal before starting a TTY-enabled container. */
export function privateInitializationInvocation({ args, stdinIsTTY, stdoutIsTTY, ci }) {
  if (!stdinIsTTY || !stdoutIsTTY || ci)
    throw new Error('Initialization links require a private interactive terminal outside CI');
  if (
    args.length !== 1 ||
    typeof args[0] !== 'string' ||
    !path.isAbsolute(args[0]) ||
    /[\r\n\0]/.test(args[0])
  )
    throw new Error('Provide the absolute private deployment environment file path');
  return [
    'compose',
    '--env-file',
    args[0],
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
  ];
}

export function runInitializationLink({
  args = process.argv.slice(2),
  stdinIsTTY = process.stdin.isTTY,
  stdoutIsTTY = process.stdout.isTTY,
  env = process.env,
  inspectFile = lstatSync,
  launch = spawnSync,
} = {}) {
  const invocation = privateInitializationInvocation({
    args,
    stdinIsTTY,
    stdoutIsTTY,
    ci: env.CI,
  });
  const file = inspectFile(args[0]);
  if (!file.isFile() || ![0o400, 0o600].includes(file.mode & 0o7777))
    throw new Error('Deployment environment requires a private regular file');
  const result = launch('docker', invocation, { cwd: root, stdio: 'inherit', env });
  if (result.error || result.signal || result.status !== 0)
    throw new Error('Initialization link delivery failed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runInitializationLink();
  } catch {
    // Never capture/reprint child output: it may contain the one-time URL.
    console.error('Initialization link delivery requires a private terminal and valid deployment');
    process.exitCode = 1;
  }
}
