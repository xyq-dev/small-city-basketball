import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { migrate } from '../src/database/migrate.js';
import { hashPassword, hashToken } from '../src/security.js';
import { AccountClosureService } from '../src/account-closure-service.js';
import { createAccountClosureHooks } from '../src/account-closure-hooks.js';
import { InsuranceService, revokeInsuranceForClosure } from '../src/insurance-service.js';
import { TradeService } from '../src/trade-service.js';
import { readStreamingClosureBlockers, revokeStreamingPrivacy } from '../src/streaming-privacy.js';
import { NotificationService, revokeNotificationGrants } from '../src/notification-service.js';
import { YouthGuardiansService } from '../src/youth-guardians-service.js';
import { revokeYouthForClosure } from '../src/youth-guardians-eligibility.js';
import { YOUTH_DATA_TERMS_VERSION } from '../src/youth-guardians-domain.js';
import { createYouthRosterFixture } from './fixtures/youth-registration.js';
import {
  ORIGIN,
  PASSWORD,
  RUN_ID,
  login,
  membership,
  register,
  testDatabaseUrl,
} from './support.js';
import type { Api, User } from './support.js';

// Actual six-domain DB helpers, synthetic transport only. No money, policy issue,
// push, live ingress, or external service is contacted by this suite.
const databaseUrl = testDatabaseUrl();
const participantDataKey = createHash('sha256')
  .update(`synthetic-c23-restart:${new URL(databaseUrl).pathname.slice(1)}`)
  .digest('base64');
const configuration = { databaseUrl, appOrigin: ORIGIN, participantDataKey };
describe('E07 real cross-domain closure hooks on PostgreSQL', { concurrent: false }, () => {
  let api: Api, closure: AccountClosureService;
  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
    api = await createApi({ ...configuration, accountClosure: { autoDispatch: false } });
    const insurance = new InsuranceService(api.pool, configuration);
    const trade = new TradeService(api.pool, configuration);
    const hooks = createAccountClosureHooks({
      streaming: { inspect: readStreamingClosureBlockers, revoke: revokeStreamingPrivacy },
      insurance: {
        inspect: (c, id) => insurance.closureBlockers(c, id),
        revoke: revokeInsuranceForClosure,
      },
      trade: { assertSafe: (c, id) => trade.assertAccountClosureSafe(c, id) },
      notifications: { revoke: revokeNotificationGrants },
      guardians: { revoke: revokeYouthForClosure },
    });
    expect(hooks).toBeDefined();
    closure = new AccountClosureService(api.pool, configuration, {
      enabled: true,
      autoDispatch: false,
      hooks,
    });
  }, 120000);
  afterAll(async () => {
    if (api) {
      await api.app.close();
      await api.pool.end();
    }
  }, 30000);
  async function user(label: string): Promise<User> {
    const u = {
      id: randomUUID(),
      orgId: '',
      email: `e07-domains-${label}-${RUN_ID}@example.test`,
      cookie: '',
    };
    await api.pool.query(
      'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [u.id, u.email, '合成跨域账号 ' + label, await hashPassword(PASSWORD)],
    );
    u.cookie = await login(api, u);
    return u;
  }
  const input = () => ({ clientRequestId: randomUUID(), password: PASSWORD });
  test('closes a real notification permission and its WX binding through all six actual helpers', async () => {
    const u = await user('notification'),
      appId = 'wx1234567890abcdef',
      openid = 'synthetic-e07-closure-openid';
    await api.pool.query(
      'INSERT INTO wechat_identities(id,user_id,app_id,openid_hash) VALUES($1,$2,$3,$4)',
      [randomUUID(), u.id, appId, hashToken(appId + '\n' + openid)],
    );
    const notifications = new NotificationService(api.pool, configuration, {
      appId,
      encryptionKey: Buffer.alloc(32, 55).toString('base64'),
      autoDispatch: false,
      templates: {
        MATCH_STARTING: {
          id: 'synthetic-closure-start',
          fields: { thing1: 'event', time2: 'time' },
        },
      },
      exchange: { exchange: async () => ({ appId, openid }) },
      provider: {
        send: async () => {
          throw new Error('This test must never send');
        },
      },
    });
    const intent = await notifications.createIntent(u.cookie, {
      clientRequestId: randomUUID(),
      kind: 'MATCH_STARTING',
    });
    const confirmed = await notifications.confirm(u.cookie, {
      clientRequestId: randomUUID(),
      intentId: intent.id,
      result: 'accept',
      code: randomUUID(),
    });
    expect(confirmed?.state).toBe('ACCEPTED');
    expect(
      (
        await api.pool.query(
          'SELECT target_cipher FROM notification_subscription_grants WHERE user_id=$1',
          [u.id],
        )
      ).rows[0].target_cipher,
    ).toBeTruthy();
    const request = await closure.request(u.cookie, input());
    expect(await closure.processOne(request.id)).toBe('CLOSED');
    expect(
      (
        await api.pool.query(
          'SELECT status,target_cipher FROM notification_subscription_grants WHERE user_id=$1',
          [u.id],
        )
      ).rows[0],
    ).toEqual({ status: 'REVOKED', target_cipher: null });
    expect(
      (await api.pool.query('SELECT status FROM wechat_identities WHERE user_id=$1', [u.id]))
        .rows[0].status,
    ).toBe('REVOKED');
    notifications.onModuleDestroy();
  });
  test('withdraws actual guardian data consent and binding while retaining encrypted material and roster history', async () => {
    const owner = await register(api, 'e07-domain-owner'),
      leader = await user('leader'),
      reviewer = await user('reviewer'),
      guardian = await user('guardian');
    const subjects = [await user('child-a'), await user('child-b')];
    await membership(api, owner, reviewer, 'REVIEWER');
    const youth = new YouthGuardiansService(api.pool, configuration);
    let policyVersion = 0;
    const f = await createYouthRosterFixture({
      api,
      owner,
      leader,
      reviewer,
      subjects,
      birthDates: ['2018-01-01', '2018-02-01'],
      requireInsurance: false,
      beforeOpen: async (r) => {
        await youth.setPolicy(owner.cookie, owner.orgId, r.event.id, {
          clientRequestId: randomUUID(),
          expectedVersion: null,
          enabled: true,
          guardianAgeThreshold: 18,
        });
        policyVersion = (
          await api.pool.query(
            'SELECT version FROM youth_event_policies WHERE org_id=$1 AND event_id=$2',
            [owner.orgId, r.event.id],
          )
        ).rows[0].version;
      },
      beforeMaterial: async (r) => {
        const invitation = await youth.inviteData(r.subject.cookie, r.orgId, r.eventId, {
          clientRequestId: randomUUID(),
          expectedPolicyVersion: policyVersion,
          guardianUserId: guardian.id,
          subjectAlias: '合成儿童',
          declaredYouth: true,
        });
        await youth.dataDecision(guardian.cookie, invitation.preconsentId, {
          clientRequestId: randomUUID(),
          expectedVersion: invitation.version,
          decision: 'CONSENT',
          acceptedDataProcessing: true,
          dataTermsVersion: YOUTH_DATA_TERMS_VERSION,
        });
      },
    });
    const target = subjects[0]!,
      material = f.members[0]!;
    const retained = (
      await api.pool.query(
        'SELECT payload_ciphertext FROM participant_material_revisions WHERE id=$1',
        [material.materialRevisionId],
      )
    ).rows[0].payload_ciphertext;
    const rosterBefore = (
      await api.pool.query(
        'SELECT * FROM entry_roster_players WHERE entry_id=$1 ORDER BY member_id',
        [f.entry.id],
      )
    ).rows;
    const request = await closure.request(target.cookie, input());
    expect(await closure.processOne(request.id)).toBe('CLOSED');
    expect(
      (
        await api.pool.query(
          'SELECT status FROM youth_guardian_preconsents WHERE subject_user_id=$1',
          [target.id],
        )
      ).rows[0].status,
    ).toBe('WITHDRAWN');
    expect(
      (
        await api.pool.query('SELECT status FROM team_member_bindings WHERE user_id=$1', [
          target.id,
        ])
      ).rows[0].status,
    ).toBe('ENDED');
    expect(
      (
        await api.pool.query('SELECT publicity_consent FROM participant_materials WHERE id=$1', [
          material.materialId,
        ])
      ).rows[0].publicity_consent,
    ).toBe(false);
    expect(
      (
        await api.pool.query(
          'SELECT payload_ciphertext FROM participant_material_revisions WHERE id=$1',
          [material.materialRevisionId],
        )
      ).rows[0].payload_ciphertext,
    ).toBe(retained);
    expect(
      (
        await api.pool.query(
          'SELECT * FROM entry_roster_players WHERE entry_id=$1 ORDER BY member_id',
          [f.entry.id],
        )
      ).rows,
    ).toEqual(rosterBefore);
    expect(
      (await api.pool.query('SELECT status FROM users WHERE id=$1', [guardian.id])).rows[0].status,
    ).toBe('ACTIVE');
  }, 60000);
});
