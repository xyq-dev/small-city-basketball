import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as hostFileSystem from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KEY_NAME = 'storage_config_key';
const RUNTIME_UID = 10001;

async function privateDirectory(directory, fileSystem, effectiveUid) {
  if (
    effectiveUid !== 0 ||
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    directory !== path.resolve(directory) ||
    /[\r\n\0]/.test(directory)
  )
    throw new Error('Invalid private key directory');
  const parts = directory.split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (const part of parts) {
    current = path.join(current, part);
    const info = await fileSystem.lstat(current);
    // A sticky system temporary directory is safe for the private test child directory.
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0)
    )
      throw new Error('Invalid private key directory');
    if (current === directory && (info.mode & 0o7777) !== 0o700)
      throw new Error('Invalid private key directory');
  }
  if (!parts.length) throw new Error('Invalid private key directory');
}

async function existingKey(file, fileSystem) {
  let handle;
  try {
    handle = await fileSystem.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== RUNTIME_UID ||
      info.gid !== RUNTIME_UID ||
      (info.mode & 0o7777) !== 0o400 ||
      ![64, 65].includes(info.size) ||
      !/^[0-9a-f]{64}\n?$/.test(await handle.readFile('utf8'))
    )
      throw new Error('Invalid existing key');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error('Invalid existing key');
  } finally {
    await handle?.close();
  }
}

/** Host-only preparation; never changes an existing key or prints its value. */
export async function prepareStorageConfigKey(
  directory,
  { fileSystem = hostFileSystem, effectiveUid = process.geteuid?.() } = {},
) {
  await privateDirectory(directory, fileSystem, effectiveUid);
  const destination = path.join(directory, KEY_NAME);
  if (await existingKey(destination, fileSystem)) return { status: 'retained' };
  const temporary = path.join(directory, `.storage-config-key-${randomUUID()}`);
  let handle,
    created = false;
  try {
    handle = await fileSystem.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    await handle.writeFile(randomBytes(32).toString('hex') + '\n');
    await handle.chown(RUNTIME_UID, RUNTIME_UID);
    await handle.chmod(0o400);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      // Hard-link publication is atomic and never replaces a concurrent existing file.
      await fileSystem.link(temporary, destination);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await fileSystem.unlink(temporary);
      created = false;
      if (await existingKey(destination, fileSystem)) return { status: 'retained' };
      throw new Error('Invalid existing key');
    }
    await fileSystem.unlink(temporary);
    created = false;
    const directoryHandle = await fileSystem.open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return { status: 'created' };
  } catch {
    throw new Error('Storage configuration key preparation failed');
  } finally {
    await handle?.close();
    if (created) await fileSystem.unlink(temporary).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error();
    const result = await prepareStorageConfigKey(process.argv[2]);
    process.stdout.write(`Storage configuration key ${result.status}\n`);
  } catch {
    process.stderr.write('Storage configuration key preparation failed\n');
    process.exitCode = 1;
  }
}
