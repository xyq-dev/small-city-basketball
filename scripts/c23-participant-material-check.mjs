import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { syntheticPdf } from './c05-media-fixtures.mjs';

// Generated 32x32 solid image; no person, location, real identity or policy is present.
const portrait =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWMQCeihKWIYtSBgNIh6RlORyGhG6xktKkRGS9OA0QpHZLTKDBhtVfSMNrwCRpuOPYO6dQ0AgRXALm9rtrMAAAAASUVORK5CYII=';
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function retainedSnapshot(readPool, materialId) {
  const result = await readPool.query(
    `SELECT m.id,m.current_revision_id,m.status,m.version,m.publicity_consent,
      r.client_request_id,r.request_fingerprint,r.purged_at,r.portrait_bytes,r.insurance_bytes,
      octet_length(r.payload_ciphertext) AS stored_length,
      encode(sha256(convert_to(r.payload_ciphertext,'UTF8')),'hex') AS ciphertext_sha256,
      (SELECT count(*)::int FROM participant_material_revisions allr WHERE allr.material_id=m.id) AS revisions
     FROM participant_materials m JOIN participant_material_revisions r ON r.id=m.current_revision_id
     WHERE m.id=$1`,
    [materialId],
  );
  assert.equal(result.rows.length, 1, 'The nonempty participant fixture must remain reachable');
  return result.rows[0];
}

/** Real existing HTTP endpoints create the relation and encrypted files; SQL is read-only. */
export async function captureParticipantMaterials({ call, readPool, orgId, ownerCookie, suffix }) {
  const root = `/v1/orgs/${orgId}`;
  const player = await call('/v1/auth/register-participant', {
    method: 'POST',
    body: {
      email: `materials-${suffix}@example.test`,
      password: randomBytes(24).toString('base64url'),
      displayName: '合成恢复球员',
    },
  });
  const cookie = player.response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(cookie);
  const team = (
    await call(`${root}/teams`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { name: `合成材料球队-${suffix}` },
    })
  ).data;
  const invite = (
    await call(`${root}/teams/${team.id}/invitations`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { targetUserId: player.data.user.id, expiresInHours: 1 },
    })
  ).data;
  await call(`/v1/invitations/${invite.invitation.id}/accept`, {
    method: 'POST',
    cookie,
    body: { token: invite.token },
  });
  const code = (
    await call(`${root}/teams/${team.id}/join-codes`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { expiresInHours: 1, maxUses: 1 },
    })
  ).data;
  const member = (
    await call('/v1/team-joins', {
      method: 'POST',
      cookie,
      body: { code: code.code, displayName: '合成恢复球员' },
    })
  ).data;
  const event = (
    await call(`${root}/events`, {
      method: 'POST',
      cookie: ownerCookie,
      body: {
        name: `私有资料恢复-${suffix}`,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  const eventPath = `${root}/events/${event.id}`;
  let registration = (
    await call(`${eventPath}/registration-rules`, {
      method: 'PUT',
      cookie: ownerCookie,
      body: {
        expectedVersion: event.version,
        minPlayers: 1,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: true,
        requireIdentity: true,
        requireInsurance: true,
        requireParticipantMaterials: true,
      },
    })
  ).data;
  registration = (
    await call(`${eventPath}/registration-commands`, {
      method: 'POST',
      cookie: ownerCookie,
      body: { type: 'OPEN_REGISTRATION', expectedVersion: registration.event.version },
    })
  ).data;
  let entry = (
    await call(`${eventPath}/entries`, { method: 'POST', cookie, body: { teamId: team.id } })
  ).data;
  const entryPath = `${root}/entries/${entry.id}`;
  entry = (
    await call(`${entryPath}/roster`, {
      method: 'PUT',
      cookie,
      body: {
        expectedVersion: entry.version,
        players: [{ memberId: member.memberId, jerseyNo: '9' }],
      },
    })
  ).data;
  const materialPath = `${entryPath}/participant-materials`;
  const request = {
    clientRequestId: randomUUID(),
    expectedVersion: 0,
    realName: '合成恢复球员',
    portrait: { fileName: 'synthetic-person.png', contentType: 'image/png', base64: portrait },
    insurance: {
      insurer: '隔离合成保险机构',
      policyNumber: `SYNTHETIC-${suffix}`,
      startDate: '2026-11-30',
      endDate: '2026-12-03',
      document: {
        fileName: 'synthetic-policy.pdf',
        contentType: 'application/pdf',
        base64: syntheticPdf.toString('base64'),
      },
    },
    acceptedTerms: true,
    publicityConsent: true,
  };
  const saved = (await call(`${materialPath}/mine`, { method: 'PUT', cookie, body: request })).data;
  assert.equal(
    saved.material.storedStatus,
    'DRAFT',
    'This is a partial synthetic draft, not approved real registration',
  );
  assert.equal(
    saved.capabilities.canSubmit,
    false,
    'Missing identity cannot pass the registration gate',
  );
  assert.ok(
    saved.material.portrait.byteLength > 0 && saved.material.insurance.document.byteLength > 0,
  );
  const replay = (await call(`${materialPath}/mine`, { method: 'PUT', cookie, body: request }))
    .data;
  assert.equal(replay.material.revisionId, saved.material.revisionId);
  assert.equal(replay.receipt.revisionId, saved.receipt.revisionId);
  const snapshot = await retainedSnapshot(readPool, saved.material.id);
  assert.equal(snapshot.revisions, 1, 'Same request replay must not duplicate encrypted material');
  assert.ok(
    snapshot.stored_length > 0 && snapshot.portrait_bytes > 0 && snapshot.insurance_bytes > 0,
  );
  assert.equal(snapshot.publicity_consent, true);
  assert.equal(snapshot.purged_at, null);
  return {
    cookie,
    memberId: member.memberId,
    entryId: entry.id,
    materialPath,
    request,
    mine: saved,
    snapshot,
  };
}

/** Run after the untouched full-database fingerprint assertion: file reads add audit records. */
export async function verifyParticipantMaterials({ call, fetchFile, readPool, saved }) {
  assert.deepEqual(await retainedSnapshot(readPool, saved.mine.material.id), saved.snapshot);
  const current = (await call(`${saved.materialPath}/mine`, { cookie: saved.cookie })).data;
  assert.deepEqual(current.material, saved.mine.material);
  const replay = (
    await call(`${saved.materialPath}/mine`, {
      method: 'PUT',
      cookie: saved.cookie,
      body: saved.request,
    })
  ).data;
  assert.equal(replay.receipt.revisionId, saved.mine.receipt.revisionId);
  assert.equal((await retainedSnapshot(readPool, saved.mine.material.id)).revisions, 1);
  for (const kind of ['portrait', 'insurance']) {
    const response = await fetchFile(
      `${saved.materialPath}/${saved.memberId}/files/${kind}`,
      saved.cookie,
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata =
      kind === 'portrait' ? saved.mine.material.portrait : saved.mine.material.insurance.document;
    assert.equal(bytes.length, metadata.byteLength);
    assert.equal(
      sha(bytes),
      metadata.sha256,
      'Decoded private file bytes survive the encrypted archive roundtrip',
    );
  }
}

export async function verifyParticipantQuarantine({ readPool, saved }) {
  const current = await retainedSnapshot(readPool, saved.mine.material.id);
  assert.equal(
    current.publicity_consent,
    false,
    'Restored organization reactivation cannot revive historical publicity consent',
  );
  const { publicity_consent: oldConsent, version: oldVersion, ...before } = saved.snapshot;
  const { publicity_consent: newConsent, version: newVersion, ...after } = current;
  assert.deepEqual(
    after,
    before,
    'Quarantine retains ciphertext, request tombstones and the private draft',
  );
  assert.equal(newVersion, oldVersion + 1);
}
