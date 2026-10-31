import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const controlOf = (lease) => ({
  leaseId: lease.leaseId,
  fencingToken: lease.fencingToken,
  clientInstanceId: lease.clientInstanceId,
});
/** Uses the caller's isolated synthetic HTTP harness. Returned state contains references/hashes only. */
export async function captureX08Archive({ call, state, readPool, assertPublicMissing }) {
  assert.equal(
    typeof assertPublicMissing,
    'function',
    'Supply the existing exact HTTP 404 assertion',
  );
  const root = `/v1/orgs/${state.orgId}`;
  const eventId = state.scheduling.workspace.event.id;
  const writerCookie = state.scoring.writerCookie;
  assert.ok(writerCookie && state.scoring.writerUserId && state.cookie);
  const candidates = (await call(`${root}/events/${eventId}/matches`, { cookie: state.cookie }))
    .data;
  let matchId;
  for (const m of candidates) {
    if (m.status !== 'SCHEDULED') continue;
    const wb = (await call(`${root}/matches/${m.id}/scoring`, { cookie: state.cookie })).data;
    if (wb.capabilities.canPrepare && wb.playerRoster.home.length && wb.playerRoster.away.length) {
      matchId = m.id;
      break;
    }
  }
  assert.ok(matchId, 'X08 capture requires one unprepared, non-adjudicated synthetic match');
  const path = `${root}/matches/${matchId}`;
  let wb = (await call(`${path}/scoring`, { cookie: state.cookie })).data;
  await call(`${path}/staff/${state.scoring.writerUserId}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { expectedMatchVersion: wb.match.version, role: 'SCORER', status: 'ACTIVE' },
  });
  async function command(cookie, type, payload = {}, control) {
    const current = (await call(`${path}/scoring`, { cookie })).data;
    return (
      await call(`${path}/commands`, {
        method: 'POST',
        cookie,
        body: {
          commandId: randomUUID(),
          expectedVersion: current.match.version,
          capturedAt: new Date().toISOString(),
          type,
          payload: ['PREPARE_MATCH', 'START_MATCH'].includes(type)
            ? { ...payload, expectedEventVersion: current.event.version }
            : payload,
          ...(control ? { control } : {}),
        },
      })
    ).data;
  }
  await command(state.cookie, 'PREPARE_MATCH', {
    collectionMode: 'PLAYER_BASIC',
    technicalCollection: true,
  });
  const lease = (
    await call(`${path}/scorekeeper-lease`, {
      method: 'POST',
      cookie: writerCookie,
      body: { clientInstanceId: randomUUID() },
    })
  ).data;
  const control = controlOf(lease);
  wb = (await call(`${path}/scoring`, { cookie: writerCookie })).data;
  const home = wb.playerRoster.home[0].memberId,
    away = wb.playerRoster.away[0].memberId,
    teamId = wb.match.home.teamId;
  await command(writerCookie, 'SET_LINEUP', { side: 'HOME', memberIds: [home] }, control);
  await command(writerCookie, 'SET_LINEUP', { side: 'AWAY', memberIds: [away] }, control);
  await command(writerCookie, 'START_MATCH', {}, control);
  await command(writerCookie, 'CLOCK_START', {}, control);
  await command(
    writerCookie,
    'RECORD_SHOT',
    { side: 'HOME', memberId: home, shotValue: 2, made: true },
    control,
  );
  await command(writerCookie, 'CLOCK_PAUSE', {}, control);
  const before = (await call(`${path}/scoring`, { cookie: writerCookie })).data;
  const intentId = randomUUID(),
    intent = {
      intentId,
      queueId: randomUUID(),
      ordinal: 1,
      previousIntentId: null,
      command: {
        commandId: intentId,
        type: 'RECORD_TECHNICAL',
        payload: { side: 'HOME', memberId: home, kind: 'ASSIST' },
        expectedVersion: before.match.version,
        capturedAt: new Date().toISOString(),
      },
    };
  const submission = { intent, control, confirmImport: true };
  const accepted = (
    await call(`${path}/offline-intents`, {
      method: 'POST',
      cookie: writerCookie,
      body: submission,
    })
  ).data;
  const replay = (
    await call(`${path}/offline-intents`, {
      method: 'POST',
      cookie: writerCookie,
      body: submission,
    })
  ).data;
  assert.deepEqual(
    replay.receipt,
    accepted.receipt,
    'Original offline UUID has one permanent receipt',
  );
  await command(
    writerCookie,
    'CLOCK_SET',
    { remainingMs: 0, reason: '合成恢复专业记分节末归零' },
    control,
  );
  await command(writerCookie, 'END_MATCH', {}, control);
  await call(`${path}/scorekeeper-lease`, {
    method: 'DELETE',
    cookie: writerCookie,
    body: { control },
  });
  const final = await command(state.cookie, 'CONFIRM_RESULT');
  assert.equal(final.snapshot.totals.home.score, 2);
  assert.equal(
    final.snapshot.professionalStatistics.home.players.find((p) => p.memberId === home).assists,
    1,
  );
  assert.deepEqual(
    final.snapshot.professionalStatistics,
    final.snapshot.latestConfirmation.professionalStatistics,
  );
  const create = (
    await call('/v1/me/public-archives', {
      method: 'POST',
      cookie: state.cookie,
      body: {
        commandId: randomUUID(),
        kind: 'TEAM',
        displayName: '合成恢复公共球队',
        orgId: state.orgId,
        teamId,
      },
    })
  ).data;
  async function profileCommand(p, type) {
    return (
      await call(`/v1/me/public-archives/${p.id}/commands`, {
        method: 'POST',
        cookie: state.cookie,
        body: {
          commandId: randomUUID(),
          expectedVersion: p.version,
          type,
          ...(type === 'PUBLISH'
            ? { publicConsent: true }
            : { reason: '合成验证永久撤销旧公开链接' }),
        },
      })
    ).data;
  }
  const first = await profileCommand(create, 'PUBLISH');
  const source = (
    await call('/v1/public-archive-sources', {
      method: 'POST',
      cookie: state.cookie,
      body: {
        commandId: randomUUID(),
        profileId: create.id,
        orgId: state.orgId,
        eventId,
        teamId,
        memberId: null,
        publisherConsent: true,
        reason: '合成恢复验证独立公共来源',
      },
    })
  ).data;
  const visible = (await call(`/v1/public/archives/${first.publicKey}`)).data;
  assert.ok(visible.recordedMatchCount >= 1);
  assert.ok(visible.technical.sampledMatchCount >= 1);
  assert.ok(visible.technical.assists >= 1);
  const revoked = await profileCommand(first, 'REVOKE');
  await assertPublicMissing(`/v1/public/archives/${first.publicKey}`);
  const published = await profileCommand(revoked, 'PUBLISH');
  assert.notEqual(published.publicKey, first.publicKey);
  await assertPublicMissing(`/v1/public/archives/${first.publicKey}`);
  const ledger = (
    await readPool.query(
      'SELECT intent_hash FROM scoring_offline_intents WHERE org_id=$1 AND match_id=$2 AND intent_id=$3',
      [state.orgId, matchId, intentId],
    )
  ).rows[0];
  assert.ok(ledger);
  return {
    profileId: create.id,
    sourceId: source.id,
    matchId,
    intentId,
    profileVersion: published.version,
    sourceVersion: source.version,
    publicKeyHash: sha(published.publicKey),
    revokedPublicKeyHash: sha(first.publicKey),
    professionalHash: sha(final.snapshot.professionalStatistics),
    receiptHash: sha(accepted.receipt),
    intentHash: ledger.intent_hash,
  };
}
export async function verifyX08Archive({ call, state, readPool, saved, assertPublicMissing }) {
  const path = `/v1/orgs/${state.orgId}/matches/${saved.matchId}`;
  const snapshot = (await call(`${path}/snapshot`, { cookie: state.cookie })).data;
  assert.equal(
    sha(snapshot.professionalStatistics),
    saved.professionalHash,
    'Confirmed technical shots/lineup/time survive restart',
  );
  const receipt = (
    await call(`${path}/offline-intents/${saved.intentId}`, { cookie: state.scoring.writerCookie })
  ).data;
  assert.equal(sha(receipt.receipt), saved.receiptHash);
  const p = (
    await readPool.query('SELECT public_key,status FROM public_archive_profiles WHERE id=$1', [
      saved.profileId,
    ])
  ).rows[0];
  assert.equal(p.status, 'PUBLISHED');
  assert.equal(sha(p.public_key), saved.publicKeyHash);
  const archive = (await call(`/v1/public/archives/${p.public_key}`)).data;
  assert.ok(archive.recordedMatchCount >= 1 && archive.technical.assists >= 1);
  const keys = (
    await readPool.query(
      'SELECT public_key,status FROM public_archive_publications WHERE profile_id=$1',
      [saved.profileId],
    )
  ).rows;
  const old = keys.find((k) => sha(k.public_key) === saved.revokedPublicKeyHash);
  assert.equal(old.status, 'REVOKED');
  await assertPublicMissing(`/v1/public/archives/${old.public_key}`);
}
export async function verifyX08ArchiveQuarantine({ readPool, saved, assertPublicMissing }) {
  assert.equal(typeof assertPublicMissing, 'function');
  const p = (
    await readPool.query(
      'SELECT status,public_key,version FROM public_archive_profiles WHERE id=$1',
      [saved.profileId],
    )
  ).rows[0];
  assert.equal(p.status, 'REVOKED');
  assert.equal(p.public_key, null);
  assert.equal(p.version, saved.profileVersion + 1);
  const source = (
    await readPool.query('SELECT status,version FROM public_archive_sources WHERE id=$1', [
      saved.sourceId,
    ])
  ).rows[0];
  assert.equal(source.status, 'REVOKED');
  assert.equal(source.version, saved.sourceVersion + 1);
  const keys = (
    await readPool.query(
      'SELECT public_key,status FROM public_archive_publications WHERE profile_id=$1',
      [saved.profileId],
    )
  ).rows;
  assert.deepEqual(
    keys.map((k) => sha(k.public_key)).sort(),
    [saved.publicKeyHash, saved.revokedPublicKeyHash].sort(),
  );
  for (const key of keys) {
    assert.equal(key.status, 'REVOKED');
    await assertPublicMissing(`/v1/public/archives/${key.public_key}`);
  }
  const ledger = (
    await readPool.query(
      'SELECT intent_hash,command_id FROM scoring_offline_intents WHERE match_id=$1 AND intent_id=$2',
      [saved.matchId, saved.intentId],
    )
  ).rows[0];
  assert.equal(ledger.intent_hash, saved.intentHash);
  assert.equal(
    ledger.command_id,
    saved.intentId,
    'Restore must preserve permanent original-operation mapping',
  );
}
