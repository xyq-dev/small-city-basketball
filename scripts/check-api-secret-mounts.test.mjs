import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertApiSecretMounts } from './check-api-secret-mounts.mjs';

const fixture = () => ({
  HostConfig: { ReadonlyRootfs: true, Init: true },
  Mounts: ['database_runtime_url', 'c23_participant_data_key'].map((name) => ({
    Type: 'bind',
    Source: `/isolated/source/${name}`,
    Destination: `/run/secrets/${name}`,
    RW: false,
  })),
});

test('the isolated API permits exactly its two read-only secrets regardless of Docker mount order', () => {
  const details = fixture();
  assertApiSecretMounts(details, '/isolated/source');
  details.Mounts.reverse();
  assertApiSecretMounts(details, '/isolated/source');
});

for (const [name, mutate] of [
  ['missing encryption key', (d) => d.Mounts.pop()],
  [
    'unexpected secret',
    (d) =>
      d.Mounts.push({
        Type: 'bind',
        Source: '/isolated/source/admin',
        Destination: '/run/secrets/database_admin_url',
        RW: false,
      }),
  ],
  ['writable key', (d) => (d.Mounts[1].RW = true)],
  ['different secret source', (d) => (d.Mounts[1].Source = '/other/participant-key')],
  ['non-file secret mount', (d) => (d.Mounts[1].Type = 'volume')],
  ['duplicate mount', (d) => d.Mounts.push({ ...d.Mounts[1] })],
  ['wrong target', (d) => (d.Mounts[1].Destination = '/run/secrets/other')],
  ['writable root', (d) => (d.HostConfig.ReadonlyRootfs = false)],
]) {
  test(`the isolated API rejects ${name}`, () => {
    const details = fixture();
    mutate(details);
    assert.throws(() => assertApiSecretMounts(details, '/isolated/source'));
  });
}

test('a restored API must use its target secrets instead of the source credentials', () => {
  assert.throws(() => assertApiSecretMounts(fixture(), '/isolated/target'));
  const details = fixture();
  for (const item of details.Mounts) item.Source = item.Source.replace('/source/', '/target/');
  assertApiSecretMounts(details, '/isolated/target');
});
