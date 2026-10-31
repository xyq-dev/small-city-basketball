import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
const sha = (value) => createHash('sha256').update(value).digest('hex');
/** Actual HTTP under scb_runtime; state contains only synthetic references and digests. */
export async function captureX05Recruitment({
  call,
  state,
  readPool,
  fetchFile,
  assertPublicMissing,
}) {
  const root = `/v1/orgs/${state.orgId}`,
    owner = state.cookie,
    leader = state.registration.leaderCookie,
    leaderId = state.registration.leaderSession.user.id;
  const post = async (path, body, cookie = owner) =>
    (await call(path, { method: 'POST', cookie, body })).data;
  let event = (
    await call(root + '/events', {
      method: 'POST',
      cookie: owner,
      body: {
        name: '合成恢复独立招募-' + randomUUID().slice(0, 8),
        startDate: '2028-06-01',
        endDate: '2028-06-03',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  const base = root + '/events/' + event.id;
  let registration = (
    await call(base + '/registration-rules', {
      method: 'PUT',
      cookie: owner,
      body: {
        expectedVersion: event.version,
        minPlayers: 2,
        maxPlayers: 2,
        zeroAndDoubleZeroDistinct: true,
        requireIdentity: false,
        requireInsurance: false,
      },
    })
  ).data;
  registration = await post(base + '/registration-commands', {
    type: 'OPEN_REGISTRATION',
    expectedVersion: registration.event.version,
  });
  const publishId = randomUUID(),
    published = await post(base + '/recruitment/publish', {
      clientRequestId: publishId,
      expectedEventVersion: registration.event.version,
      title: '合成恢复赛前公开招募',
      description: '只用合成资料。独立招募不需要已发布赛程，批准仍是待补齐报名。',
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      maxApplications: 32,
    });
  const publicPath = '/v1/public/recruitments/' + published.publication.publicId,
    publicView = (await call(publicPath)).data;
  assert.equal(publicView.title, published.publication.title);
  assert.equal(JSON.stringify(publicView).includes(state.orgId), false);
  const applyId = randomUUID(),
    application = (
      await post(
        publicPath + '/applications',
        {
          clientRequestId: applyId,
          teamName: '合成招募新队-' + randomUUID().slice(0, 8),
          teamId: null,
          note: '合成本人明确报名',
        },
        leader,
      )
    ).application;
  const approval = (
    await post(base + `/recruitment-applications/${application.id}/commands`, {
      clientRequestId: randomUUID(),
      expectedVersion: application.version,
      type: 'APPROVE',
      reason: '独立核对合成招募通过',
    })
  ).application;
  assert.equal(approval.status, 'APPROVED');
  const workspace = (await call(base + '/recruitment', { cookie: owner })).data;
  const preview = (
    await post(base + '/team-import/previews', {
      clientRequestId: randomUUID(),
      expectedEventVersion: workspace.event.version,
      rows: [
        {
          teamName: '合成导入本届队-' + randomUUID().slice(0, 8),
          teamId: null,
          leaderUserId: leaderId,
        },
      ],
    })
  ).preview;
  assert.equal(preview.canCommit, true);
  assert.deepEqual(preview.issues, []);
  const commit = {
    clientRequestId: randomUUID(),
    expectedEventVersion: preview.eventVersion,
    previewId: preview.id,
    previewHash: preview.previewHash,
  };
  const imported = await post(base + '/team-import/commit', commit);
  assert.deepEqual(
    await post(base + '/team-import/commit', commit),
    imported,
    'Original immutable import ID must not create another team',
  );
  const invitation = imported.entries[0].invitation;
  const accepted = (
    await post(
      `/v1/event-invitations/${invitation.id}/commands`,
      { clientRequestId: randomUUID(), expectedVersion: invitation.version, type: 'ACCEPT' },
      leader,
    )
  ).invitation;
  assert.equal(accepted.entryId, imported.entries[0].entryId);
  const extraTeam = await post(root + '/teams', {
    name: '合成待接邀请队-' + randomUUID().slice(0, 8),
  });
  const current = (await call(base + '/recruitment', { cookie: owner })).data;
  const pending = (
    await post(base + '/event-invitations', {
      clientRequestId: randomUUID(),
      expectedEventVersion: current.event.version,
      teamId: extraTeam.id,
      targetUserId: leaderId,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    })
  ).invitation;
  const entries = (await call(base + '/entries', { cookie: owner })).data;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.status === 'DRAFT'));
  const posterEvent = state.scheduling.workspace.event.id,
    posterBase = root + '/events/' + posterEvent + '/posters';
  const posterWorkspace = (await call(posterBase, { cookie: owner })).data;
  const generateId = randomUUID(),
    generated = await post(posterBase, {
      clientRequestId: generateId,
      expectedEventVersion: posterWorkspace.event.version,
      kind: 'RESULT',
      entryId: null,
      matchId: state.scoring.saved[1].id,
      memberIds: [],
      includePortraits: false,
    });
  const poster = generated.poster,
    file = await fetchFile(posterBase + `/${poster.id}/content`, owner);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^image\/png/);
  assert.equal(file.headers.get('cache-control'), 'private, no-store');
  const bytes = Buffer.from(await file.arrayBuffer()),
    metadata = await sharp(bytes).metadata();
  assert.deepEqual(
    { format: metadata.format, width: metadata.width, height: metadata.height },
    { format: 'png', width: 1080, height: 1440 },
  );
  assert.equal(metadata.exif, undefined);
  const saved = {
    eventId: event.id,
    publicationId: published.publication.id,
    publicationVersion: published.publication.version,
    publicKeyHash: sha(published.publication.publicId),
    applyId,
    applicationId: application.id,
    entryId: approval.entryId,
    importId: commit.clientRequestId,
    previewId: preview.id,
    importEntryId: imported.entries[0].entryId,
    invitationId: accepted.id,
    pendingInvitationId: pending.id,
    posterEventId: posterEvent,
    posterId: poster.id,
    posterSourceHash: poster.sourceHash,
    pngSha256: sha(bytes),
    generateId,
  };
  await verifyX05Recruitment({ call, state, readPool, fetchFile, assertPublicMissing, saved });
  return saved;
}
export async function verifyX05Recruitment({ call, state, readPool, fetchFile, saved }) {
  const root = `/v1/orgs/${state.orgId}`;
  const publication = (
    await readPool.query(
      'SELECT public_id,status,version FROM recruitment_publications WHERE id=$1',
      [saved.publicationId],
    )
  ).rows[0];
  assert.equal(publication.status, 'ACTIVE');
  assert.equal(publication.version, saved.publicationVersion);
  assert.equal(sha(publication.public_id), saved.publicKeyHash);
  assert.ok((await call('/v1/public/recruitments/' + publication.public_id)).data.title);
  const original = (
    await call('/v1/me/recruitment-requests/' + saved.applyId, {
      cookie: state.registration.leaderCookie,
    })
  ).data;
  assert.equal(original.result.application.id, saved.applicationId);
  const imported = (
    await call('/v1/me/recruitment-requests/' + saved.importId, { cookie: state.cookie })
  ).data;
  assert.equal(imported.result.entries[0].entryId, saved.importEntryId);
  const entries = (
    await readPool.query('SELECT id,status FROM entries WHERE event_id=$1', [saved.eventId])
  ).rows;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.status === 'DRAFT'));
  const accepted = (
    await readPool.query('SELECT status,entry_id FROM event_invitations WHERE id=$1', [
      saved.invitationId,
    ])
  ).rows[0];
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(accepted.entry_id, saved.importEntryId);
  const pending = (
    await readPool.query('SELECT status FROM event_invitations WHERE id=$1', [
      saved.pendingInvitationId,
    ])
  ).rows[0];
  assert.equal(pending.status, 'PENDING');
  const file = await fetchFile(
    root + `/events/${saved.posterEventId}/posters/${saved.posterId}/content`,
    state.cookie,
  );
  assert.equal(file.status, 200);
  assert.equal(
    sha(Buffer.from(await file.arrayBuffer())),
    saved.pngSha256,
    'Deterministic authorized PNG survives restart/full restore',
  );
  const poster = (
    await readPool.query('SELECT source_hash,revoked_at FROM poster_exports WHERE id=$1', [
      saved.posterId,
    ])
  ).rows[0];
  assert.equal(poster.source_hash, saved.posterSourceHash);
  assert.equal(poster.revoked_at, null);
}
export async function verifyX05RecruitmentQuarantine({ readPool, saved, assertPublicMissing }) {
  const publication = (
    await readPool.query(
      'SELECT public_id,status,version FROM recruitment_publications WHERE id=$1',
      [saved.publicationId],
    )
  ).rows[0];
  assert.equal(publication.status, 'REVOKED');
  assert.equal(publication.version, saved.publicationVersion + 1);
  assert.equal(sha(publication.public_id), saved.publicKeyHash);
  await assertPublicMissing('/v1/public/recruitments/' + publication.public_id);
  assert.equal(
    (
      await readPool.query('SELECT status FROM event_invitations WHERE id=$1', [
        saved.pendingInvitationId,
      ])
    ).rows[0].status,
    'REVOKED',
  );
  assert.equal(
    (await readPool.query('SELECT status FROM event_invitations WHERE id=$1', [saved.invitationId]))
      .rows[0].status,
    'ACCEPTED',
    'Accepted history is retained, never turned into a new grant',
  );
  assert.ok(
    (await readPool.query('SELECT revoked_at FROM poster_exports WHERE id=$1', [saved.posterId]))
      .rows[0].revoked_at,
  );
  assert.equal(
    (
      await readPool.query(
        'SELECT actor_id FROM recruitment_request_receipts WHERE client_request_id=ANY($1::uuid[])',
        [[saved.applyId, saved.importId, saved.generateId]],
      )
    ).rows.length,
    3,
  );
  assert.equal(
    (
      await readPool.query('SELECT id FROM event_team_import_previews WHERE id=$1', [
        saved.previewId,
      ])
    ).rows.length,
    1,
  );
}
