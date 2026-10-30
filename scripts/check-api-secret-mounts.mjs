import assert from 'node:assert/strict';
import path from 'node:path';

/** This isolated CI override permits exactly these two private, read-only file mounts. */
export function assertApiSecretMounts(details, secretDirectory) {
  assert.equal(details.HostConfig.ReadonlyRootfs, true);
  assert.equal(details.HostConfig.Init, true);
  const actual = details.Mounts.filter((item) => item.Destination.startsWith('/run/secrets/'))
    .map(({ Type, Source, Destination, RW }) => ({ Type, Source, Destination, RW }))
    .sort((a, b) => a.Destination.localeCompare(b.Destination));
  const expected = ['database_runtime_url', 'c23_participant_data_key']
    .map((name) => ({
      Type: 'bind',
      Source: path.join(secretDirectory, name),
      Destination: `/run/secrets/${name}`,
      RW: false,
    }))
    .sort((a, b) => a.Destination.localeCompare(b.Destination));
  assert.deepEqual(actual, expected);
}
