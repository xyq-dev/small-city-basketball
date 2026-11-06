import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
const { chmod, chown, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } = fs;
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareStorageConfigKey } from './storage-config-key.mjs';

let hostOwnershipSupported = false;
const ownershipProbe = await mkdtemp(path.join(tmpdir(), 'scb-key-owner-test-'));
try {
  await chown(ownershipProbe, 10001, 10001);
  hostOwnershipSupported = process.geteuid?.() === 0;
} catch {
  // Work-mode namespaces may map only uid0; keep the real host check explicit.
} finally {
  await rm(ownershipProbe, { recursive: true, force: true });
}
const hostOnly = {
  skip: !hostOwnershipSupported && 'Host cannot assign uid10001 in this environment',
};
// Exercise real temporary files/atomic links/modes while recording the unavailable host
// ownership syscall at its boundary. The CLI always uses the native filesystem and euid.
function ownershipFixture() {
  const owners = new Map(),
    assigned = [];
  const mapped = (info) =>
    Object.assign(info, { uid: 0, gid: 0 }, owners.get(`${info.dev}:${info.ino}`) ?? {});
  return {
    assigned,
    options: {
      effectiveUid: 0,
      fileSystem: {
        ...fs,
        async lstat(file) {
          const info = await fs.lstat(file);
          if (info.isDirectory()) info.uid = 0;
          return info;
        },
        async open(...args) {
          const handle = await fs.open(...args);
          return {
            stat: async () => mapped(await handle.stat()),
            readFile: (...values) => handle.readFile(...values),
            writeFile: (...values) => handle.writeFile(...values),
            chmod: (...values) => handle.chmod(...values),
            sync: () => handle.sync(),
            close: () => handle.close(),
            async chown(uid, gid) {
              assert.equal(uid, 10001);
              assert.equal(gid, 10001);
              assigned.push([uid, gid]);
              const info = await handle.stat();
              owners.set(`${info.dev}:${info.ino}`, { uid, gid });
            },
          };
        },
      },
    },
  };
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'scb-storage-key-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  return { directory, file: path.join(directory, 'storage_config_key') };
}

test('preparation requests uid10001, creates a private 32-byte key and preserves it on repeat', async (t) => {
  const ownership = ownershipFixture();
  const { directory, file } = await fixture(t);
  assert.deepEqual(await prepareStorageConfigKey(directory, ownership.options), {
    status: 'created',
  });
  const value = await readFile(file, 'utf8');
  assert.match(value, /^[0-9a-f]{64}\n$/);
  const info = await lstat(file);
  assert.deepEqual(ownership.assigned, [[10001, 10001]]);
  assert.equal(info.mode & 0o7777, 0o400);
  assert.equal(info.nlink, 1);
  assert.deepEqual(await prepareStorageConfigKey(directory, ownership.options), {
    status: 'retained',
  });
  assert.equal(await readFile(file, 'utf8'), value);
  assert.deepEqual(await readdir(directory), ['storage_config_key']);
});

test('concurrent preparation publishes one complete key without overwriting', async (t) => {
  const ownership = ownershipFixture();
  const { directory, file } = await fixture(t);
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () => prepareStorageConfigKey(directory, ownership.options)),
  );
  assert.equal(outcomes.filter((item) => item.status === 'created').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'retained').length, 7);
  assert.match(await readFile(file, 'utf8'), /^[0-9a-f]{64}\n$/);
  assert.deepEqual(await readdir(directory), ['storage_config_key']);
});

test('existing malformed, wrongly owned or public files remain untouched', async (t) => {
  const ownership = ownershipFixture();
  for (const kind of ['malformed', 'owner', 'mode']) {
    const { directory, file } = await fixture(t);
    const value = kind === 'malformed' ? 'must-remain-untouched' : 'c'.repeat(64) + '\n';
    await writeFile(file, value, { mode: 0o400 });
    if (kind !== 'owner') {
      const handle = await ownership.options.fileSystem.open(file, 'r');
      await handle.chown(10001, 10001);
      await handle.close();
    }
    if (kind === 'mode') await chmod(file, 0o444);
    await assert.rejects(prepareStorageConfigKey(directory, ownership.options));
    assert.equal(await readFile(file, 'utf8'), value);
  }
});

test('rejects key symlinks, directory symlinks, public directories and unsafe parents', async (t) => {
  const ownership = ownershipFixture();
  const { directory, file } = await fixture(t);
  const target = path.join(directory, 'unrelated-file');
  await writeFile(target, 'untouched');
  await symlink(target, file);
  await assert.rejects(prepareStorageConfigKey(directory, ownership.options));
  assert.equal(await readFile(target, 'utf8'), 'untouched');
  const linked = path.join(directory, 'linked-directory');
  await symlink(directory, linked);
  await assert.rejects(prepareStorageConfigKey(linked, ownership.options));
  const publicDirectory = path.join(directory, 'public');
  await mkdir(publicDirectory, { mode: 0o755 });
  await assert.rejects(prepareStorageConfigKey(publicDirectory, ownership.options));
  const unsafeParent = path.join(directory, 'unsafe');
  await mkdir(unsafeParent, { mode: 0o777 });
  await chmod(unsafeParent, 0o777);
  const child = path.join(unsafeParent, 'private');
  await mkdir(child, { mode: 0o700 });
  await assert.rejects(prepareStorageConfigKey(child, ownership.options));
  assert.deepEqual(await readdir(child), []);
});

test('CLI returns status only and suppresses private path/error details', hostOnly, async (t) => {
  const { directory, file } = await fixture(t);
  const script = new URL('./storage-config-key.mjs', import.meta.url).pathname;
  for (const expected of ['created', 'retained']) {
    const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `Storage configuration key ${expected}\n`);
    assert.equal(result.stderr, '');
    assert.ok(!result.stdout.includes((await readFile(file, 'utf8')).trim()));
  }
  const failure = spawnSync(process.execPath, [script, path.join(directory, 'missing')], {
    encoding: 'utf8',
  });
  assert.equal(failure.status, 1);
  assert.equal(failure.stdout, '');
  assert.equal(failure.stderr, 'Storage configuration key preparation failed\n');
});

test('CLI refuses extra parameters without creating a file', async (t) => {
  const { directory } = await fixture(t);
  const result = spawnSync(
    process.execPath,
    [new URL('./storage-config-key.mjs', import.meta.url).pathname, directory, 'extra'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Storage configuration key preparation failed\n');
  assert.deepEqual(await readdir(directory), []);
});

test(
  'native CLI fails closed when host cannot assign the runtime uid',
  { skip: hostOwnershipSupported },
  async (t) => {
    const { directory } = await fixture(t);
    const result = spawnSync(
      process.execPath,
      [new URL('./storage-config-key.mjs', import.meta.url).pathname, directory],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Storage configuration key preparation failed\n');
    assert.deepEqual(await readdir(directory), []);
  },
);
