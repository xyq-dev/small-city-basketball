/** Real two-connection PostgreSQL isolation; all users/identity/evidence are synthetic. */
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import sharp from 'sharp';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { PublicArchivesService } from '../src/public-archives-service.js';
import { YouthGuardiansService } from '../src/youth-guardians-service.js';
import { QualificationPrecheckService } from '../src/qualification-precheck-service.js';
import { createYouthDataConsentGuard } from '../src/youth-guardians-eligibility.js';
import { YOUTH_ADULT_DATA_TERMS } from '../src/youth-adult-data-consent.js';
import { ORIGIN, call, createEvent, data, register } from './support.js';
import type { Api, User } from './support.js';
import {
  APPLICATION_NAME,
  entry,
  participant,
  registrationCommand,
  registrationDatabaseUrl,
  roster,
  rules,
  rulesPath,
  team,
  teamPath,
} from './p03-support.js';
import type { Actor } from './p03-support.js';
import { syntheticYouthIdentity } from './fixtures/youth-registration.js';
const databaseUrl = registrationDatabaseUrl(),
  participantDataKey = createHash('sha256')
    .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
    .digest('base64');
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
class PausedArchive extends PublicArchivesService {
  readonly selected = deferred();
  readonly resume = deferred();
  attempts = 0;
  protected override async lockPublicSources(c: PoolClient, profiles: Record<string, any>[]) {
    this.attempts++;
    if (this.attempts === 1) {
      this.selected.resolve();
      await this.resume.promise;
    }
    return super.lockPublicSources(c, profiles);
  }
  observe<T>(work: (c: PoolClient) => Promise<T>) {
    return this.snapshotRead(work);
  }
}
describe('E08 RR authority fences on isolated PostgreSQL', { concurrent: false }, () => {
  let api: Api,
    owner: User,
    subject: Actor,
    guardian: Actor,
    youth: YouthGuardiansService,
    eventId: string,
    entryId: string,
    memberId: string,
    materialVersion: number;
  let preconsentId: string, preconsentVersion: number;
  const options = { databaseUrl, appOrigin: ORIGIN, participantDataKey },
    dataGuard = createYouthDataConsentGuard(participantDataKey);
  beforeAll(async () => {
    const p = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(p);
    } finally {
      await p.end();
    }
    api = await createApi(options);
    owner = await register(api, 'e08-fence-owner');
    subject = await participant(api, 'e08-fence-subject');
    guardian = await participant(api, 'e08-fence-guardian');
    youth = new YouthGuardiansService(api.pool, options);
    const created = await createEvent(api, owner, 'E08合成独立青年事件'),
      configured = data<any>(
        await call(api, 'put', rulesPath(owner.orgId, created.id), {
          cookie: owner.cookie,
          body: rules(created.version, {
            requireParticipantMaterials: true,
            requireIdentity: true,
            requireInsurance: false,
            minPlayers: 2,
            maxPlayers: 2,
          }),
        }),
      );
    eventId = created.id;
    await youth.setPolicy(owner.cookie, owner.orgId, eventId, {
      clientRequestId: randomUUID(),
      expectedVersion: null,
      enabled: true,
      guardianAgeThreshold: 18,
    });
    await registrationCommand(api, owner, configured, 'OPEN_REGISTRATION');
    const target = await team(api, owner, '合成全局phantom球队', subject, [
      '合成本人',
      '合成队员乙',
    ]);
    memberId = target.members[0]!.id;
    const claim = data<{ claimId: string }>(
      await call(api, 'post', `${teamPath(owner.orgId, target.id)}/members/${memberId}/claims`, {
        cookie: subject.cookie,
        body: { targetUserId: subject.id },
      }),
      201,
    );
    data(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: subject.cookie,
        body: {},
      }),
    );
    let current = await entry(api, owner, eventId, target, subject);
    current = await roster(api, owner, current, subject, target.members);
    entryId = current.id;
  }, 90000);
  afterAll(async () => {
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  }, 30000);
  async function logicalHash(table: 'users' | 'events', id: string) {
    return (
      await api.pool.query(
        `SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM ${table} r WHERE id=$1`,
        [id],
      )
    ).rows[0].hash;
  }
  test('a first youth declaration in another event restarts the real old public profile read through the common user tuple', async () => {
    const normal = new PublicArchivesService(api.pool, options),
      profile = await normal.create(subject.cookie, {
        commandId: randomUUID(),
        kind: 'PLAYER',
        displayName: '合成旧成人空公开档案',
      }),
      published = await normal.command(subject.cookie, profile.id, {
        commandId: randomUUID(),
        expectedVersion: profile.version,
        type: 'PUBLISH',
        publicConsent: true,
      });
    // Empty published adult profiles are the existing compatible baseline; no youth material exists yet.
    expect((await normal.publicOne(published.publicKey!, 'e08-fence')).displayName).toBe(
      '合成旧成人空公开档案',
    );
    const before = await logicalHash('users', subject.id),
      reader = new PausedArchive(api.pool, options);
    const inviteBody = {
      clientRequestId: randomUUID(),
      expectedPolicyVersion: 1,
      guardianUserId: guardian.id,
      subjectAlias: '合成历史青年上下文',
      declaredYouth: true,
    };
    const reading = reader.publicOne(published.publicKey!, 'e08-fence');
    await reader.selected.promise;
    try {
      const invited = await youth.inviteData(subject.cookie, owner.orgId, eventId, inviteBody);
      preconsentId = invited.preconsentId;
      preconsentVersion = invited.version;
    } finally {
      reader.resume.resolve();
    }
    await expect(reading).rejects.toMatchObject({ status: 404 });
    expect(reader.attempts).toBe(2);
    expect(await logicalHash('users', subject.id)).toBe(before);
    await expect(normal.publicOne(published.publicKey!, 'e08-fence')).rejects.toMatchObject({
      status: 404,
    });
    const share = await api.pool.connect();
    try {
      await share.query('BEGIN');
      await share.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [subject.id]);
      // Replaying the same receipt is a read and must not upgrade the already-declared user tuple.
      expect(await youth.inviteData(subject.cookie, owner.orgId, eventId, inviteBody)).toEqual({
        preconsentId,
        version: preconsentVersion,
      });
    } finally {
      await share.query('ROLLBACK');
      share.release();
    }
  }, 90000);
  test('an immutable adult withdrawal after a real event-lock wait invalidates an already-started RR authority snapshot without changing business event data', async () => {
    const accepted = await youth.dataDecision(guardian.cookie, preconsentId, {
      clientRequestId: randomUUID(),
      expectedVersion: preconsentVersion,
      decision: 'CONSENT',
      acceptedDataProcessing: true,
      dataTermsVersion: 'youth-data-processing-v1',
    });
    expect(accepted.version).toBeGreaterThan(preconsentVersion);
    const photo = (
      await sharp({ create: { width: 32, height: 32, channels: 3, background: '#3b5268' } })
        .png()
        .toBuffer()
    ).toString('base64');
    const material = data<{ material: { version: number } }>(
      await call(
        api,
        'put',
        `/v1/orgs/${owner.orgId}/entries/${entryId}/participant-materials/mine`,
        {
          cookie: subject.cookie,
          body: {
            clientRequestId: randomUUID(),
            expectedVersion: 0,
            realName: '合成独立成年本人',
            identityNumber: syntheticYouthIdentity('1990-01-01'),
            portrait: { fileName: 'synthetic-fence.png', contentType: 'image/png', base64: photo },
            acceptedTerms: true,
            publicityConsent: false,
          },
        },
      ),
    );
    materialVersion = material.material.version;
    const q = new QualificationPrecheckService(api.pool, options, { dataConsentGuard: dataGuard }),
      request = await q.request(subject.cookie, owner.orgId, entryId, {
        clientRequestId: randomUUID(),
        memberId,
        expectedMaterialVersion: materialVersion,
        acceptedTermsVersion: 'qualification-precheck-v1',
      });
    await q.review(owner.cookie, owner.orgId, entryId, {
      clientRequestId: randomUUID(),
      memberId,
      expectedMaterialVersion: materialVersion,
      requestId: request.requestId,
      decision: 'APPROVED',
      reason: '合成独立年龄证据核验',
      identityReviewed: true,
      portraitReviewed: true,
      signatureReviewed: true,
    });
    const cap = await youth.adultCapability(subject.cookie, owner.orgId, eventId, {
      entryId,
      memberId,
    });
    const adult = await youth.adultDataCommand(subject.cookie, owner.orgId, eventId, {
      clientRequestId: randomUUID(),
      entryId,
      memberId,
      expectedMaterialVersion: cap.expectedMaterialVersion,
      expectedAdultVersion: cap.expectedAdultVersion,
      expectedPolicyVersion: cap.policyVersion,
      evidenceQualificationId: cap.evidenceQualificationId,
      decision: 'CONSENT',
      acceptedDataProcessing: true,
      termsVersion: YOUTH_ADULT_DATA_TERMS,
    });
    const before = await logicalHash('events', eventId),
      paused = deferred(),
      resume = deferred();
    let attempts = 0;
    const observed: string[] = [];
    const probe = new PausedArchive(api.pool, options),
      reading = probe.observe(async (c) => {
        attempts++;
        observed.push(
          (
            await c.query(
              'SELECT decision FROM youth_adult_data_consents WHERE actor_id=$1 ORDER BY version DESC LIMIT 1',
              [subject.id],
            )
          ).rows[0].decision,
        );
        if (attempts === 1) {
          paused.resolve();
          await resume.promise;
        }
        await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE NOWAIT', [
          owner.orgId,
          eventId,
        ]);
        return dataGuard(c, { orgId: owner.orgId, eventId, userId: subject.id, entryId, memberId });
      });
    await paused.promise;
    const blocking = await api.pool.connect();
    let writing: Promise<unknown> | undefined;
    try {
      await blocking.query('BEGIN');
      await blocking.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE', [
        owner.orgId,
        eventId,
      ]);
      writing = youth.adultDataCommand(subject.cookie, owner.orgId, eventId, {
        clientRequestId: randomUUID(),
        entryId,
        memberId,
        expectedAdultVersion: adult.version,
        decision: 'WITHDRAW',
      });
      let waiting = false;
      for (let n = 0; n < 150; n++) {
        waiting = Boolean(
          (
            await api.pool.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock' AND query LIKE '%FROM events e WHERE%' AND query LIKE '%FOR UPDATE OF e%' LIMIT 1`,
              [APPLICATION_NAME],
            )
          ).rowCount,
        );
        if (waiting) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      await blocking.query('COMMIT');
      await writing;
      resume.resolve();
      expect(await reading).toMatchObject({ ready: false });
      expect(attempts).toBe(2);
      expect(observed).toEqual(['CONSENT', 'WITHDRAW']);
      expect(await logicalHash('events', eventId)).toBe(before);
    } finally {
      await blocking.query('ROLLBACK');
      blocking.release();
      resume.resolve();
      if (writing) await writing.catch(() => {});
      await reading.catch(() => {});
    }
  }, 90000);
});
