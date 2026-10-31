import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotificationService } from '../apps/api/dist/notification-service.js';
import { WechatService } from '../apps/api/dist/wechat-service.js';

const appId = 'wx1234567890abcdef';
const encryptionKey = Buffer.alloc(32, 55).toString('base64');
const templates = {
  REGISTRATION_REVIEW: { id: 'synthetic-review', fields: { thing1: 'event', thing2: 'detail' } },
  MATCH_RESCHEDULED: { id: 'synthetic-change', fields: { thing1: 'event', time2: 'time' } },
  MATCH_STARTING: { id: 'synthetic-start', fields: { thing1: 'event', time2: 'time' } },
};
const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const tables = [
  'notification_configuration',
  'notification_source_events',
  'notification_messages',
  'notification_subscription_intents',
  'notification_subscription_grants',
  'notification_deliveries',
  'notification_fanout_state',
  'notification_delivery_attempts',
  'notification_commands',
  'notification_start_scan',
];
function references(saved) {
  assert.match(saved?.sourceDatabase ?? '', /^scb_test_[A-Za-z0-9_]+$/);
  for (const name of [
    'orgId',
    'eventId',
    'entryId',
    'userId',
    'sourceId',
    'messageId',
    'deliveryId',
    'usedGrantId',
    'retainedGrantId',
    'pendingIntentId',
    'revokeCommandId',
  ])
    assert.ok(uuid(saved?.refs?.[name]), 'E05 recovery requires its exact ' + name);
  for (const table of tables) {
    assert.ok(saved?.tables?.[table]?.count > 0, 'E05 requires nonempty ' + table);
    assert.match(saved.tables[table].hash, /^[0-9a-f]{64}$/);
    assert.match(saved.tables[table].retainedHash, /^[0-9a-f]{64}$/);
  }
}
async function isolated(runtimePool, readPool, databaseUrl, appOrigin) {
  const url = new URL(databaseUrl),
    name = decodeURIComponent(url.pathname.slice(1));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.match(name, /^scb_test_[A-Za-z0-9_]+$/);
  const runtime = (
    await runtimePool.query(
      'SELECT current_database() AS name,current_user AS role,pg_backend_pid() AS pid',
    )
  ).rows[0];
  assert.equal(runtime.name, name);
  assert.equal((await readPool.query('SELECT current_database() AS name')).rows[0].name, name);
  if (runtime.role !== 'scb_runtime') {
    const local = new Set(['localhost', '127.0.0.1', '::1', '[::1]']),
      origin = new URL(appOrigin);
    assert.ok(
      local.has(url.hostname) && origin.protocol === 'http:' && local.has(origin.hostname),
      'E05 owner capture only uses loopback',
    );
    assert.equal(runtime.role, decodeURIComponent(url.username));
  }
  assert.equal(
    (
      await readPool.query(
        'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3',
        [runtime.pid, name, runtime.role],
      )
    ).rowCount,
    1,
    'E05 writer/reader must use the same owned isolated cluster',
  );
  return name;
}
async function snapshot(readPool, saved) {
  const r = saved.refs;
  const scopes = {
    notification_configuration: ['singleton=true', []],
    notification_source_events: ['id=$1', [r.sourceId]],
    notification_messages: [
      'id=$1 AND source_id=$2 AND user_id=$3',
      [r.messageId, r.sourceId, r.userId],
    ],
    notification_subscription_intents: ['user_id=$1', [r.userId]],
    notification_subscription_grants: ['user_id=$1', [r.userId]],
    notification_deliveries: ['id=$1 AND message_id=$2', [r.deliveryId, r.messageId]],
    notification_fanout_state: ['source_id=$1', [r.sourceId]],
    notification_delivery_attempts: ['delivery_id=$1', [r.deliveryId]],
    notification_commands: ['user_id=$1', [r.userId]],
    notification_start_scan: ['singleton=true', []],
  };
  const mutable = {
    notification_subscription_intents: ['status', 'confirm_request_id', 'finished_at'],
    notification_subscription_grants: ['status', 'target_cipher', 'used_at', 'revoked_at'],
  };
  const result = {};
  for (const name of tables) {
    const [where, values] = scopes[name],
      columns = mutable[name] ?? [];
    // JSON, raw recipients and ciphertext stay inside PostgreSQL. Only counts/digests leave.
    const record = columns.length
      ? `to_jsonb(t)-ARRAY[${columns.map((v) => "'" + v + "'").join(',')}]`
      : 'to_jsonb(t)';
    const row = (
      await readPool.query(
        `SELECT count(*)::int AS count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash,encode(sha256(convert_to(COALESCE(jsonb_agg(${record} ORDER BY (${record})::text),'[]'::jsonb)::text,'UTF8')),'hex') AS "retainedHash" FROM ${name} t WHERE ${where}`,
        values,
      )
    ).rows[0];
    result[name] = row;
  }
  const facts = (
    await readPool.query(
      `SELECT
    (SELECT state FROM notification_deliveries WHERE id=$1) AS delivery,
    (SELECT state FROM notification_delivery_attempts WHERE delivery_id=$1 AND grant_id=$2) AS attempt,
    (SELECT count(*)::int FROM notification_subscription_grants WHERE user_id=$3 AND status IN('AVAILABLE','RESERVED')) AS active_grants,
    (SELECT count(*)::int FROM notification_subscription_grants WHERE user_id=$3 AND target_cipher IS NOT NULL) AS encrypted_targets,
    (SELECT status FROM notification_subscription_intents WHERE id=$4) AS pending_intent,
    (SELECT count(*)::int FROM notification_messages WHERE id=$5 AND read_at IS NOT NULL) AS read_messages`,
      [r.deliveryId, r.usedGrantId, r.userId, r.pendingIntentId, r.messageId],
    )
  ).rows[0];
  return { tables: result, facts };
}

/** Controlled synthetic provider only. No official token, code exchange or external send occurs. */
export async function captureExpansionNotifications({
  call,
  state,
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  suffix,
  registerSynthetic,
}) {
  const sourceDatabase = await isolated(runtimePool, readPool, databaseUrl, appOrigin);
  assert.equal(typeof registerSynthetic, 'function');
  const orgId = state.orgId,
    eventId = state.registration?.workspace?.event?.id,
    entryId = state.registration?.entries?.[0]?.id;
  for (const v of [orgId, eventId, entryId])
    assert.ok(uuid(v), 'E05 requires the existing committed approved registration source');
  const actor = await registerSynthetic('合成通知恢复验收员'),
    userId = actor.userId ?? actor.id;
  assert.ok(uuid(userId) && typeof actor.cookie === 'string' && typeof actor.password === 'string');
  assert.notEqual(userId, state.userId, 'E05 does not mutate old captured actors or sessions');
  await call(`/v1/orgs/${orgId}/members/${userId}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  await call(`/v1/orgs/${orgId}/events/${eventId}/staff/${userId}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  const target = 'synthetic_e05_' + userId.replaceAll('-', ''),
    exchange = { exchange: async () => ({ appId, openid: target }) };
  const options = { databaseUrl, appOrigin };
  const wechat = new WechatService(runtimePool, options, {
    configuration: { enabled: true, appId, appSecret: 'SYNTHETIC_WECHAT_SECRET_E05_RECOVERY' },
    exchange,
  });
  const ip = 'synthetic-e05-recovery-' + String(suffix);
  const challenge = await wechat.challenge(
    actor.cookie,
    { purpose: 'BIND', consent: true, password: actor.password },
    ip,
  );
  await wechat.bind(
    actor.cookie,
    {
      challengeId: challenge.challengeId,
      state: challenge.state,
      code: randomUUID(),
      consent: true,
    },
    ip,
  );
  let sends = 0;
  const notifications = new NotificationService(runtimePool, options, {
    appId,
    encryptionKey,
    exchange,
    templates,
    autoDispatch: false,
    provider: {
      send: async () => {
        sends++;
        const committed = (
          await readPool.query(
            "SELECT count(*)::int AS n FROM notification_deliveries d JOIN notification_messages m ON m.id=d.message_id JOIN notification_delivery_attempts a ON a.delivery_id=d.id AND a.grant_id=d.grant_id WHERE m.user_id=$1 AND d.state='SENDING' AND a.state='SENDING'",
            [userId],
          )
        ).rows[0].n;
        assert.equal(
          committed,
          1,
          'SENDING and logical attempt must commit before the synthetic unknown boundary',
        );
        return { state: 'UNKNOWN' };
      },
    },
  });
  try {
    await notifications.assertConfiguration();
    const c = await runtimePool.connect();
    let sourceId;
    try {
      await c.query('BEGIN');
      sourceId = await notifications.capture(c, {
        kind: 'REGISTRATION_REVIEW',
        orgId,
        eventId,
        resourceId: entryId,
      });
      assert.ok(uuid(sourceId));
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    await notifications.fanout(sourceId);
    const message = (
      await readPool.query(
        'SELECT m.id,d.id AS delivery_id FROM notification_messages m JOIN notification_deliveries d ON d.message_id=m.id WHERE m.source_id=$1 AND m.user_id=$2',
        [sourceId, userId],
      )
    ).rows[0];
    assert.ok(message && uuid(message.id) && uuid(message.delivery_id));
    await notifications.read(actor.cookie, message.id, { clientRequestId: randomUUID() });
    const allow = async () => {
      const intent = await notifications.createIntent(actor.cookie, {
        clientRequestId: randomUUID(),
        kind: 'REGISTRATION_REVIEW',
      });
      const result = await notifications.confirm(actor.cookie, {
        clientRequestId: randomUUID(),
        intentId: intent.id,
        result: 'accept',
        code: randomUUID(),
      });
      assert.equal(result.state, 'ACCEPTED');
      assert.ok(uuid(result.subscriptionId));
      return result.subscriptionId;
    };
    const usedGrantId = await allow();
    for (let attempt = 0; attempt < 5; attempt++) {
      await notifications.drain(sourceId);
      if (
        (
          await readPool.query('SELECT state FROM notification_deliveries WHERE id=$1', [
            message.delivery_id,
          ])
        ).rows[0].state === 'UNKNOWN'
      )
        break;
    }
    assert.equal(sends, 1);
    await notifications.drain(sourceId);
    assert.equal(sends, 1, 'UNKNOWN cannot be sent again automatically');
    const revokeCommandId = randomUUID();
    await notifications.revoke(actor.cookie, {
      kind: 'REGISTRATION_REVIEW',
      clientRequestId: revokeCommandId,
    });
    const retainedGrantId = await allow();
    const pending = await notifications.createIntent(actor.cookie, {
      clientRequestId: randomUUID(),
      kind: 'REGISTRATION_REVIEW',
    });
    // An old permanent revoke receipt cannot erase the newly accepted permission.
    await notifications.revoke(actor.cookie, {
      kind: 'REGISTRATION_REVIEW',
      clientRequestId: revokeCommandId,
    });
    const saved = {
      sourceDatabase,
      version: 1,
      refs: {
        orgId,
        eventId,
        entryId,
        userId,
        sourceId,
        messageId: message.id,
        deliveryId: message.delivery_id,
        usedGrantId,
        retainedGrantId,
        pendingIntentId: pending.id,
        revokeCommandId,
      },
      startScanEvidence: 'migration-seed-only',
    };
    const retained = await snapshot(readPool, saved);
    saved.tables = retained.tables;
    assert.equal(retained.facts.delivery, 'UNKNOWN');
    assert.equal(retained.facts.attempt, 'UNKNOWN');
    assert.equal(retained.facts.active_grants, 1);
    assert.equal(retained.facts.encrypted_targets, 1);
    assert.equal(retained.facts.pending_intent, 'PENDING');
    assert.equal(retained.facts.read_messages, 1);
    references(saved);
    return saved;
  } finally {
    notifications.onModuleDestroy();
  }
}
/** Read-only exact restart/restore verification. Provider and all service writers stay unconstructed. */
export async function verifyExpansionNotifications({ readPool, saved }) {
  references(saved);
  const actual = await snapshot(readPool, saved);
  assert.deepEqual(
    actual.tables,
    saved.tables,
    'E05 all ten nonempty linked tables survive exactly',
  );
  assert.equal(actual.facts.delivery, 'UNKNOWN');
  assert.equal(actual.facts.attempt, 'UNKNOWN');
  assert.equal(actual.facts.active_grants, 1);
  assert.equal(actual.facts.encrypted_targets, 1);
  assert.equal(actual.facts.pending_intent, 'PENDING');
  assert.equal(actual.facts.read_messages, 1);
}
/** Quarantine revokes capabilities but cannot rewrite UNKNOWN evidence as recalled or failed. */
export async function verifyExpansionNotificationsQuarantine({ readPool, saved }) {
  references(saved);
  const actual = await snapshot(readPool, saved);
  for (const table of tables) {
    assert.equal(
      actual.tables[table].count,
      saved.tables[table].count,
      'E05 quarantine retains ' + table + ' rows',
    );
    if (['notification_subscription_intents', 'notification_subscription_grants'].includes(table))
      assert.equal(
        actual.tables[table].retainedHash,
        saved.tables[table].retainedHash,
        'E05 quarantine retains immutable ' + table + ' identity',
      );
    else
      assert.deepEqual(
        actual.tables[table],
        saved.tables[table],
        'E05 quarantine retains exact ' + table + ' evidence',
      );
  }
  assert.equal(actual.facts.delivery, 'UNKNOWN');
  assert.equal(actual.facts.attempt, 'UNKNOWN');
  assert.equal(actual.facts.active_grants, 0);
  assert.equal(actual.facts.encrypted_targets, 0);
  assert.equal(actual.facts.pending_intent, 'FAILED');
  assert.equal(actual.facts.read_messages, 1);
}
