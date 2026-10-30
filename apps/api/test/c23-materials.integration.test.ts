import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { EntryData, EventRegistrationData, TeamData } from '@small-city-basketball/contracts';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { ORIGIN, call, data, error, membersPath, register } from './support.js';
import type { Api, User } from './support.js';
import {
  command,
  entry,
  entryCommandsPath,
  getEntry,
  grant,
  openRegistration,
  participant,
  registration,
  registrationCommand,
  registrationCommandsPath,
  registrationDatabaseUrl,
  roster,
  team,
  teamPath,
} from './p03-support.js';
import type { Actor } from './p03-support.js';
import { syntheticPdf } from './media-fixtures.js';

const databaseUrl = registrationDatabaseUrl();
// Ephemeral isolated-test key. It is never used by production or printed.
const testKey = createHash('sha256')
  .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
  .digest('base64');
interface Material {
  id: string;
  memberId: string;
  status: string;
  storedStatus: string;
  version: number;
  revisionId: string;
  clientRequestId: string;
  identityMasked: string | null;
  publicityConsent: boolean;
  acceptedTerms: boolean;
  portrait: { contentType: string; byteLength: number } | null;
  insurance: { policyNumberMasked: string; startDate: string; endDate: string } | null;
  blockers: { code: string; message: string }[];
}
interface Workspace {
  entryId: string;
  memberId: string;
  enabled: boolean;
  frozen: boolean;
  material: Material | null;
  capabilities: { canSave: boolean; canSubmit: boolean; canWithdrawPublicity: boolean };
}
interface Fixture {
  registration: EventRegistrationData;
  team: TeamData;
  entry: EntryData;
  actors: Actor[];
  bindingIds: string[];
}

// Deliberately non-real district prefix; only structural/checksum validity is tested.
function syntheticIdentity(sequence: number): string {
  const first17 = `99000019900101${String(sequence).padStart(3, '0')}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const check = '10X98765432';
  const sum = [...first17].reduce(
    (total, digit, index) => total + Number(digit) * weights[index]!,
    0,
  );
  return first17 + check[sum % 11];
}

describe('C23 private participant materials on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api;
  let owner: User;
  let otherOwner: User;
  let leader: Actor;
  let reviewer: Actor;
  const players: Actor[] = [];
  const instances: Api[] = [];
  let png: { fileName: string; contentType: string; base64: string };

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const actual = await pool.query<{ name: string }>('SELECT current_database() AS name');
      expect(actual.rows[0]?.name).toMatch(/^scb_test_[A-Za-z0-9_]+$/);
      await migrate(pool);
    } finally {
      await pool.end();
    }
    const config = { databaseUrl, appOrigin: ORIGIN, participantDataKey: testKey };
    api = await createApi(config);
    instances.push(api);
    owner = await register(api, 'c23-owner');
    otherOwner = await register(api, 'c23-other-owner');
    leader = await participant(api, 'c23-leader');
    reviewer = await participant(api, 'c23-reviewer');
    for (let index = 0; index < 4; index++)
      players.push(await participant(api, `c23-player-${index}`));
    data(
      await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
        cookie: owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
    png = {
      fileName: 'synthetic-portrait.png',
      contentType: 'image/png',
      base64: (
        await sharp({ create: { width: 64, height: 64, channels: 3, background: '#6080a0' } })
          .png()
          .toBuffer()
      ).toString('base64'),
    };
  }, 90000);
  afterAll(async () => {
    for (const instance of instances.reverse()) {
      await instance.app.close();
      await instance.pool.end();
    }
  }, 30000);

  const base = (f: Fixture, orgId = owner.orgId) =>
    `/v1/orgs/${orgId}/entries/${f.entry.id}/participant-materials`;
  const mine = async (f: Fixture, actor = f.actors[0]!, instance = api) =>
    data<Workspace>(await call(instance, 'get', `${base(f)}/mine`, { cookie: actor.cookie }));
  const save = (f: Fixture, body: object, actor = f.actors[0]!, instance = api) =>
    call(instance, 'put', `${base(f)}/mine`, { cookie: actor.cookie, body });
  const submit = (f: Fixture, version: number, actor = f.actors[0]!) =>
    call(api, 'post', `${base(f)}/mine/submit`, {
      cookie: actor.cookie,
      body: { expectedVersion: version },
    });
  const reviewBody = (version: number) => ({
    expectedVersion: version,
    decision: 'APPROVE',
    reason: '合成资料人工核对通过',
    identityChecked: true,
    portraitChecked: true,
    insuranceChecked: true,
  });
  const review = (f: Fixture, material: Material, actor = reviewer) =>
    call(api, 'post', `${base(f)}/${material.memberId}/review`, {
      cookie: actor.cookie,
      body: reviewBody(material.version),
    });

  async function bind(target: TeamData, memberId: string, actor: Actor): Promise<string> {
    const claim = data<{ claimId: string }>(
      await call(api, 'post', `${teamPath(owner.orgId, target.id)}/members/${memberId}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: actor.id },
      }),
      201,
    );
    const accepted = data<{ membership: { bindingId: string; id?: string } }>(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: actor.cookie,
        body: {},
      }),
    );
    const rows = await api.pool.query<{ id: string }>(
      "SELECT id FROM team_member_bindings WHERE org_id=$1 AND team_id=$2 AND member_id=$3 AND user_id=$4 AND status='ACTIVE'",
      [owner.orgId, target.id, memberId, actor.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(accepted.membership).not.toBeNull();
    return rows.rows[0]!.id;
  }

  async function fixture(
    insurance = true,
    actors = players.slice(0, 2),
    current?: EventRegistrationData,
  ): Promise<Fixture> {
    const configured =
      current ??
      (await openRegistration(api, owner, 'C23合成本人报名', reviewer, {
        ...{ requireParticipantMaterials: true },
        requireIdentity: true,
        requireInsurance: insurance,
        minPlayers: 2,
        maxPlayers: 2,
      }));
    const target = await team(
      api,
      owner,
      'C23合成球队',
      leader,
      actors.map((_, index) => `合成队员${index + 1}`),
    );
    const bindingIds: string[] = [];
    for (let index = 0; index < actors.length; index++)
      bindingIds.push(await bind(target, target.members[index]!.id, actors[index]!));
    let currentEntry = await entry(api, owner, configured.event.id, target, leader);
    currentEntry = await roster(api, owner, currentEntry, leader, target.members);
    return { registration: configured, team: target, entry: currentEntry, actors, bindingIds };
  }

  function completePatch(index = 0): Record<string, unknown> {
    return {
      clientRequestId: randomUUID(),
      expectedVersion: 0,
      realName: `合成本人${index + 1}`,
      identityNumber: syntheticIdentity(index + 1),
      portrait: png,
      insurance: {
        insurer: '合成保障机构',
        policyNumber: `SYNTHETIC-POLICY-${index + 1}`,
        startDate: '2028-02-01',
        endDate: '2028-03-31',
        document: {
          fileName: 'synthetic-policy.pdf',
          contentType: 'application/pdf',
          base64: syntheticPdf.toString('base64'),
        },
      },
      acceptedTerms: true,
      publicityConsent: false,
    };
  }

  async function approved(f: Fixture, index = 0): Promise<Material> {
    const actor = f.actors[index]!;
    const globalIndex = players.findIndex((candidate) => candidate.id === actor.id);
    let current = data<Workspace>(await save(f, completePatch(globalIndex), actor)).material!;
    current = data<Workspace>(await submit(f, current.version, actor)).material!;
    const result = data<Material>(await review(f, current));
    expect(result.status).toBe('APPROVED');
    return result;
  }

  test('current binding discovers the exact entry; anonymous, outsider and forged org do not obtain private material', async () => {
    const f = await fixture();
    const current = await mine(f);
    expect(current).toMatchObject({
      entryId: f.entry.id,
      memberId: f.team.members[0]!.id,
      enabled: true,
      material: null,
    });
    const discovered = data<{ orgId: string; entryId: string; memberId: string }[]>(
      await call(api, 'get', '/v1/me/participant-entries', { cookie: f.actors[0]!.cookie }),
    );
    expect(discovered).toContainEqual(
      expect.objectContaining({
        orgId: owner.orgId,
        entryId: f.entry.id,
        memberId: f.team.members[0]!.id,
      }),
    );
    error(await call(api, 'get', `${base(f)}/mine`), 401);
    error(await call(api, 'get', `${base(f)}/mine`, { cookie: leader.cookie }), 404);
    error(
      await call(api, 'get', `${base(f, otherOwner.orgId)}/mine`, { cookie: f.actors[0]!.cookie }),
      404,
    );
    error(await save(f, { ...completePatch(), memberId: f.team.members[1]!.id }), 422);
  });

  test('same request receipt saves once, changed patch conflicts and old replay cannot replace a newer head', async () => {
    const f = await fixture();
    const firstPatch = completePatch();
    const first = data<Workspace>(await save(f, firstPatch)).material!;
    const parallel = await Promise.all([save(f, firstPatch), save(f, firstPatch)]);
    const repeated = data<Workspace>(parallel[0]!).material!;
    expect(data<Workspace>(parallel[1]!).material!.revisionId).toBe(first.revisionId);
    expect(repeated.id).toBe(first.id);
    expect(repeated.revisionId).toBe(first.revisionId);
    expect(repeated.version).toBe(first.version);
    error(await save(f, { ...firstPatch, realName: '与原请求不同的合成姓名' }), 409);
    const second = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: first.version,
        realName: '合成姓名新版本',
      }),
    ).material!;
    expect(second.version).toBe(first.version + 1);
    await save(f, firstPatch);
    expect((await mine(f)).material!.revisionId).toBe(second.revisionId);
    const receipt = data<{ revisionId: string; isCurrent: boolean; currentVersion: number }>(
      await call(api, 'get', `${base(f)}/mine/receipts/${String(firstPatch.clientRequestId)}`, {
        cookie: f.actors[0]!.cookie,
      }),
    );
    expect(receipt).toMatchObject({
      revisionId: first.revisionId,
      isCurrent: false,
      currentVersion: second.version,
    });
    const revisions = await api.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM participant_material_revisions WHERE material_id=$1',
      [first.id],
    );
    expect(revisions.rows[0]!.n).toBe(2);
    error(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: first.version,
        realName: '过期版本不写入',
      }),
      409,
    );
  });

  test('current-event identity reservations release after withdrawal, while history receipts stay inert', async () => {
    const first = await fixture();
    const firstPatch = completePatch();
    const firstMaterial = data<Workspace>(await save(first, firstPatch)).material!;
    const replacement = await fixture(true, players.slice(0, 2), first.registration);
    const replacementPatch = completePatch();
    error(await save(replacement, replacementPatch), 409);
    const current = await getEntry(api, owner, first.entry.id);
    await command(api, owner, current, leader, 'WITHDRAW');
    const next = data<Workspace>(await save(replacement, replacementPatch)).material!;
    expect(next.id).not.toBe(firstMaterial.id);
    const reservations = await api.pool.query<{ id: string; reservation_active: boolean }>(
      'SELECT id,reservation_active FROM participant_materials WHERE org_id=$1 AND event_id=$2 AND user_id=$3 ORDER BY id',
      [owner.orgId, first.registration.event.id, first.actors[0]!.id],
    );
    expect(reservations.rows.find((row) => row.id === firstMaterial.id)?.reservation_active).toBe(
      false,
    );
    expect(reservations.rows.find((row) => row.id === next.id)?.reservation_active).toBe(true);
    data<Workspace>(await save(first, firstPatch));
    expect(
      (
        await api.pool.query<{ reservation_active: boolean }>(
          'SELECT reservation_active FROM participant_materials WHERE id=$1',
          [firstMaterial.id],
        )
      ).rows[0]!.reservation_active,
    ).toBe(false);
    error(
      await save(first, {
        clientRequestId: randomUUID(),
        expectedVersion: firstMaterial.version,
        realName: '撤回报名不得重新保存',
      }),
      409,
    );
    const historical = await api.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM participant_material_revisions WHERE material_id=$1',
      [firstMaterial.id],
    );
    expect(historical.rows[0]!.n).toBe(1);
  });

  test('encrypted storage and private file reads never grant the leader or another player access', async () => {
    const f = await fixture();
    const patch = completePatch();
    const material = data<Workspace>(await save(f, patch)).material!;
    expect(material.identityMasked).not.toBe(patch.identityNumber);
    expect(JSON.stringify(material)).not.toContain(String(patch.identityNumber));
    expect(JSON.stringify(material)).not.toContain('SYNTHETIC-POLICY-1');
    const stored = (
      await api.pool.query<{ payload_ciphertext: string; request_fingerprint: string }>(
        'SELECT payload_ciphertext,request_fingerprint FROM participant_material_revisions WHERE id=$1',
        [material.revisionId],
      )
    ).rows[0]!;
    for (const raw of [String(patch.identityNumber), '合成本人1', 'SYNTHETIC-POLICY-1', png.base64])
      expect(stored.payload_ciphertext).not.toContain(raw);
    expect(stored.request_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const details = data<{ identityNumber: string }>(
      await call(api, 'get', `${base(f)}/${material.memberId}/private`, {
        cookie: f.actors[0]!.cookie,
      }),
    );
    expect(details.identityNumber).toBe(patch.identityNumber);
    for (const actor of [leader, f.actors[1]!, otherOwner]) {
      error(
        await call(api, 'get', `${base(f)}/${material.memberId}/private`, { cookie: actor.cookie }),
        404,
      );
      error(
        await call(api, 'get', `${base(f)}/${material.memberId}/files/portrait`, {
          cookie: actor.cookie,
        }),
        404,
      );
      error(
        await call(api, 'get', `${base(f)}/${material.memberId}/files/insurance`, {
          cookie: actor.cookie,
        }),
        404,
      );
    }
    const progress = data<{ members: Record<string, unknown>[] }>(
      await call(api, 'get', base(f), { cookie: leader.cookie }),
    );
    const summary = progress.members.find((row) => row.memberId === material.memberId)!;
    expect(summary).toMatchObject({
      realName: null,
      identityMasked: null,
      portrait: null,
      insurance: null,
    });
    const response = await call(api, 'get', `${base(f)}/${material.memberId}/files/portrait`, {
      cookie: reviewer.cookie,
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const policy = await call(api, 'get', `${base(f)}/${material.memberId}/files/insurance`, {
      cookie: f.actors[0]!.cookie,
    });
    expect(policy.status).toBe(200);
    expect(policy.headers['content-disposition']).toMatch(/^attachment/);
    const audit = await api.pool.query<{ metadata: unknown }>(
      'SELECT metadata FROM audit_logs WHERE org_id=$1 AND resource_id=$2',
      [owner.orgId, material.id],
    );
    expect(JSON.stringify(audit.rows)).not.toContain(String(patch.identityNumber));
    expect(JSON.stringify(audit.rows)).not.toContain('SYNTHETIC-POLICY-1');
  });

  test('missing photos, signatures or accepted external cover cannot become a submitted application', async () => {
    const f = await fixture();
    let draft = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: 0,
        realName: '合成缺项本人',
        identityNumber: syntheticIdentity(1),
      }),
    ).material!;
    error(await submit(f, draft.version), 422);
    draft = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: draft.version,
        portrait: png,
        acceptedTerms: true,
      }),
    ).material!;
    error(await submit(f, draft.version), 422);
    draft = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: draft.version,
        insurance: {
          insurer: '合成保障',
          policyNumber: 'SYNTHETIC-EXPIRED',
          startDate: '2027-01-01',
          endDate: '2027-12-31',
          document: {
            fileName: 'synthetic-policy.pdf',
            contentType: 'application/pdf',
            base64: syntheticPdf.toString('base64'),
          },
        },
      }),
    ).material!;
    error(await submit(f, draft.version), 422);
    error(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: draft.version,
        portrait: { ...png, base64: Buffer.from('not an image').toString('base64') },
      }),
      422,
    );
    expect((await mine(f)).material!.version).toBe(draft.version);
  });

  test('only an independent reviewer can approve; a team grant or player relation bars review', async () => {
    const f = await fixture();
    let current = data<Workspace>(await save(f, completePatch())).material!;
    current = data<Workspace>(await submit(f, current.version)).material!;
    await grant(api, owner, f.team, reviewer);
    error(await review(f, current), 403);
    await grant(api, owner, f.team, reviewer, 'DISABLED');
    error(await review(f, current, f.actors[0]!), 404);
    error(await review(f, current, leader), 403);
    const missingChecks = await call(api, 'post', `${base(f)}/${current.memberId}/review`, {
      cookie: reviewer.cookie,
      body: { expectedVersion: current.version, decision: 'APPROVE', reason: '没有核对不得批准' },
    });
    error(missingChecks, 422);
    const approvedMaterial = data<Material>(await review(f, current));
    expect(approvedMaterial.status).toBe('APPROVED');
    expect(approvedMaterial.publicityConsent).toBe(false);
    expect(approvedMaterial.blockers).toEqual([]);
    expect((await mine(f)).capabilities.canSubmit).toBe(false);
  });

  test('disabled organization membership cannot retain an old event reviewer private access', async () => {
    const f = await fixture();
    const material = data<Workspace>(await save(f, completePatch())).material!;
    data(
      await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
        cookie: owner.cookie,
        body: { role: 'REVIEWER', status: 'DISABLED' },
      }),
    );
    try {
      error(
        await call(api, 'get', `${base(f)}/${material.memberId}/private`, {
          cookie: reviewer.cookie,
        }),
        404,
      );
      error(await review(f, material), 404);
    } finally {
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
          cookie: owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
    }
  });

  test('replacing material resets approval and advancing the roster requires explicit renewed consent', async () => {
    const f = await fixture();
    const approvedMaterial = await approved(f);
    const changed = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: approvedMaterial.version,
        realName: '合成本人修改',
      }),
    ).material!;
    expect(changed.storedStatus).toBe('DRAFT');
    expect(changed.revisionId).not.toBe(approvedMaterial.revisionId);
    const currentEntry = await getEntry(api, owner, f.entry.id);
    f.entry = await roster(api, owner, currentEntry, leader, f.team.members, ['11', '12']);
    const stale = (await mine(f)).material!;
    expect(stale.status).toBe('STALE');
    expect(stale.acceptedTerms).toBe(false);
    let reconfirmed = data<Workspace>(
      await save(f, { clientRequestId: randomUUID(), expectedVersion: stale.version }),
    ).material!;
    expect(reconfirmed.acceptedTerms).toBe(false);
    error(await submit(f, reconfirmed.version), 422);
    reconfirmed = data<Workspace>(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: reconfirmed.version,
        acceptedTerms: true,
      }),
    ).material!;
    expect(data<Workspace>(await submit(f, reconfirmed.version)).material!.status).toBe(
      'SUBMITTED',
    );
  });

  test('event-date changes invalidate approval and current policy coverage at the server gate', async () => {
    const f = await fixture();
    await approved(f, 0);
    await approved(f, 1);
    expect((await getEntry(api, owner, f.entry.id)).capabilities.canSubmit).toBe(false);
    let currentEntry = await getEntry(api, owner, f.entry.id, leader);
    expect(currentEntry.capabilities.canSubmit).toBe(true);
    await api.pool.query(
      "UPDATE events SET end_date='2028-04-02',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
      [owner.orgId, f.registration.event.id],
    );
    const stale = (await mine(f)).material!;
    expect(stale.status).toBe('STALE');
    currentEntry = await getEntry(api, owner, f.entry.id, leader);
    expect(currentEntry.capabilities.canSubmit).toBe(false);
    error(
      await call(api, 'post', entryCommandsPath(owner.orgId, f.entry.id), {
        cookie: leader.cookie,
        body: { type: 'SUBMIT', expectedVersion: currentEntry.version },
      }),
      422,
    );
  });

  test('rechecking team submission, approval and freeze uses the same current material boundary', async () => {
    const f = await fixture();
    let currentEntry = await getEntry(api, owner, f.entry.id);
    expect(currentEntry.capabilities.canSubmit).toBe(false);
    error(
      await call(api, 'post', entryCommandsPath(owner.orgId, f.entry.id), {
        cookie: leader.cookie,
        body: { type: 'SUBMIT', expectedVersion: currentEntry.version },
      }),
      422,
    );
    await approved(f, 0);
    await approved(f, 1);
    currentEntry = await getEntry(api, owner, f.entry.id);
    currentEntry = await command(api, owner, currentEntry, leader, 'SUBMIT');
    const saved = (await mine(f)).material!;
    await save(f, {
      clientRequestId: randomUUID(),
      expectedVersion: saved.version,
      realName: '提交后资料变更',
    });
    currentEntry = await getEntry(api, owner, f.entry.id);
    error(
      await call(api, 'post', entryCommandsPath(owner.orgId, f.entry.id), {
        cookie: owner.cookie,
        body: { type: 'APPROVE', expectedVersion: currentEntry.version },
      }),
      422,
    );
    const reviewable = data<Workspace>(
      await submit(f, (await mine(f)).material!.version),
    ).material!;
    data<Material>(await review(f, reviewable));
    currentEntry = await getEntry(api, owner, f.entry.id);
    currentEntry = await command(api, owner, currentEntry, owner, 'APPROVE');
    const other = await fixture(true, players.slice(2, 4), f.registration);
    await approved(other, 0);
    await approved(other, 1);
    let otherEntry = await getEntry(api, owner, other.entry.id);
    otherEntry = await command(api, owner, otherEntry, leader, 'SUBMIT');
    await command(api, owner, otherEntry, owner, 'APPROVE');
    let reg = await registration(api, owner, f.registration.event.id);
    reg = await registrationCommand(api, owner, reg, 'CLOSE_REGISTRATION');
    // Altering approved materials after close invalidates the final freeze without changing roster history.
    const beforeFreeze = (await mine(f)).material!;
    await save(f, {
      clientRequestId: randomUUID(),
      expectedVersion: beforeFreeze.version,
      realName: '冻结前材料更正',
    });
    reg = await registration(api, owner, reg.event.id);
    error(
      await call(api, 'post', registrationCommandsPath(owner.orgId, reg.event.id), {
        cookie: owner.cookie,
        body: { type: 'FREEZE_REGISTRATION', expectedVersion: reg.event.version },
      }),
      422,
    );
    const resubmitted = data<Workspace>(
      await submit(f, (await mine(f)).material!.version),
    ).material!;
    data<Material>(await review(f, resubmitted));
    reg = await registration(api, owner, reg.event.id);
    reg = await registrationCommand(api, owner, reg, 'FREEZE_REGISTRATION');
    expect(reg.freeze).not.toBeNull();
    const frozenWorkspace = await mine(f);
    expect(frozenWorkspace.frozen).toBe(true);
    expect(frozenWorkspace.capabilities.canSave).toBe(false);
    error(
      await save(f, {
        clientRequestId: randomUUID(),
        expectedVersion: frozenWorkspace.material!.version,
        portrait: png,
      }),
      409,
    );
    const after = (
      await api.pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM participant_material_revisions WHERE material_id=$1',
        [frozenWorkspace.material!.id],
      )
    ).rows[0]!.n;
    expect(after).toBe(3);
  });

  test('publicity can be refused without affecting review and withdrawn after the player has left', async () => {
    const f = await fixture(false);
    const patch = { ...completePatch(), insurance: null, publicityConsent: true };
    let material = data<Workspace>(await save(f, patch)).material!;
    material = data<Workspace>(await submit(f, material.version)).material!;
    material = data<Material>(await review(f, material));
    expect(material.status).toBe('APPROVED');
    data(
      await call(api, 'post', `/v1/me/memberships/${f.bindingIds[0]}/leave`, {
        cookie: f.actors[0]!.cookie,
        body: {},
      }),
    );
    const ownHistory = data<Workspace>(
      await call(api, 'get', `${base(f)}/mine`, { cookie: f.actors[0]!.cookie }),
    );
    expect(ownHistory.material!.id).toBe(material.id);
    expect(ownHistory.capabilities.canSave).toBe(false);
    expect(ownHistory.capabilities.canSubmit).toBe(false);
    const withdrawn = data<Workspace>(
      await call(api, 'post', `${base(f)}/mine/publicity-withdraw`, {
        cookie: f.actors[0]!.cookie,
        body: { expectedVersion: material.version },
      }),
    );
    expect(withdrawn.material!.publicityConsent).toBe(false);
    expect(withdrawn.material!.storedStatus).toBe('APPROVED');
    expect(withdrawn.capabilities.canSave).toBe(false);
    const row = (
      await api.pool.query<{ publicity_consent: boolean }>(
        'SELECT publicity_consent FROM participant_materials WHERE id=$1',
        [material.id],
      )
    ).rows[0]!;
    expect(row.publicity_consent).toBe(false);
  });

  test('revision receipts are immutable; ciphertext purge requires ended retention, terminal event and no hold', async () => {
    const f = await fixture();
    const material = data<Workspace>(await save(f, completePatch())).material!;
    await expect(
      api.pool.query('UPDATE participant_material_revisions SET jersey_no=$2 WHERE id=$1', [
        material.revisionId,
        '99',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      api.pool.query('DELETE FROM participant_material_revisions WHERE id=$1', [
        material.revisionId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const purge = () =>
      api.pool.query(
        'UPDATE participant_material_revisions SET payload_ciphertext=NULL,purged_at=clock_timestamp() WHERE id=$1',
        [material.revisionId],
      );
    await expect(purge()).rejects.toMatchObject({ code: '23514' });
    // These are owned synthetic fixtures, not a migration or production-state change.
    await api.pool.query(
      "UPDATE events SET start_date=current_date-92,end_date=current_date-91,status='ARCHIVED',version=version+1 WHERE org_id=$1 AND id=$2",
      [owner.orgId, f.registration.event.id],
    );
    await api.pool.query('UPDATE participant_materials SET legal_hold=true WHERE id=$1', [
      material.id,
    ]);
    await expect(purge()).rejects.toMatchObject({ code: '23514' });
    await api.pool.query('UPDATE participant_materials SET legal_hold=false WHERE id=$1', [
      material.id,
    ]);
    expect((await purge()).rowCount).toBe(1);
    const tombstone = (
      await api.pool.query<{
        payload_ciphertext: null;
        purged_at: Date;
        client_request_id: string;
      }>(
        'SELECT payload_ciphertext,purged_at,client_request_id FROM participant_material_revisions WHERE id=$1',
        [material.revisionId],
      )
    ).rows[0]!;
    expect(tombstone.payload_ciphertext).toBeNull();
    expect(tombstone.purged_at).toBeInstanceOf(Date);
    expect(tombstone.client_request_id).toBe(material.clientRequestId);
    await expect(
      api.pool.query('DELETE FROM participant_material_revisions WHERE id=$1', [
        material.revisionId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('unconfigured or different encryption keys fail closed instead of storing another identity reservation', async () => {
    const f = await fixture();
    const current = data<Workspace>(await save(f, completePatch())).material!;
    for (const extra of [{}, { participantDataKey: randomBytes(32).toString('base64') }]) {
      const isolated = await createApi({ databaseUrl, appOrigin: ORIGIN, ...extra });
      instances.push(isolated);
      const response = await save(
        f,
        {
          clientRequestId: randomUUID(),
          expectedVersion: current.version,
          realName: '密钥错误不能保存',
        },
        f.actors[0],
        isolated,
      );
      error(response, 503);
    }
    const rows = await api.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM participant_material_revisions WHERE material_id=$1',
      [current.id],
    );
    expect(rows.rows[0]!.n).toBe(1);
    expect((await mine(f)).material!.revisionId).toBe(current.revisionId);
  });
});
