/** Synthetic identities only. Real app/service flows on isolated PostgreSQL; no local execution. */
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import sharp from 'sharp';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { YouthGuardiansService } from '../src/youth-guardians-service.js';
import { createYouthDataConsentGuard } from '../src/youth-guardians-eligibility.js';
import {
  createYouthAdultAgeReader,
  YOUTH_ADULT_DATA_TERMS,
  readAdultPublicConsentEpoch,
} from '../src/youth-adult-data-consent.js';
import {
  QualificationPrecheckService,
  createYouthQualificationReader,
} from '../src/qualification-precheck-service.js';
import { PublicArchivesService } from '../src/public-archives-service.js';
import { SCB_ACCOUNT_CLOSURE } from '../src/account-closure-controller.js';
import type { AccountClosureService } from '../src/account-closure-service.js';
import { ORIGIN, PASSWORD, call, data, membersPath, register } from './support.js';
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
import { createYouthRosterFixture } from './fixtures/youth-registration.js';
import type { YouthRosterFixture } from './fixtures/youth-registration.js';

const databaseUrl = registrationDatabaseUrl(),
  participantDataKey = createHash('sha256')
    .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
    .digest('base64');
const guard = createYouthDataConsentGuard(participantDataKey),
  reader = createYouthQualificationReader(participantDataKey, { dataConsentGuard: guard });
describe(
  'E08 independent adult processing renewal on isolated PostgreSQL',
  { concurrent: false },
  () => {
    let api: Api,
      owner: User,
      leader: Actor,
      reviewer: Actor,
      guardian: Actor,
      subjects: Actor[],
      f: YouthRosterFixture,
      youth: YouthGuardiansService,
      qualification: QualificationPrecheckService,
      closure: AccountClosureService;
    const requests = new Map<string, { preconsentId: string; version: number }>();
    beforeAll(async () => {
      const p = new Pool({ connectionString: databaseUrl });
      try {
        expect((await p.query('SELECT current_database() AS db')).rows[0].db).toMatch(/^scb_test_/);
        await migrate(p);
      } finally {
        await p.end();
      }
      const options = { databaseUrl, appOrigin: ORIGIN, participantDataKey };
      api = await createApi({ ...options, accountClosure: { enabled: true, autoDispatch: false } });
      owner = await register(api, 'e08-adult-owner');
      leader = await participant(api, 'e08-adult-leader');
      reviewer = await participant(api, 'e08-adult-reviewer');
      guardian = await participant(api, 'e08-adult-guardian');
      subjects = [
        await participant(api, 'e08-adult-subject1'),
        await participant(api, 'e08-adult-subject2'),
      ];
      data(
        await call(api, 'put', `${membersPath(owner.orgId)}/${reviewer.id}`, {
          cookie: owner.cookie,
          body: { role: 'REVIEWER', status: 'ACTIVE' },
        }),
      );
      youth = new YouthGuardiansService(api.pool, { ...options, youthQualificationReader: reader });
      qualification = new QualificationPrecheckService(api.pool, options, {
        dataConsentGuard: guard,
      });
      closure = api.app.get<AccountClosureService>(SCB_ACCOUNT_CLOSURE);
      f = await createYouthRosterFixture({
        api,
        owner,
        leader,
        reviewer,
        subjects,
        birthDates: ['1990-01-01', '1991-01-01'],
        requireInsurance: false,
        beforeOpen: async (reg) => {
          await youth.setPolicy(owner.cookie, owner.orgId, reg.event.id, {
            clientRequestId: randomUUID(),
            expectedVersion: null,
            enabled: true,
            guardianAgeThreshold: 18,
          });
        },
        beforeMaterial: async (scope) => {
          if (scope.subject.id !== subjects[0]!.id) return;
          const pre = await youth.inviteData(scope.subject.cookie, scope.orgId, scope.eventId, {
            clientRequestId: randomUUID(),
            guardianUserId: guardian.id,
            expectedPolicyVersion: 1,
            declaredYouth: true,
            subjectAlias: '合成历史青年上下文',
          });
          const consent = await youth.dataDecision(guardian.cookie, pre.preconsentId, {
            clientRequestId: randomUUID(),
            expectedVersion: pre.version,
            decision: 'CONSENT',
            acceptedDataProcessing: true,
            dataTermsVersion: 'youth-data-processing-v1',
          });
          requests.set(scope.subject.id, {
            preconsentId: pre.preconsentId,
            version: consent.version,
          });
        },
      });
      for (let n = 0; n < 2; n++) await qualify(n, f.members[n]!.materialVersion);
    }, 120000);
    afterAll(async () => {
      if (api) {
        await api.app.close();
        await api.pool.end();
      }
    }, 30000);
    function base() {
      return `/v1/orgs/${owner.orgId}/entries/${f.entry.id}/participant-materials`;
    }
    function scope(n = 0) {
      return {
        orgId: owner.orgId,
        eventId: f.registration.event.id,
        userId: subjects[n]!.id,
        entryId: f.entry.id,
        memberId: f.members[n]!.memberId,
      };
    }
    async function locked<T>(work: (c: PoolClient) => Promise<T>) {
      const c = await api.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
          owner.orgId,
          f.registration.event.id,
        ]);
        const v = await work(c);
        await c.query('COMMIT');
        return v;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
    async function qualify(n: number, version: number) {
      const m = f.members[n]!,
        req = await qualification.request(m.actor.cookie, owner.orgId, f.entry.id, {
          clientRequestId: randomUUID(),
          memberId: m.memberId,
          expectedMaterialVersion: version,
          acceptedTermsVersion: 'qualification-precheck-v1',
        });
      return qualification.review(reviewer.cookie, owner.orgId, f.entry.id, {
        clientRequestId: randomUUID(),
        memberId: m.memberId,
        expectedMaterialVersion: version,
        requestId: req.requestId,
        decision: 'APPROVED',
        reason: '合成独立成年身份和照片核验',
        identityReviewed: true,
        portraitReviewed: true,
        signatureReviewed: true,
      });
    }
    async function capability(n = 0) {
      return youth.adultCapability(subjects[n]!.cookie, owner.orgId, f.registration.event.id, {
        entryId: f.entry.id,
        memberId: f.members[n]!.memberId,
      });
    }
    function body(cap: Awaited<ReturnType<typeof capability>>, decision = 'CONSENT') {
      return {
        clientRequestId: randomUUID(),
        entryId: cap.entryId,
        memberId: cap.memberId,
        expectedAdultVersion: cap.expectedAdultVersion,
        decision,
        ...(decision === 'CONSENT'
          ? {
              expectedMaterialVersion: cap.expectedMaterialVersion,
              expectedPolicyVersion: cap.policyVersion,
              evidenceQualificationId: cap.evidenceQualificationId,
              acceptedDataProcessing: true,
              termsVersion: YOUTH_ADULT_DATA_TERMS,
            }
          : {}),
      };
    }
    let grantedId: string, oldAgeEvidence: string, firstProcessingEpoch: string | null;
    test('event policy leaves undeclared adult processing intact; guardian closure blocks the declared context until explicit trusted self renewal', async () => {
      expect(await locked((c) => guard(c, scope(1)))).toMatchObject({
        required: false,
        ready: true,
      });
      const closing = await closure.request(guardian.cookie, {
        clientRequestId: randomUUID(),
        password: PASSWORD,
      });
      expect(await closure.processOne(closing.id)).toBe('CLOSED');
      expect(
        (await api.pool.query('SELECT status FROM users WHERE id=$1', [guardian.id])).rows[0]
          .status,
      ).toBe('DISABLED');
      expect(await locked((c) => guard(c, scope()))).toMatchObject({
        required: true,
        ready: false,
      });
      const cap = await capability();
      expect(cap.canConsent).toBe(true);
      expect(cap.evidenceQualificationId).toEqual(expect.any(String));
      await expect(
        youth.adultCapability(subjects[1]!.cookie, owner.orgId, f.registration.event.id, {
          entryId: f.entry.id,
          memberId: f.members[0]!.memberId,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        youth.adultDataCommand(subjects[0]!.cookie, owner.orgId, f.registration.event.id, {
          ...body(cap),
          age: 99,
        }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        youth.adultDataCommand(subjects[0]!.cookie, owner.orgId, f.registration.event.id, {
          ...body(cap),
          acceptedDataProcessing: false,
        }),
      ).rejects.toMatchObject({ status: 422 });
      const command = body(cap),
        saved = await youth.adultDataCommand(
          subjects[0]!.cookie,
          owner.orgId,
          f.registration.event.id,
          command,
        );
      grantedId = saved.adultConsentId;
      oldAgeEvidence = cap.evidenceQualificationId!;
      firstProcessingEpoch = await locked((c) => readAdultPublicConsentEpoch(c, scope(), 1));
      expect(firstProcessingEpoch).toEqual(expect.any(String));
      expect(
        await youth.adultDataCommand(
          subjects[0]!.cookie,
          owner.orgId,
          f.registration.event.id,
          command,
        ),
      ).toEqual(saved);
      expect(await locked((c) => guard(c, scope()))).toMatchObject({
        required: true,
        ready: true,
        adultConsentId: grantedId,
      });
      expect(
        await locked((c) => guard(c, { ...scope(), entryId: undefined, memberId: undefined })),
      ).toMatchObject({ ready: false });
      expect(await locked((c) => guard(c, { ...scope(), forceRequired: true }))).toMatchObject({
        ready: false,
      });
      expect(
        (
          await call(api, 'get', `${base()}/${f.members[0]!.memberId}/private`, {
            cookie: subjects[0]!.cookie,
          })
        ).status,
      ).toBe(200);
      const stored = (
        await api.pool.query(
          `SELECT to_jsonb(c) AS fact FROM youth_adult_data_consents c WHERE id=$1`,
          [grantedId],
        )
      ).rows[0].fact;
      for (const field of ['identityNumber', 'birthDate', 'realName', 'payloadCiphertext'])
        expect(stored).not.toHaveProperty(field);
    }, 90000);
    test('complete photo revision renews from the same protected identity, normal current precheck stays mandatory, head review/publicity changes do not revoke processing', async () => {
      const picture = (
        await sharp({ create: { width: 32, height: 32, channels: 3, background: '#223344' } })
          .png()
          .toBuffer()
      ).toString('base64');
      const saved = data<{ material: { version: number; revisionId: string } }>(
        await call(api, 'put', `${base()}/mine`, {
          cookie: subjects[0]!.cookie,
          body: {
            clientRequestId: randomUUID(),
            expectedVersion: f.members[0]!.materialVersion,
            portrait: {
              fileName: 'synthetic-new-photo.png',
              contentType: 'image/png',
              base64: picture,
            },
            acceptedTerms: true,
            publicityConsent: true,
          },
        }),
      );
      expect(saved.material.revisionId).not.toBe(f.members[0]!.materialRevisionId);
      expect((await locked((c) => guard(c, scope()))).ready).toBe(false);
      const cap = await capability();
      expect(cap.canConsent).toBe(true);
      expect(cap.evidenceQualificationId).toBe(oldAgeEvidence);
      const consent = await youth.adultDataCommand(
        subjects[0]!.cookie,
        owner.orgId,
        f.registration.event.id,
        body(cap),
      );
      expect((await locked((c) => guard(c, scope()))).ready).toBe(true);
      const normal = {
        orgId: owner.orgId,
        eventId: f.registration.event.id,
        entryId: f.entry.id,
        memberId: f.members[0]!.memberId,
        rosterRevisionId: f.entry.rosterRevisionId!,
        rulesetId: f.entry.rules.id,
        policyDate: f.registration.event.startDate,
      };
      expect((await locked((c) => reader(c, normal))).ready).toBe(false);
      const current = await qualify(0, saved.material.version);
      expect(current.qualificationId).not.toBe(oldAgeEvidence);
      expect((await locked((c) => reader(c, normal))).ready).toBe(true);
      expect((await locked((c) => guard(c, scope()))).ready).toBe(true);
      expect(
        (
          await api.pool.query(
            'SELECT age_evidence_qualification_id FROM youth_adult_data_consents WHERE id=$1',
            [consent.adultConsentId],
          )
        ).rows[0].age_evidence_qualification_id,
      ).toBe(oldAgeEvidence);
      const submitted = data<{ material: { version: number } }>(
        await call(api, 'post', `${base()}/mine/submit`, {
          cookie: subjects[0]!.cookie,
          body: { expectedVersion: saved.material.version },
        }),
      );
      const reviewed = data<{ version: number }>(
        await call(api, 'post', `${base()}/${f.members[0]!.memberId}/review`, {
          cookie: reviewer.cookie,
          body: {
            expectedVersion: submitted.material.version,
            decision: 'APPROVE',
            reason: '合成最终照片及身份核验',
            identityChecked: true,
            portraitChecked: true,
            insuranceChecked: false,
          },
        }),
      );
      expect((await locked((c) => guard(c, scope()))).ready).toBe(true);
      const before = (
        await api.pool.query('SELECT current_revision_id FROM participant_materials WHERE id=$1', [
          f.members[0]!.materialId,
        ])
      ).rows[0].current_revision_id;
      const withdrawn = data<{ material: { publicityConsent: boolean } }>(
        await call(api, 'post', `${base()}/mine/publicity-withdraw`, {
          cookie: subjects[0]!.cookie,
          body: { expectedVersion: reviewed.version },
        }),
      );
      expect(withdrawn.material.publicityConsent).toBe(false);
      expect((await locked((c) => guard(c, scope()))).ready).toBe(true);
      expect(
        (
          await api.pool.query(
            'SELECT current_revision_id FROM participant_materials WHERE id=$1',
            [f.members[0]!.materialId],
          )
        ).rows[0].current_revision_id,
      ).toBe(before);
      const keyless = new YouthGuardiansService(api.pool, { databaseUrl, appOrigin: ORIGIN });
      const fresh = await capability();
      await keyless.adultDataCommand(
        subjects[0]!.cookie,
        owner.orgId,
        f.registration.event.id,
        body(fresh, 'WITHDRAW'),
      );
      expect((await locked((c) => guard(c, scope()))).ready).toBe(false);
      await expect(
        api.pool.query("UPDATE youth_adult_data_consents SET decision='CONSENT' WHERE id=$1", [
          grantedId,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    }, 90000);
    test('closing the independently adult subject appends a keyless data withdrawal fence and retains the age proof', async () => {
      const s = scope(1),
        pre = await youth.inviteData(subjects[1]!.cookie, owner.orgId, s.eventId, {
          clientRequestId: randomUUID(),
          expectedPolicyVersion: 1,
          guardianUserId: owner.id,
          subjectAlias: '合成历史青年上下文乙',
          declaredYouth: true,
        });
      await youth.dataDecision(owner.cookie, pre.preconsentId, {
        clientRequestId: randomUUID(),
        expectedVersion: pre.version,
        decision: 'WITHDRAW',
      });
      const cap = await capability(1);
      expect(cap.canConsent).toBe(true);
      const consent = await youth.adultDataCommand(
        subjects[1]!.cookie,
        owner.orgId,
        s.eventId,
        body(cap),
      );
      const closing = await closure.request(subjects[1]!.cookie, {
        clientRequestId: randomUUID(),
        password: PASSWORD,
      });
      expect(await closure.processOne(closing.id)).toBe('CLOSED');
      const rows = (
        await api.pool.query(
          'SELECT decision,cause,version,age_evidence_qualification_id FROM youth_adult_data_consents WHERE actor_id=$1 ORDER BY version',
          [subjects[1]!.id],
        )
      ).rows;
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        decision: 'WITHDRAW',
        cause: 'ACCOUNT_CLOSURE',
        version: rows[0].version + 1,
        age_evidence_qualification_id: rows[0].age_evidence_qualification_id,
      });
      expect(
        (
          await api.pool.query('SELECT id FROM youth_adult_data_consents WHERE id=$1', [
            consent.adultConsentId,
          ])
        ).rowCount,
      ).toBe(1);
    }, 90000);
    test('adult data renewal after withdrawal cannot restore an old public archive source; a fresh exact publication consent is required', async () => {
      const actors: Actor[] = [];
      for (let n = 0; n < 4; n++) actors.push(await participant(api, 'e08-adult-public-' + n));
      let prior: { id: string; version: number } | undefined;
      const first = await createYouthRosterFixture({
        api,
        owner,
        leader,
        reviewer,
        subjects: actors.slice(0, 2),
        birthDates: ['1992-01-01', '1993-01-01'],
        requireInsurance: false,
        beforeOpen: async (reg) => {
          await youth.setPolicy(owner.cookie, owner.orgId, reg.event.id, {
            clientRequestId: randomUUID(),
            expectedVersion: null,
            enabled: true,
            guardianAgeThreshold: 18,
          });
        },
        beforeMaterial: async (r) => {
          if (r.subject.id !== actors[0]!.id) return;
          const p = await youth.inviteData(r.subject.cookie, r.orgId, r.eventId, {
            clientRequestId: randomUUID(),
            expectedPolicyVersion: 1,
            guardianUserId: owner.id,
            subjectAlias: '合成成年人历史青年上下文',
            declaredYouth: true,
          });
          const consent = await youth.dataDecision(owner.cookie, p.preconsentId, {
            clientRequestId: randomUUID(),
            expectedVersion: p.version,
            decision: 'CONSENT',
            acceptedDataProcessing: true,
            dataTermsVersion: 'youth-data-processing-v1',
          });
          prior = { id: p.preconsentId, version: consent.version };
        },
      });
      const second = await createYouthRosterFixture({
        api,
        owner,
        leader,
        reviewer,
        subjects: actors.slice(2, 4),
        birthDates: ['1994-01-01', '1995-01-01'],
        requireInsurance: false,
        registration: first.registration,
      });
      for (const current of [first, second]) {
        for (const m of current.members) {
          const req = await qualification.request(m.actor.cookie, owner.orgId, current.entry.id, {
            clientRequestId: randomUUID(),
            memberId: m.memberId,
            expectedMaterialVersion: m.materialVersion,
            acceptedTermsVersion: 'qualification-precheck-v1',
          });
          await qualification.review(reviewer.cookie, owner.orgId, current.entry.id, {
            clientRequestId: randomUUID(),
            memberId: m.memberId,
            expectedMaterialVersion: m.materialVersion,
            requestId: req.requestId,
            decision: 'APPROVED',
            reason: '合成成年人资格独立核验',
            identityReviewed: true,
            portraitReviewed: true,
            signatureReviewed: true,
          });
          const submitted = data<{ material: { version: number } }>(
            await call(
              api,
              'post',
              `/v1/orgs/${owner.orgId}/entries/${current.entry.id}/participant-materials/mine/submit`,
              { cookie: m.actor.cookie, body: { expectedVersion: m.materialVersion } },
            ),
          );
          data(
            await call(
              api,
              'post',
              `/v1/orgs/${owner.orgId}/entries/${current.entry.id}/participant-materials/${m.memberId}/review`,
              {
                cookie: reviewer.cookie,
                body: {
                  expectedVersion: submitted.material.version,
                  decision: 'APPROVE',
                  reason: '合成成年人最终材料核验',
                  identityChecked: true,
                  portraitChecked: true,
                  insuranceChecked: false,
                },
              },
            ),
          );
        }
        let currentEntry = await getEntry(api, owner, current.entry.id);
        currentEntry = await command(api, owner, currentEntry, leader, 'SUBMIT');
        await command(api, owner, currentEntry, owner, 'APPROVE');
      }
      const target = actors[0]!,
        member = first.members[0]!,
        event = first.registration.event.id;
      await youth.dataDecision(owner.cookie, prior!.id, {
        clientRequestId: randomUUID(),
        expectedVersion: prior!.version,
        decision: 'WITHDRAW',
      });
      const renew = async () => {
        const c = await youth.adultCapability(target.cookie, owner.orgId, event, {
          entryId: first.entry.id,
          memberId: member.memberId,
        });
        return youth.adultDataCommand(target.cookie, owner.orgId, event, body(c));
      };
      const original = await renew();
      let reg = await registration(api, owner, event);
      reg = await registrationCommand(api, owner, reg, 'CLOSE_REGISTRATION');
      await registrationCommand(api, owner, reg, 'FREEZE_REGISTRATION');
      const publicArchives = new PublicArchivesService(api.pool, {
          databaseUrl,
          appOrigin: ORIGIN,
          participantDataKey,
        }),
        profile = await publicArchives.create(target.cookie, {
          commandId: randomUUID(),
          kind: 'PLAYER',
          displayName: '合成成年独立公开许可',
        });
      const nominate = () =>
        publicArchives.nominate(owner.cookie, {
          commandId: randomUUID(),
          profileId: profile.id,
          orgId: owner.orgId,
          eventId: event,
          teamId: first.team.id,
          memberId: member.memberId,
          publisherConsent: true,
          reason: '合成精确来源独立公开提名',
        });
      const source = await nominate(),
        accepted = await publicArchives.sourceCommand(target.cookie, source.id, {
          commandId: randomUUID(),
          expectedVersion: source.version,
          type: 'CONSENT',
          playerConsent: true,
          reason: '合成本人初次独立公开许可',
        }),
        published = await publicArchives.command(target.cookie, profile.id, {
          commandId: randomUUID(),
          expectedVersion: profile.version,
          type: 'PUBLISH',
          publicConsent: true,
        });
      expect(
        (await publicArchives.publicOne(published.publicKey!, 'adult-epoch')).authorizedSourceCount,
      ).toBe(1);
      await youth.adultDataCommand(target.cookie, owner.orgId, event, {
        clientRequestId: randomUUID(),
        entryId: first.entry.id,
        memberId: member.memberId,
        expectedAdultVersion: original.version,
        decision: 'WITHDRAW',
      });
      await expect(
        publicArchives.publicOne(published.publicKey!, 'adult-epoch'),
      ).rejects.toMatchObject({ status: 404 });
      await renew();
      data(
        await call(
          api,
          'get',
          `/v1/orgs/${owner.orgId}/entries/${first.entry.id}/participant-materials/${member.memberId}/private`,
          { cookie: target.cookie },
        ),
      );
      await expect(
        publicArchives.publicOne(published.publicKey!, 'adult-epoch'),
      ).rejects.toMatchObject({ status: 404 });
      await publicArchives.sourceCommand(target.cookie, source.id, {
        commandId: randomUUID(),
        expectedVersion: accepted.version,
        type: 'REVOKE',
        reason: '合成撤旧许可并重新单独确认',
      });
      const replacement = await nominate();
      await publicArchives.sourceCommand(target.cookie, replacement.id, {
        commandId: randomUUID(),
        expectedVersion: replacement.version,
        type: 'CONSENT',
        playerConsent: true,
        reason: '合成资料恢复后新公开用途许可',
      });
      expect(
        (await publicArchives.publicOne(published.publicKey!, 'adult-epoch')).authorizedSourceCount,
      ).toBe(1);
    }, 120000);
  },
);
