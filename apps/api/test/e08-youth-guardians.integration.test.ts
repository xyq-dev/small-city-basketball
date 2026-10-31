/** Isolated PostgreSQL only. All identities/evidence are synthetic; no external verification is claimed. */
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { YouthGuardiansService } from '../src/youth-guardians-service.js';
import {
  QualificationPrecheckService,
  createYouthQualificationReader,
} from '../src/qualification-precheck-service.js';
import {
  readYouthDataProcessingConsent,
  readYouthEligibility,
  revokeYouthForClosure,
} from '../src/youth-guardians-eligibility.js';
import { PublicArchivesService } from '../src/public-archives-service.js';
import { UnifiedSearchService } from '../src/unified-search-service.js';
import { YOUTH_DATA_TERMS_VERSION, YOUTH_TERMS_VERSION } from '../src/youth-guardians-domain.js';
import { ORIGIN, call, data, error, membersPath, register, staffPath } from './support.js';
import type { Api, User } from './support.js';
import {
  command,
  getEntry,
  participant,
  registration,
  registrationCommand,
  registrationDatabaseUrl,
} from './p03-support.js';
import type { Actor } from './p03-support.js';
import { createYouthRosterFixture, syntheticYouthIdentity } from './fixtures/youth-registration.js';
import type { YouthRosterFixture } from './fixtures/youth-registration.js';
import { syntheticPdf } from './media-fixtures.js';

const databaseUrl = registrationDatabaseUrl();
const participantDataKey = createHash('sha256')
  .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
  .digest('base64');
const proof = {
  fileName: 'synthetic-guardian.pdf',
  contentType: 'application/pdf',
  base64: syntheticPdf.toString('base64'),
};
describe('E08 youth and guardian authority on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api,
    owner: User,
    otherOwner: User,
    leader: Actor,
    reviewer: Actor,
    guardian: Actor,
    outsider: Actor,
    subjects: Actor[];
  let youth: YouthGuardiansService,
    qualification: QualificationPrecheckService,
    archives: PublicArchivesService,
    search: UnifiedSearchService;
  const reader = createYouthQualificationReader(participantDataKey, {
    dataConsentGuard: readYouthDataProcessingConsent,
  });
  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toMatch(
        /^scb_test_[A-Za-z0-9_]+$/,
      );
      await migrate(pool);
    } finally {
      await pool.end();
    }
    const config = { databaseUrl, appOrigin: ORIGIN, participantDataKey };
    api = await createApi(config);
    owner = await register(api, 'e08-owner');
    otherOwner = await register(api, 'e08-other-owner');
    leader = await participant(api, 'e08-leader');
    reviewer = await participant(api, 'e08-reviewer');
    guardian = await participant(api, 'e08-guardian');
    outsider = await participant(api, 'e08-outsider');
    subjects = [];
    for (let n = 0; n < 4; n++) subjects.push(await participant(api, 'e08-child-' + n));
    for (const actor of [reviewer, leader, guardian])
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${actor.id}`, {
          cookie: owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
    youth = new YouthGuardiansService(api.pool, { ...config, youthQualificationReader: reader });
    qualification = new QualificationPrecheckService(api.pool, config, {
      dataConsentGuard: readYouthDataProcessingConsent,
    });
    archives = new PublicArchivesService(api.pool, config);
    search = new UnifiedSearchService(api.pool, config);
  }, 90000);
  afterAll(async () => {
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  }, 30000);
  async function locked<T>(eventId: string, work: (c: PoolClient) => Promise<T>) {
    const c = await api.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
        owner.orgId,
        eventId,
      ]);
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async function fixture({
    reuse,
    actors = subjects.slice(0, 2),
    insurance = true,
    probe = false,
  }: {
    reuse?: YouthRosterFixture['registration'];
    actors?: Actor[];
    insurance?: boolean;
    probe?: boolean;
  } = {}) {
    return createYouthRosterFixture({
      api,
      owner,
      leader,
      reviewer,
      subjects: actors,
      birthDates: actors.map(() => '2015-01-01'),
      requireInsurance: insurance,
      registration: reuse,
      beforeOpen: async (reg) => {
        await youth.setPolicy(owner.cookie, owner.orgId, reg.event.id, {
          clientRequestId: randomUUID(),
          expectedVersion: null,
          enabled: true,
          guardianAgeThreshold: 18,
        });
        for (const actor of [leader, guardian])
          data(
            await call(api, 'put', staffPath(owner.orgId, reg.event.id, actor.id), {
              cookie: owner.cookie,
              body: { role: 'REVIEWER', status: 'ACTIVE' },
            }),
          );
      },
      beforeMaterial: async (r) => {
        if (probe) {
          const response = await call(
            api,
            'put',
            `/v1/orgs/${r.orgId}/entries/${r.entryId}/participant-materials/mine`,
            {
              cookie: r.subject.cookie,
              body: {
                clientRequestId: randomUUID(),
                expectedVersion: 0,
                realName: '合成未同意材料',
                identityNumber: syntheticYouthIdentity('2015-01-01'),
                acceptedTerms: true,
                publicityConsent: false,
              },
            },
          );
          error(response, 409);
          expect(
            (
              await api.pool.query(
                'SELECT count(*)::int AS n FROM participant_materials WHERE org_id=$1 AND entry_id=$2 AND member_id=$3',
                [r.orgId, r.entryId, r.memberId],
              )
            ).rows[0].n,
          ).toBe(0);
        }
        const invited = await youth.inviteData(r.subject.cookie, r.orgId, r.eventId, {
          clientRequestId: randomUUID(),
          expectedPolicyVersion: 1,
          guardianUserId: guardian.id,
          subjectAlias: '合成青年别名',
          declaredYouth: true,
        });
        await expect(
          youth.dataDecision(r.subject.cookie, invited.preconsentId, {
            clientRequestId: randomUUID(),
            expectedVersion: invited.version,
            decision: 'CONSENT',
            acceptedDataProcessing: true,
            dataTermsVersion: YOUTH_DATA_TERMS_VERSION,
          }),
        ).rejects.toMatchObject({ status: 403 });
        await youth.dataDecision(guardian.cookie, invited.preconsentId, {
          clientRequestId: randomUUID(),
          expectedVersion: invited.version,
          decision: 'CONSENT',
          acceptedDataProcessing: true,
          dataTermsVersion: YOUTH_DATA_TERMS_VERSION,
        });
      },
    });
  }
  async function qualify(f: YouthRosterFixture, index: number) {
    const m = f.members[index]!;
    const requested = await qualification.request(m.actor.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: m.memberId,
      expectedMaterialVersion: m.materialVersion,
      acceptedTermsVersion: 'qualification-precheck-v1',
    });
    await qualification.review(reviewer.cookie, owner.orgId, f.entry.id, {
      clientRequestId: randomUUID(),
      memberId: m.memberId,
      expectedMaterialVersion: m.materialVersion,
      requestId: requested.requestId,
      decision: 'APPROVED',
      reason: '合成当前身份照片独立核验',
      identityReviewed: true,
      portraitReviewed: true,
      signatureReviewed: true,
    });
  }
  async function propose(f: YouthRosterFixture, index: number, publicPurposes = false) {
    const m = f.members[index]!;
    return youth.propose(m.actor.cookie, owner.orgId, f.registration.event.id, {
      clientRequestId: randomUUID(),
      entryId: f.entry.id,
      memberId: m.memberId,
      expectedPolicyVersion: 1,
      acceptedTerms: true,
      termsVersion: YOUTH_TERMS_VERSION,
      publicityConsent: publicPurposes,
      archiveConsent: publicPurposes,
      liveConsent: publicPurposes,
    });
  }
  function confirmBody(version: number, publicPurposes = false) {
    return {
      clientRequestId: randomUUID(),
      expectedVersion: version,
      acceptedTerms: true,
      termsVersion: YOUTH_TERMS_VERSION,
      realName: '合成监护姓名',
      identityNumber: syntheticYouthIdentity('1990-01-01'),
      relationship: 'PARENT',
      relationshipExplanation: '合成独立人工核验关系证明',
      proof,
      publicityConsent: publicPurposes,
      archiveConsent: publicPurposes,
      liveConsent: publicPurposes,
    };
  }
  async function approve(id: string, version: number) {
    return youth.review(reviewer.cookie, id, {
      clientRequestId: randomUUID(),
      expectedVersion: version,
      decision: 'APPROVE',
      reason: '合成监护身份成年关系独立核验',
      identityChecked: true,
      relationshipChecked: true,
    });
  }
  async function guardianFlow(f: YouthRosterFixture, index: number, publicPurposes = false) {
    await qualify(f, index);
    const p = await propose(f, index, publicPurposes),
      confirmed = await youth.guardianConfirm(
        guardian.cookie,
        p.requestId,
        confirmBody(p.version, publicPurposes),
      );
    return approve(p.requestId, confirmed.version);
  }
  const scope = (f: YouthRosterFixture, index: number) => ({
    orgId: owner.orgId,
    eventId: f.registration.event.id,
    entryId: f.entry.id,
    memberId: f.members[index]!.memberId,
    rosterRevisionId: f.entry.rosterRevisionId!,
    rulesetId: f.entry.rules.id,
    policyDate: f.registration.event.startDate,
  });

  test('minimal prior consent, no-insurance qualification and independent relationship review are separate private steps', async () => {
    const f = await fixture({ probe: true }),
      m = f.members[0]!;
    await expect(propose(f, 0)).rejects.toMatchObject({ code: 'YOUTH_QUALIFICATION_REQUIRED' });
    await qualify(f, 0);
    const p = await propose(f, 0);
    const normal = await youth.detail(m.actor.cookie, p.requestId);
    expect(JSON.stringify(normal)).not.toContain(syntheticYouthIdentity('1990-01-01'));
    expect(normal.capabilities.canReadProof).toBe(false);
    await expect(youth.detail(outsider.cookie, p.requestId)).rejects.toMatchObject({ status: 404 });
    await expect(youth.detail(otherOwner.cookie, p.requestId)).rejects.toMatchObject({
      status: 404,
    });
    expect((await youth.workspace(outsider.cookie)).requests).toEqual([]);
    const confirmed = await youth.guardianConfirm(
      guardian.cookie,
      p.requestId,
      confirmBody(p.version),
    );
    await expect(youth.privateData(m.actor.cookie, p.requestId)).rejects.toMatchObject({
      status: 403,
    });
    expect((await youth.privateData(guardian.cookie, p.requestId)).identityNumber).toBe(
      syntheticYouthIdentity('1990-01-01'),
    );
    expect(
      (await youth.proofFile(reviewer.cookie, p.requestId)).body.subarray(0, 4).toString(),
    ).toBe('%PDF');
    for (const actor of [guardian, leader, m.actor])
      await expect(
        youth.review(actor.cookie, p.requestId, {
          clientRequestId: randomUUID(),
          expectedVersion: confirmed.version,
          decision: 'APPROVE',
          reason: '合成不得自行审核',
          identityChecked: true,
          relationshipChecked: true,
        }),
      ).rejects.toMatchObject({ status: 403 });
    const approved = await approve(p.requestId, confirmed.version);
    expect(
      (await locked(f.registration.event.id, (c) => readYouthEligibility(c, scope(f, 0), reader)))
        .ready,
    ).toBe(true);
    for (const purpose of ['PUBLICITY', 'PUBLIC_ARCHIVE', 'LIVE_RECORDING'] as const)
      expect(
        (
          await locked(f.registration.event.id, (c) =>
            readYouthEligibility(c, { ...scope(f, 0), purpose }, reader),
          )
        ).ready,
      ).toBe(false);
    const submit = await call(
      api,
      'post',
      `/v1/orgs/${owner.orgId}/entries/${f.entry.id}/participant-materials/mine/submit`,
      { cookie: m.actor.cookie, body: { expectedVersion: m.materialVersion } },
    );
    expect(submit.status).toBe(422);
    const ciphertext = (
      await api.pool.query(
        'SELECT guardian_payload_ciphertext FROM youth_guardian_requests WHERE id=$1',
        [p.requestId],
      )
    ).rows[0].guardian_payload_ciphertext;
    expect(ciphertext).not.toContain(syntheticYouthIdentity('1990-01-01'));
    expect(ciphertext).not.toContain(proof.base64);
    const page = await youth.workspace(guardian.cookie, { limit: '1' });
    expect(page.nextCursor).toEqual(expect.any(String));
    const more = await youth.workspace(guardian.cookie, { limit: '1', cursor: page.nextCursor });
    expect([...more.requests, ...more.preconsents].map((r) => r.id)).not.toContain(
      [...page.requests, ...page.preconsents].map((r) => r.id)[0],
    );
    const reqId = randomUUID();
    const withdrawn = await youth.withdraw(m.actor.cookie, p.requestId, {
      clientRequestId: reqId,
      expectedVersion: approved.version,
    });
    expect(
      await youth.withdraw(m.actor.cookie, p.requestId, {
        clientRequestId: reqId,
        expectedVersion: approved.version,
      }),
    ).toEqual(withdrawn);
    expect((await youth.receipt(m.actor.cookie, reqId)).found).toBe(true);
    expect((await youth.receipt(guardian.cookie, reqId)).found).toBe(false);
  }, 90000);

  test('current material replacement invalidates a reviewed relationship without granting access or reviving old confirmations', async () => {
    const f = await fixture(),
      approved = await guardianFlow(f, 0),
      m = f.members[0]!;
    data(
      await call(
        api,
        'put',
        `/v1/orgs/${owner.orgId}/entries/${f.entry.id}/participant-materials/mine`,
        {
          cookie: m.actor.cookie,
          body: {
            clientRequestId: randomUUID(),
            expectedVersion: m.materialVersion,
            realName: '合成资料更新',
          },
        },
      ),
    );
    expect(
      (await locked(f.registration.event.id, (c) => readYouthEligibility(c, scope(f, 0), reader)))
        .ready,
    ).toBe(false);
    const current = await youth.detail(guardian.cookie, approved.requestId);
    expect(current.current).toBe(false);
    expect(current.capabilities.canConfirm).toBe(false);
    expect(current.capabilities.canWithdraw).toBe(true);
    const keyless = new YouthGuardiansService(api.pool, { databaseUrl, appOrigin: ORIGIN });
    await keyless.withdraw(guardian.cookie, approved.requestId, {
      clientRequestId: randomUUID(),
      expectedVersion: approved.version,
    });
    await expect(
      api.pool.query('UPDATE youth_guardian_history SET action=$2 WHERE request_id=$1', [
        approved.requestId,
        'REVIEW_APPROVE',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  }, 90000);

  test('frozen history survives current withdrawal, known-youth public sources close, and closure locking is fail-fast', async () => {
    const first = await fixture({ insurance: false }),
      second = await fixture({
        reuse: first.registration,
        actors: subjects.slice(2, 4),
        insurance: false,
      });
    const approvals = [];
    for (const f of [first, second]) {
      for (let n = 0; n < 2; n++) {
        const a = await guardianFlow(f, n, true);
        approvals.push(a);
        const m = f.members[n]!;
        const submitted = data<{ material: { version: number } }>(
          await call(
            api,
            'post',
            `/v1/orgs/${owner.orgId}/entries/${f.entry.id}/participant-materials/mine/submit`,
            { cookie: m.actor.cookie, body: { expectedVersion: m.materialVersion } },
          ),
        );
        data(
          await call(
            api,
            'post',
            `/v1/orgs/${owner.orgId}/entries/${f.entry.id}/participant-materials/${m.memberId}/review`,
            {
              cookie: reviewer.cookie,
              body: {
                expectedVersion: submitted.material.version,
                decision: 'APPROVE',
                reason: '合成最终本人材料核验',
                identityChecked: true,
                portraitChecked: true,
                insuranceChecked: false,
              },
            },
          ),
        );
      }
      let e = await getEntry(api, owner, f.entry.id);
      e = await command(api, owner, e, leader, 'SUBMIT');
      await command(api, owner, e, owner, 'APPROVE');
    }
    let reg = await registration(api, owner, first.registration.event.id);
    reg = await registrationCommand(api, owner, reg, 'CLOSE_REGISTRATION');
    reg = await registrationCommand(api, owner, reg, 'FREEZE_REGISTRATION');
    expect(reg.freeze).not.toBeNull();
    const before = (
      await api.pool.query(
        'SELECT snapshot FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
        [owner.orgId, reg.event.id],
      )
    ).rows[0].snapshot;
    const p = await archives.create(first.members[0]!.actor.cookie, {
      commandId: randomUUID(),
      kind: 'PLAYER',
      displayName: '合成青年独立公开档案',
    });
    await expect(
      archives.command(first.members[0]!.actor.cookie, p.id, {
        commandId: randomUUID(),
        expectedVersion: 1,
        type: 'PUBLISH',
        publicConsent: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const nominated = await archives.nominate(owner.cookie, {
      commandId: randomUUID(),
      profileId: p.id,
      orgId: owner.orgId,
      eventId: reg.event.id,
      teamId: first.team.id,
      memberId: first.members[0]!.memberId,
      publisherConsent: true,
      reason: '合成精确公开档案来源',
    });
    await archives.sourceCommand(first.members[0]!.actor.cookie, nominated.id, {
      commandId: randomUUID(),
      expectedVersion: 1,
      type: 'CONSENT',
      playerConsent: true,
      reason: '合成本人当前精确公开来源同意',
    });
    const published = await archives.command(first.members[0]!.actor.cookie, p.id, {
      commandId: randomUUID(),
      expectedVersion: 1,
      type: 'PUBLISH',
      publicConsent: true,
    });
    expect((await archives.publicOne(published.publicKey!, 'e08')).authorizedSourceCount).toBe(1);
    expect(
      (await search.search({ q: '合成青年独立', kind: 'PLAYER' }, 'e08')).items.some(
        (x) => x.publicKey === published.publicKey,
      ),
    ).toBe(true);
    const target = approvals[0]!;
    const raced = await Promise.allSettled([
      youth.withdraw(guardian.cookie, target.requestId, {
        clientRequestId: randomUUID(),
        expectedVersion: target.version,
      }),
      youth.withdraw(first.members[0]!.actor.cookie, target.requestId, {
        clientRequestId: randomUUID(),
        expectedVersion: target.version,
      }),
    ]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      (await locked(reg.event.id, (c) => readYouthEligibility(c, scope(first, 0), reader))).ready,
    ).toBe(false);
    await expect(archives.publicOne(published.publicKey!, 'e08')).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await search.search({ q: '合成青年独立', kind: 'PLAYER' }, 'e08')).items.some(
        (x) => x.publicKey === published.publicKey,
      ),
    ).toBe(false);
    expect(
      (
        await api.pool.query(
          'SELECT snapshot FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
          [owner.orgId, reg.event.id],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
    const holder = await api.pool.connect(),
      closing = await api.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
        owner.orgId,
        reg.event.id,
      ]);
      await closing.query('BEGIN');
      await closing.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [guardian.id]);
      await expect(revokeYouthForClosure(closing, guardian.id)).rejects.toMatchObject({
        code: '55P03',
      });
    } finally {
      await closing.query('ROLLBACK');
      await holder.query('ROLLBACK');
      closing.release();
      holder.release();
    }
    const revoking = await api.pool.connect();
    try {
      await revoking.query('BEGIN');
      await revoking.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [guardian.id]);
      expect(await revokeYouthForClosure(revoking, guardian.id)).toBeGreaterThan(0);
      await revoking.query('COMMIT');
    } catch (e) {
      await revoking.query('ROLLBACK');
      throw e;
    } finally {
      revoking.release();
    }
    expect(
      (
        await api.pool.query(
          'SELECT snapshot FROM registration_freezes WHERE org_id=$1 AND event_id=$2',
          [owner.orgId, reg.event.id],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
  }, 120000);
});
