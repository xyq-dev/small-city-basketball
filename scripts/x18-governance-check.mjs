import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { syntheticPdf } from './c05-media-fixtures.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value) => sha(JSON.stringify(value));
const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function context(state) {
  const operators = state?.commerce?.operators;
  assert.ok(
    uuid(state?.orgId) && uuid(state?.userId) && typeof state.cookie === 'string',
    'Governance check needs the existing isolated synthetic owner',
  );
  assert.ok(
    Array.isArray(operators) &&
      operators.length >= 2 &&
      operators.every((o) => uuid(o.userId) && typeof o.cookie === 'string'),
    'Governance check needs two existing synthetic platform operators',
  );
  assert.ok(
    new Set([state.userId, operators[0].userId, operators[1].userId]).size === 3,
    'Independent synthetic actors must differ',
  );
  return {
    root: `/v1/orgs/${state.orgId}`,
    owner: state.cookie,
    admin: operators[0],
    platform: operators[1],
  };
}
async function row(pool, sql, args) {
  const result = await pool.query(sql, args);
  assert.equal(result.rows.length, 1, 'A nonempty governance fixture must remain reachable');
  return result.rows[0];
}
async function retained(pool, saved) {
  const caseRow = await row(
    pool,
    "SELECT encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') AS hash FROM governance_cases c WHERE id=$1",
    [saved.caseId],
  );
  const attachment = await row(
    pool,
    `SELECT id,case_id,content_type,byte_length,content_hash,encode(sha256(content),'hex') AS actual_hash,
    encode(sha256(convert_to((to_jsonb(a)-'content')::text,'UTF8')),'hex') AS metadata_hash FROM governance_case_attachments a WHERE id=$1`,
    [saved.attachmentId],
  );
  assert.equal(attachment.case_id, saved.caseId);
  assert.equal(attachment.content_type, 'application/pdf');
  assert.equal(attachment.byte_length, saved.attachmentBytes);
  assert.equal(attachment.actual_hash, saved.attachmentSha256);
  assert.equal(attachment.content_hash, saved.attachmentSha256);
  const entry = await row(
    pool,
    "SELECT encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') AS hash FROM public_ledger_entries e WHERE id=$1",
    [saved.ledgerEntryId],
  );
  const staff = await row(
    pool,
    "SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM staff_configuration_receipts r WHERE id=$1",
    [saved.staffCommandId],
  );
  const operations = (
    await pool.query(
      `SELECT actor_id,command_id,encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') AS hash
    FROM governance_operations o WHERE actor_id=ANY($1::uuid[]) AND command_id=ANY($2::uuid[]) ORDER BY actor_id,command_id`,
      [
        [...new Set(saved.operationRefs.map((r) => r.actorId))],
        saved.operationRefs.map((r) => r.commandId),
      ],
    )
  ).rows;
  assert.equal(
    operations.length,
    saved.operationRefs.length,
    'Every original permanent operation receipt must be retained',
  );
  const refs = operations.map((r) => r.actor_id + ':' + r.command_id).sort();
  assert.deepEqual(refs, saved.operationRefs.map((r) => r.actorId + ':' + r.commandId).sort());
  const impressions = await row(
    pool,
    'SELECT count(*)::int AS n FROM sponsorship_impressions WHERE publication_id=$1 AND command_id=$2',
    [saved.sponsorPublicationId, saved.impressionCommandId],
  );
  assert.equal(impressions.n, 1, 'Repeated impression UUID must still count once');
  return { case: caseRow, attachment, entry, staff, operations, impressions };
}
async function publications(pool, saved) {
  const sponsor = await row(
    pool,
    `SELECT p.id,p.public_key,p.revoked_at IS NOT NULL AS revoked,c.status,c.version,
    encode(sha256(convert_to((to_jsonb(p)-ARRAY['revoked_at','revoked_by','revoke_reason'])::text,'UTF8')),'hex') AS publication_hash,
    encode(sha256(convert_to((to_jsonb(c)-ARRAY['status','version','updated_at'])::text,'UTF8')),'hex') AS source_hash
    FROM sponsorship_publications p JOIN sponsorship_campaigns c ON c.id=p.campaign_id WHERE p.id=$1 AND c.id=$2`,
    [saved.sponsorPublicationId, saved.campaignId],
  );
  const ledger = await row(
    pool,
    `SELECT p.id,p.public_key,p.revoked_at IS NOT NULL AS revoked,a.status,a.version,
    encode(sha256(convert_to((to_jsonb(p)-ARRAY['revoked_at','revoked_by','revoke_reason'])::text,'UTF8')),'hex') AS publication_hash,
    encode(sha256(convert_to((to_jsonb(a)-ARRAY['status','version'])::text,'UTF8')),'hex') AS source_hash
    FROM public_ledger_publications p JOIN public_ledger_accounts a ON a.id=p.account_id WHERE p.id=$1 AND a.id=$2`,
    [saved.ledgerPublicationId, saved.ledgerAccountId],
  );
  const grant = await row(
    pool,
    `SELECT id,status,version,encode(sha256(convert_to((to_jsonb(g)-ARRAY['status','version','revoked_at','revoked_by','revoke_reason'])::text,'UTF8')),'hex') AS source_hash FROM city_operation_grants g WHERE id=$1`,
    [saved.cityGrantId],
  );
  assert.ok(
    opaque(sponsor.public_key) && opaque(ledger.public_key),
    'Captured publication keys must remain well formed',
  );
  assert.equal(sha(sponsor.public_key), saved.sponsorKeyHash);
  assert.equal(sha(ledger.public_key), saved.ledgerKeyHash);
  const metadata = ({ public_key: _, ...rest }) => rest;
  return {
    sponsor,
    ledger,
    grant,
    nonsecret: { sponsor: metadata(sponsor), ledger: metadata(ledger), grant },
  };
}
async function attachmentBytes(fetchFile, path, cookie) {
  const response = await fetchFile(path, cookie);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('cache-control')?.includes('no-store'));
  return Buffer.from(await response.arrayBuffer());
}
function assertPublicProjection(value, ids) {
  const serialized = JSON.stringify(value);
  for (const id of ids)
    assert.ok(
      !serialized.includes(id),
      'Public projection must not contain a private source or actor identifier',
    );
}
/** Only the existing isolated harness may call this; effects go through its restricted runtime API. */
export async function captureX18Governance({ call, state, readPool, fetchFile }) {
  const { root, owner, admin, platform } = context(state);
  assert.ok(
    typeof state.registration?.leaderCookie === 'string',
    'Use an existing non-operator requester as the private-file outsider',
  );
  const operationRefs = [];
  const command = async (path, cookie, actorId, body, method = 'POST') => {
    const commandId = randomUUID();
    operationRefs.push({ actorId, commandId });
    return (await call(path, { method, cookie, body: { commandId, ...body } })).data;
  };
  const members = (await call(root + '/staff-configuration', { cookie: owner })).data.members;
  const current = members.find((m) => m.id === admin.userId);
  assert.ok(
    !current || current.role !== 'ORG_OWNER',
    'Never overwrite a synthetic organization owner',
  );
  const staffCommandId = randomUUID();
  const member = (
    await call(root + '/staff-configuration/commands', {
      method: 'POST',
      cookie: owner,
      body: {
        clientRequestId: staffCommandId,
        type: 'MEMBER',
        userId: admin.userId,
        expectedVersion: current?.version ?? null,
        role: 'ORG_ADMIN',
        status: 'ACTIVE',
      },
    })
  ).data;
  assert.equal(member.applied, true);
  const regionRow = await row(
    readPool,
    "SELECT catalog_version,region_id FROM region_catalog_nodes WHERE level='PREFECTURE' ORDER BY catalog_version,region_id LIMIT 1",
    [],
  );
  const region = { catalogVersion: regionRow.catalog_version, regionId: regionRow.region_id };
  const createdCase = await command('/v1/me/governance/cases', owner, state.userId, {
    orgId: state.orgId,
    kind: 'SUPPORT',
    title: '合成恢复工单',
    body: '仅用于隔离恢复验收的合成私有内容',
    region,
  });
  const attachmentCommandId = randomUUID();
  operationRefs.push({ actorId: state.userId, commandId: attachmentCommandId });
  const attachment = (
    await call(`/v1/me/governance/cases/${createdCase.id}/attachments/${attachmentCommandId}`, {
      method: 'PUT',
      cookie: owner,
      body: {
        expectedVersion: createdCase.version,
        fileName: 'synthetic.pdf',
        contentType: 'application/pdf',
        base64: syntheticPdf.toString('base64'),
        visibility: 'REQUESTER',
      },
    })
  ).data;
  const filePath = `/v1/me/governance/cases/${createdCase.id}/attachments/${attachment.attachmentId}/content`;
  const bytes = await attachmentBytes(fetchFile, filePath, owner);
  assert.equal(sha(bytes), sha(syntheticPdf));
  const denied = await fetchFile(filePath, state.registration.leaderCookie);
  assert.equal(
    denied.status,
    404,
    'An unrelated non-operator cannot read a private case attachment',
  );
  const grant = await command(
    '/v1/platform/city-operations/grants',
    platform.cookie,
    platform.userId,
    {
      orgId: state.orgId,
      userId: admin.userId,
      region,
      action: 'CASE_MANAGE',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      reason: '合成恢复城市权限',
    },
  );
  const campaign = await command(root + '/sponsorships', owner, state.userId, {
    region,
    brand: '合成品牌',
    title: '合成城市赞助',
    body: '隔离恢复用合成宣传资料',
    startsAt: new Date(Date.now() - 3600000).toISOString(),
    endsAt: new Date(Date.now() + 86400000).toISOString(),
  });
  let advertised = await command(
    root + `/sponsorships/${campaign.id}/commands`,
    owner,
    state.userId,
    { expectedVersion: campaign.version, type: 'SUBMIT', reason: '合成提交待独立审核' },
  );
  advertised = await command(
    root + `/sponsorships/${campaign.id}/commands`,
    platform.cookie,
    platform.userId,
    { expectedVersion: advertised.version, type: 'APPROVE', reason: '合成独立审核通过' },
  );
  advertised = await command(root + `/sponsorships/${campaign.id}/commands`, owner, state.userId, {
    expectedVersion: advertised.version,
    type: 'PUBLISH',
    reason: '合成授权城市公示',
  });
  assert.ok(opaque(advertised.publicKey));
  const publicSponsor = (await call('/v1/public/sponsorships/' + advertised.publicKey)).data;
  const impressionCommandId = randomUUID(),
    impressionPath = '/v1/public/sponsorships/' + advertised.publicKey + '/impressions';
  const first = (
    await call(impressionPath, { method: 'POST', body: { commandId: impressionCommandId } })
  ).data;
  assert.deepEqual(
    (await call(impressionPath, { method: 'POST', body: { commandId: impressionCommandId } })).data,
    first,
  );
  const account = await command(root + '/public-ledgers', owner, state.userId, {
    teamId: null,
    title: '合成授权经费账本',
    description: '只记录合成线下收支，不涉及真实资金',
    authorizationConfirmed: true,
  });
  const added = await command(root + `/public-ledgers/${account.id}/entries`, owner, state.userId, {
    expectedVersion: account.version,
    occurredOn: new Date().toISOString().slice(0, 10),
    label: '合成线下支出',
    kind: 'EXPENSE',
    amountFen: -5000,
  });
  const approved = await command(
    root + `/public-ledgers/${account.id}/commands`,
    admin.cookie,
    admin.userId,
    {
      expectedVersion: added.version,
      type: 'APPROVE_ENTRY',
      entryId: added.entry.id,
      entryVersion: added.entry.version,
      reason: '独立核对合成支出',
    },
  );
  const ledger = await command(
    root + `/public-ledgers/${account.id}/commands`,
    admin.cookie,
    admin.userId,
    {
      expectedVersion: approved.version,
      type: 'PUBLISH',
      reason: '独立确认合成公示',
      publicConsent: true,
    },
  );
  assert.ok(opaque(ledger.publicKey));
  const publicLedger = (await call('/v1/public/ledgers/' + ledger.publicKey)).data;
  assert.equal(publicLedger.approvedNetFen, -5000);
  assert.equal(publicLedger.entryCount, 1);
  assert.equal(publicLedger.entries[0].kind, 'EXPENSE');
  assertPublicProjection(publicLedger, [
    state.orgId,
    state.userId,
    admin.userId,
    platform.userId,
    account.id,
    added.entry.id,
  ]);
  assertPublicProjection(publicSponsor, [
    state.orgId,
    state.userId,
    admin.userId,
    platform.userId,
    campaign.id,
  ]);
  const sponsorPublication = await row(
    readPool,
    'SELECT id FROM sponsorship_publications WHERE campaign_id=$1 AND revoked_at IS NULL',
    [campaign.id],
  );
  const ledgerPublication = await row(
    readPool,
    'SELECT id FROM public_ledger_publications WHERE account_id=$1 AND revoked_at IS NULL',
    [account.id],
  );
  const saved = {
    orgId: state.orgId,
    caseId: createdCase.id,
    attachmentId: attachment.attachmentId,
    attachmentCommandId,
    cityGrantId: grant.id,
    campaignId: campaign.id,
    sponsorPublicationId: sponsorPublication.id,
    sponsorKeyHash: sha(advertised.publicKey),
    sponsorPublicHash: jsonHash(publicSponsor),
    impressionCommandId,
    ledgerAccountId: account.id,
    ledgerEntryId: added.entry.id,
    ledgerPublicationId: ledgerPublication.id,
    ledgerKeyHash: sha(ledger.publicKey),
    ledgerPublicHash: jsonHash(publicLedger),
    staffCommandId,
    operationRefs,
    attachmentSha256: sha(bytes),
    attachmentBytes: bytes.length,
    coverage: {
      privateCase: true,
      privateAttachment: true,
      cityGrant: true,
      sponsorship: true,
      ledger: true,
      verifiedBookingReview: false,
    },
  };
  saved.retained = await retained(readPool, saved);
  saved.publicationFacts = (await publications(readPool, saved)).nonsecret;
  return saved;
}
/** Only read-only SQL and existing authenticated/private or anonymous/public HTTP reads. */
export async function verifyX18Governance({ call, state, readPool, fetchFile, saved }) {
  const { root, owner } = context(state);
  assert.ok(
    saved && saved.orgId === state.orgId,
    'An original nonempty governance fixture is required',
  );
  assert.deepEqual(await retained(readPool, saved), saved.retained);
  const current = await publications(readPool, saved);
  assert.deepEqual(current.nonsecret, saved.publicationFacts);
  assert.equal(current.sponsor.revoked, false);
  assert.equal(current.sponsor.status, 'APPROVED');
  assert.equal(current.ledger.revoked, false);
  assert.equal(current.ledger.status, 'ACTIVE');
  assert.equal(current.grant.status, 'ACTIVE');
  const privateCase = (await call('/v1/me/governance/cases/' + saved.caseId, { cookie: owner }))
    .data;
  assert.equal(privateCase.id, saved.caseId);
  const bytes = await attachmentBytes(
    fetchFile,
    `/v1/me/governance/cases/${saved.caseId}/attachments/${saved.attachmentId}/content`,
    owner,
  );
  assert.equal(bytes.length, saved.attachmentBytes);
  assert.equal(sha(bytes), saved.attachmentSha256);
  const publicSponsor = (await call('/v1/public/sponsorships/' + current.sponsor.public_key)).data;
  const publicLedger = (await call('/v1/public/ledgers/' + current.ledger.public_key)).data;
  assert.equal(jsonHash(publicSponsor), saved.sponsorPublicHash);
  assert.equal(jsonHash(publicLedger), saved.ledgerPublicHash);
  const privateLedger = (
    await call(root + '/public-ledgers/' + saved.ledgerAccountId, { cookie: owner })
  ).data;
  assert.equal(privateLedger.version, saved.publicationFacts.ledger.version);
  assert.equal(privateLedger.approvedNetFen, -5000);
  assert.equal(privateLedger.entries.length, 1);
  assert.equal(privateLedger.entries[0].status, 'APPROVED');
  assert.equal(privateLedger.entries[0].createdBy, state.userId);
  assert.equal(privateLedger.entries[0].reviewedBy, state.commerce.operators[0].userId);
}
/** Quarantine may change only the explicitly revocable heads; historical content/receipts persist. */
export async function verifyX18GovernanceQuarantine({ readPool, saved, assertPublicMissing }) {
  assert.ok(
    saved?.retained && typeof assertPublicMissing === 'function',
    'Quarantine check requires original evidence and the existing public-negative verifier',
  );
  assert.deepEqual(await retained(readPool, saved), saved.retained);
  const current = await publications(readPool, saved),
    before = saved.publicationFacts;
  for (const kind of ['sponsor', 'ledger']) {
    assert.equal(current[kind].revoked, true);
    assert.equal(current[kind].version, before[kind].version + 1);
    assert.equal(current[kind].publication_hash, before[kind].publication_hash);
    assert.equal(current[kind].source_hash, before[kind].source_hash);
  }
  assert.equal(current.sponsor.status, 'WITHDRAWN');
  assert.equal(current.ledger.status, 'CLOSED');
  assert.equal(current.grant.status, 'REVOKED');
  assert.equal(current.grant.version, before.grant.version + 1);
  assert.equal(current.grant.source_hash, before.grant.source_hash);
  await assertPublicMissing('/v1/public/sponsorships/' + current.sponsor.public_key);
  await assertPublicMissing('/v1/public/ledgers/' + current.ledger.public_key);
}
