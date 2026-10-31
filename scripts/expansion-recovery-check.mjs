import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticMp4 } from './c05-media-fixtures.mjs';
import { exactTableRows } from '../ops/recovery/fingerprint-rows.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
export const EXPANSION_DOMAINS = Object.freeze({
  streaming: [
    'live_channel_accounts',
    'broadcast_sessions',
    'live_relays',
    'stream_command_receipts',
    'stream_jobs',
    'stream_usage_ledger',
    'live_media_jobs',
    'live_media_artifacts',
  ],
  insurance: [
    'insurance_configuration',
    'insurance_products',
    'insurance_quotes',
    'insurance_orders',
    'insurance_policy_facts',
    'insurance_operations',
    'insurance_receipts',
    'insurance_provider_events',
    'participant_qualification_requests',
    'participant_qualification_prechecks',
    'participant_qualification_receipts',
  ],
  trade: [
    'trade_terms',
    'trade_orders',
    'trade_payment_attempts',
    'trade_refunds',
    'trade_deductions',
    'trade_settlements',
    'trade_provider_events',
    'trade_operations',
    'trade_reconciliations',
    'trade_settlement_returns',
  ],
  notifications: [
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
  ],
  closure: ['account_closure_requests', 'account_closure_operations', 'account_closure_tombstones'],
  guardians: [
    'youth_event_policies',
    'youth_guardian_preconsents',
    'youth_guardian_requests',
    'youth_guardian_history',
    'youth_guardian_commands',
    'youth_preconsent_history',
    'youth_adult_data_consents',
  ],
});

/** Offline inventory checks fail when an expansion migration adds an unexercised table. */
export function expansionTablesFromSql(sources) {
  const names = [];
  for (const sql of sources)
    for (const match of sql.matchAll(/\bCREATE TABLE\s+([a-z][a-z0-9_]+)\s*\(/g))
      names.push(match[1]);
  assert.equal(new Set(names).size, names.length, 'Expansion tables must be uniquely owned');
  const expected = Object.values(EXPANSION_DOMAINS).flat().sort();
  assert.deepEqual(
    names.sort(),
    expected,
    'Every new table requires an assigned recovery business fixture',
  );
  return expected;
}
export async function expansionInventory() {
  const directory = new URL('../apps/api/migrations/', import.meta.url);
  const first = 36,
    last = 42;
  const files = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 3)) >= first)
    .sort();
  assert.deepEqual(
    files.map((name) => Number(name.slice(0, 3))),
    Array.from({ length: last - first + 1 }, (_, index) => first + index),
    'Every expansion migration through 042 must have explicit recovery coverage',
  );
  return expansionTablesFromSql(
    await Promise.all(files.map((name) => readFile(new URL(name, directory), 'utf8'))),
  );
}
export function assertExpansionQuarantineCounts(before, after) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  const expansion = new Set(Object.values(EXPANSION_DOMAINS).flat());
  for (const [table, count] of Object.entries(before)) {
    if (expansion.has(table))
      assert.ok(
        Number.isSafeInteger(after[table]) && after[table] >= count && count > 0,
        `Quarantine cannot erase retained expansion rows from ${table}`,
      );
    else
      assert.equal(
        after[table],
        count,
        `Existing completion fixture row counts stay exact for ${table}`,
      );
  }
}
/** Full PostgreSQL JSON text is hashed without converting bigint fences through JS numbers. */
export async function expansionSnapshot(readPool) {
  const tables = await expansionInventory();
  const c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const proof = {};
    for (const table of tables) {
      const rows = await exactTableRows(c, table);
      assert.ok(rows.length > 0, `Expansion table ${table} needs nonempty durable acceptance data`);
      const hash = createHash('sha256');
      for (const row of rows) hash.update(row.value).update('\n');
      proof[table] = { rows: rows.length, sha256: hash.digest('hex') };
    }
    await c.query('COMMIT');
    return proof;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
export async function expansionTransaction(pool, work) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const value = await work(c);
    await c.query('COMMIT');
    return value;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}
export async function assertExpansionTarget({
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  requireRuntimeRole = true,
}) {
  let database, origin;
  try {
    database = new URL(databaseUrl);
    origin = new URL(appOrigin);
  } catch {
    throw new Error(
      'Expansion acceptance requires explicit isolated database and application origins',
    );
  }
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  const name = decodeURIComponent(database.pathname.slice(1));
  assert.match(
    name,
    /^scb_test_[A-Za-z0-9_]+$/,
    'Expansion capture refuses a production or restored database',
  );
  assert.equal(typeof requireRuntimeRole, 'boolean');
  const runtime = (
    await runtimePool.query(
      'SELECT current_database() AS name,current_user AS role,pg_backend_pid() AS pid',
    )
  ).rows[0];
  assert.equal(runtime.name, name);
  if (requireRuntimeRole)
    assert.equal(runtime.role, 'scb_runtime', 'Expansion writes must exercise exact runtime ACL');
  else {
    assert.equal(runtime.role, decodeURIComponent(database.username));
    assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(database.hostname));
    assert.equal(origin.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost', '::1', '[::1]'].includes(origin.hostname));
  }
  assert.equal((await readPool.query('SELECT current_database() AS name')).rows[0].name, name);
  assert.equal(
    (
      await readPool.query(
        'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3',
        [runtime.pid, name, runtime.role],
      )
    ).rowCount,
    1,
  );
}

/** This in-process registration is a scoped synthetic fixture, not a fabricated HTTP peer. */
async function registrationFactory(context) {
  const { RegistrationService } = await import('../apps/api/dist/registration-service.js');
  const service = new RegistrationService(context.runtimePool, {
    databaseUrl: context.databaseUrl,
    appOrigin: context.appOrigin,
    participantDataKey: context.participantDataKey,
    participantRegistrationEnabled: true,
  });
  return async (name) => {
    const password = randomBytes(24).toString('base64url');
    const result = await service.registerParticipant(
      {
        email: `expansion-${randomUUID()}@example.test`,
        password,
        displayName: name,
      },
      `isolated-expansion-fixture:${randomUUID()}`,
    );
    assert.ok(UUID.test(result.data.user.id));
    return {
      id: result.data.user.id,
      userId: result.data.user.id,
      cookie: 'scb.sid=' + result.token,
      password,
      session: result.data,
    };
  };
}

export async function captureExpansion(context) {
  await expansionInventory();
  await assertExpansionTarget(context);
  assert.ok(UUID.test(context.state.orgId) && UUID.test(context.state.userId));
  const registerSynthetic = await registrationFactory(context);
  const input = { ...context, registerSynthetic, suffix: randomUUID().slice(0, 8) };
  const streaming = await captureStreaming(input);
  const { captureExpansionNotifications } = await import('./expansion-e05-recovery.mjs');
  const notifications = await captureExpansionNotifications(input);
  const closure = await captureClosure(input);
  const { captureExpansionTrade } = await import('./expansion-e04-recovery.mjs');
  const trade = await captureExpansionTrade(input);
  const { captureExpansionInsurance } = await import('./expansion-e03-recovery.mjs');
  const insurance = await captureExpansionInsurance(input);
  const { captureExpansionGuardians } = await import('./expansion-e08-recovery.mjs');
  const guardians = await captureExpansionGuardians(input);
  const snapshot = await expansionSnapshot(context.readPool);
  return { version: 1, streaming, notifications, closure, trade, insurance, guardians, snapshot };
}
function savedInput(saved) {
  assert.equal(saved?.version, 1);
  const expected = Object.values(EXPANSION_DOMAINS).flat().sort();
  assert.deepEqual(Object.keys(saved.snapshot ?? {}).sort(), expected);
  for (const value of Object.values(saved.snapshot)) {
    assert.ok(Number.isSafeInteger(value.rows) && value.rows > 0);
    assert.ok(HASH.test(value.sha256));
  }
}
export async function verifyExpansion({ readPool, saved }) {
  savedInput(saved);
  assert.deepEqual(
    await expansionSnapshot(readPool),
    saved.snapshot,
    'All expansion rows must survive PostgreSQL restart/full archive restore exactly',
  );
  await verifyStreaming(readPool, saved.streaming);
  await (
    await import('./expansion-e05-recovery.mjs')
  ).verifyExpansionNotifications({ readPool, saved: saved.notifications });
  await verifyClosure(readPool, saved.closure);
  await (
    await import('./expansion-e04-recovery.mjs')
  ).verifyExpansionTrade({ readPool, saved: saved.trade });
  await (
    await import('./expansion-e03-recovery.mjs')
  ).verifyExpansionInsurance({ readPool, saved: saved.insurance });
  await (
    await import('./expansion-e08-recovery.mjs')
  ).verifyExpansionGuardians({ readPool, saved: saved.guardians });
}
/** Quarantine deliberately changes authorizations; immutable observations and money claims remain evidence. */
export async function verifyExpansionQuarantine({ readPool, saved, baseUrl }) {
  savedInput(saved);
  const marker = await readPool.query(
    "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore'",
  );
  assert.ok(marker.rowCount > 0, 'Restore requires its durable startup isolation marker');
  await verifyStreaming(readPool, saved.streaming, true);
  await (
    await import('./expansion-e05-recovery.mjs')
  ).verifyExpansionNotificationsQuarantine({ readPool, saved: saved.notifications });
  await verifyClosure(readPool, saved.closure, true);
  await (
    await import('./expansion-e04-recovery.mjs')
  ).verifyExpansionTradeQuarantine({ readPool, saved: saved.trade });
  await (
    await import('./expansion-e03-recovery.mjs')
  ).verifyExpansionInsuranceQuarantine({ readPool, saved: saved.insurance });
  await (
    await import('./expansion-e08-recovery.mjs')
  ).verifyExpansionGuardiansQuarantine({ readPool, saved: saved.guardians });
  if (baseUrl) {
    for (const route of [
      '/v1/account-closure/capabilities',
      '/v1/insurance/capabilities',
      '/v1/auth/wechat/capabilities',
    ]) {
      const response = await fetch(baseUrl + route);
      assert.equal(response.status, 200);
      const payload = (await response.json()).data;
      assert.equal(payload.enabled, false, `Restore startup must close ${route}`);
    }
  }
}

// Domain captures below call actual durable services with explicitly synthetic
// external ports. They do not claim Tencent, insurer, WeChat, or real money access.
async function eventually(work, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await work()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}
async function streamingProof(readPool, saved) {
  const r = (
    await readPool.query(
      `SELECT s.id,s.desired,s.observed,s.source_stopped,s.epoch,s.version,
      s.rights_revoked_at IS NOT NULL AS revoked,s.source_token_hash IS NULL AS no_token,
      encode(sha256(convert_to((to_jsonb(s)-ARRAY['desired','observed','epoch','source_epoch','version','source_token_hash','source_expires_at','source_heartbeat_at','updated_at','rights_revoked_at','ended_at'])::text,'UTF8')),'hex') AS identity,
      r.slot_held,r.state AS relay_state,
      encode(sha256(convert_to((to_jsonb(r)-ARRAY['desired','state','epoch','worker_token','worker_until','observed_at','error_code'])::text,'UTF8')),'hex') AS relay_identity,
      encode(sha256(convert_to((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM stream_command_receipts x WHERE x.session_id=s.id)::text,'UTF8')),'hex') AS receipts,
      encode(sha256(convert_to((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM stream_usage_ledger x WHERE x.session_id=s.id)::text,'UTF8')),'hex') AS usage,
      (SELECT count(*)::int FROM stream_jobs j WHERE j.session_id=s.id AND j.state='UNKNOWN') AS unknown_jobs,
      (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(j)-ARRAY['state','lease_token','lease_until','next_attempt_at','error_code'] ORDER BY j.id)::text,'UTF8')),'hex') FROM stream_jobs j WHERE j.session_id=s.id) AS stream_job_identity,
      (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(j) ORDER BY j.id)::text,'UTF8')),'hex') FROM live_media_jobs j WHERE j.session_id=s.id) AS media_jobs,
      (SELECT count(*)::int FROM live_media_artifacts a WHERE a.session_id=s.id AND a.public_key IS NOT NULL AND a.revoked_at IS NULL) AS published,
      (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(a)-ARRAY['public_key','published_by','published_at','revoked_at','version'] ORDER BY a.id)::text,'UTF8')),'hex') FROM live_media_artifacts a WHERE a.session_id=s.id) AS artifacts
     FROM broadcast_sessions s JOIN live_relays r ON r.session_id=s.id WHERE s.id=$1 AND r.id=$2`,
      [saved.sessionId, saved.relayId],
    )
  ).rows;
  assert.equal(
    r.length,
    1,
    'Broadcast source, external account slot and retained generation stay linked',
  );
  return r[0];
}
async function captureStreaming(c) {
  const { StreamingService } = await import('../apps/api/dist/streaming-service.js');
  const streamer = await c.registerSynthetic('合成恢复直播员');
  c.streamer = streamer;
  assert.equal(
    typeof c.createScheduledSource,
    'function',
    'Streaming recovery needs its own actual registration and schedule',
  );
  const writer = await c.registerSynthetic('合成恢复集锦记分员');
  const schedule = await c.createScheduledSource(streamer, writer);
  const eventId = schedule.workspace.event.id;
  const match = (
    await c.readPool.query(
      "SELECT m.id FROM published_matches m JOIN events e ON e.id=m.event_id LEFT JOIN scoring_states st ON st.org_id=m.org_id AND st.match_id=m.id WHERE m.org_id=$1 AND m.event_id=$2 AND m.id=$3 AND e.status IN('SCHEDULED','RUNNING') AND (st.match_id IS NULL OR st.source_version=m.version)",
      [c.state.orgId, eventId, schedule.highlightMatchId],
    )
  ).rows[0];
  assert.ok(match, 'Streaming recovery uses an actual published schedule');
  await c.call(`/v1/orgs/${c.state.orgId}/members/${streamer.id}`, {
    method: 'PUT',
    cookie: c.state.cookie,
    body: { role: 'STREAMER', status: 'ACTIVE' },
  });
  await c.call(`/v1/orgs/${c.state.orgId}/events/${eventId}/staff/${streamer.id}`, {
    method: 'PUT',
    cookie: c.state.cookie,
    body: { role: 'STREAMER', status: 'ACTIVE' },
  });
  const folder = await mkdtemp(join(tmpdir(), 'scb-expansion-media-'));
  const states = new Map();
  const files = new Set();
  let starts = 0,
    records = 0,
    transforms = 0;
  const artifact = async () => {
    const fileName = randomUUID() + '.mp4';
    await writeFile(join(folder, fileName), syntheticMp4, { mode: 0o600 });
    files.add(fileName);
    return {
      fileName,
      sha256: sha(syntheticMp4),
      byteLength: syntheticMp4.length,
      durationMs: 1000,
    };
  };
  const executor = {
    enabled: true,
    async start(run) {
      starts++;
      await run.readScore();
      states.set(run.operationKey, 'CONNECTED');
    },
    async stop() {
      return false;
    },
    async observe(key) {
      return states.get(key) ?? 'UNKNOWN';
    },
    async record() {
      records++;
      return artifact();
    },
    async transform(source) {
      assert.ok(files.has(source));
      transforms++;
      return artifact();
    },
    async probe(name) {
      assert.ok(files.has(name));
      return { durationMs: 1000, byteLength: syntheticMp4.length };
    },
    async file(name) {
      assert.ok(files.has(name));
      return join(folder, name);
    },
    async discard(name) {
      files.delete(name);
      await rm(join(folder, name), { force: true });
    },
  };
  const service = new StreamingService(
    c.runtimePool,
    { databaseUrl: c.databaseUrl, appOrigin: c.appOrigin },
    {
      encryptionKey: Buffer.alloc(32, 7).toString('base64'),
      capabilitiesVerified: true,
      authorizeRecording: async () => true,
      baseFenPerMinute: 1,
      autoDispatch: false,
      templates: [
        {
          key: 'recovery-' + c.suffix,
          orgId: c.state.orgId,
          platform: 'BILIBILI',
          host: 'synthetic.example.com',
          appPath: 'live',
          accountSlot: randomUUID(),
          verifiedUntil: new Date(Date.now() + 3600000).toISOString(),
          fenPerMinute: 1,
        },
      ],
      ingress: {
        enabled: true,
        lease: (name, at) => ({
          pushUrl: 'rtmp://synthetic.example.com/live/' + name,
          pullUrl: 'https://synthetic.example.com/live/' + name + '.flv',
          expiresAt: at.toISOString(),
        }),
        revoke: async () => false,
      },
      executor,
    },
  );
  try {
    const channel = await service.channelCommand(c.state.cookie, c.state.orgId, {
      clientRequestId: randomUUID(),
      type: 'CREATE',
      templateKey: 'recovery-' + c.suffix,
      label: '隔离合成渠道',
      publishKey: 'synthetic-never-network',
    });
    const create = {
      clientRequestId: randomUUID(),
      type: 'CREATE',
      channelIds: [channel.id],
      maximumSeconds: 60,
      budgetFen: 20,
      record: true,
    };
    const session = await service.command(streamer.cookie, c.state.orgId, match.id, create);
    assert.equal(
      (await service.command(streamer.cookie, c.state.orgId, match.id, create)).session.id,
      session.session.id,
    );
    const approved = await service.command(c.state.cookie, c.state.orgId, match.id, {
      clientRequestId: randomUUID(),
      type: 'APPROVE',
      sessionId: session.session.id,
      expectedVersion: session.session.version,
    });
    const start = {
      clientRequestId: randomUUID(),
      type: 'START',
      sessionId: session.session.id,
      expectedVersion: approved.session.version,
      deviceId: randomUUID(),
    };
    await service.command(streamer.cookie, c.state.orgId, match.id, start);
    await service.command(streamer.cookie, c.state.orgId, match.id, start);
    await service.drain();
    let media;
    await eventually(async () => {
      await service.drain();
      media = await service.mediaWorkspace(c.state.cookie, c.state.orgId, session.session.id);
      return media.artifacts.length === 1;
    }, 'Real media worker must persist its controlled recording result');
    const recorded = media.artifacts[0];
    const recordedJob = (
      await c.readPool.query(
        "SELECT id,version FROM live_media_jobs WHERE session_id=$1 AND kind='RECORDING'",
        [session.session.id],
      )
    ).rows[0];
    const anchor = (
      await c.readPool.query(
        "SELECT captured_at FROM scoring_events WHERE org_id=$1 AND match_id=$2 AND type='STAT_RECORDED' AND payload->>'kind'='SCORE' AND NOT payload?'reason' ORDER BY seq LIMIT 1",
        [c.state.orgId, match.id],
      )
    ).rows[0];
    assert.ok(anchor, 'Automatic highlights must derive from an actual persisted score event');
    await service.mediaCommand(c.state.cookie, c.state.orgId, session.session.id, {
      clientRequestId: randomUUID(),
      type: 'CALIBRATE',
      jobId: recordedJob.id,
      expectedVersion: recordedJob.version,
      anchorAt: new Date(anchor.captured_at).toISOString(),
      offsetMs: 0,
      reason: '隔离合成单秒录像与实际得分时间校准',
    });
    await service.mediaCommand(c.state.cookie, c.state.orgId, session.session.id, {
      clientRequestId: randomUUID(),
      type: 'TRANSCODE',
      artifactId: recorded.id,
      expectedVersion: recorded.version,
    });
    await service.drain();
    await eventually(async () => {
      await service.drain();
      media = await service.mediaWorkspace(c.state.cookie, c.state.orgId, session.session.id);
      return media.artifacts.length === 2;
    }, 'Derived media job must persist a second linked artifact');
    await service.mediaCommand(c.state.cookie, c.state.orgId, session.session.id, {
      clientRequestId: randomUUID(),
      type: 'HIGHLIGHTS',
      artifactId: recorded.id,
      expectedVersion: recorded.version,
    });
    await eventually(async () => {
      await service.drain();
      media = await service.mediaWorkspace(c.state.cookie, c.state.orgId, session.session.id);
      return media.artifacts.length === 3;
    }, 'Automatic highlights must persist the confirmed result and calibrated score intervals');
    await service.mediaCommand(c.state.cookie, c.state.orgId, session.session.id, {
      clientRequestId: randomUUID(),
      type: 'PUBLISH',
      artifactId: recorded.id,
      expectedVersion: recorded.version,
    });
    const current = (
      await service.workspace(streamer.cookie, c.state.orgId, match.id)
    ).sessions.find((s) => s.id === session.session.id);
    await service.command(streamer.cookie, c.state.orgId, match.id, {
      clientRequestId: randomUUID(),
      type: 'STOP',
      sessionId: session.session.id,
      expectedVersion: current.version,
    });
    await service.drain();
    // Shutdown persists its final UNKNOWN/held-slot evidence. Capture that
    // quiescent state so the later full-table snapshot observes the same facts.
    await service.onModuleDestroy();
    assert.equal(starts, 1, 'Replayed START cannot dispatch another external operation');
    assert.equal(records, 1);
    assert.equal(transforms, 2);
    const relay = (
      await c.readPool.query('SELECT id FROM live_relays WHERE session_id=$1', [session.session.id])
    ).rows[0];
    const saved = {
      eventId,
      courtId: schedule.court.id,
      sessionId: session.session.id,
      relayId: relay.id,
      artifactIds: media.artifacts.map((a) => a.id),
      mediaByteHash: sha(syntheticMp4),
      physicalBytesScope: 'SYNTHETIC_FILE_CHECK_ONLY_DATABASE_ARCHIVE_EXCLUDES_MEDIA_VOLUME',
    };
    const proof = await streamingProof(c.readPool, saved);
    assert.equal(proof.source_stopped, false);
    assert.equal(proof.slot_held, true);
    assert.ok(proof.unknown_jobs > 0);
    assert.equal(proof.published, 1);
    for (const name of files)
      assert.equal(sha(await readFile(join(folder, name))), saved.mediaByteHash);
    return { ...saved, proof };
  } finally {
    await service.onModuleDestroy();
    await rm(folder, { recursive: true, force: true });
  }
}
async function verifyStreaming(readPool, saved, quarantined = false) {
  assert.ok(UUID.test(saved?.sessionId) && UUID.test(saved?.relayId));
  const current = await streamingProof(readPool, saved);
  if (!quarantined) assert.deepEqual(current, saved.proof);
  else {
    for (const key of [
      'identity',
      'relay_identity',
      'receipts',
      'usage',
      'stream_job_identity',
      'media_jobs',
      'artifacts',
      'source_stopped',
      'slot_held',
    ])
      assert.equal(current[key], saved.proof[key], `Quarantine must retain streaming ${key}`);
    assert.equal(current.source_stopped, false);
    assert.equal(current.slot_held, true);
    assert.equal(current.revoked, true);
    assert.equal(current.no_token, true);
    assert.equal(current.published, 0);
    assert.ok(current.epoch > saved.proof.epoch && current.version > saved.proof.version);
  }
}
async function closureProof(readPool, saved) {
  const rows = (
    await readPool.query(
      `SELECT r.id,r.user_id,r.status,r.version,r.fence::text,
      encode(sha256(convert_to((to_jsonb(r)-ARRAY['status','version','fence','blocked_reasons','lease_id','lease_until','updated_at','finished_at'])::text,'UTF8')),'hex') AS identity,
      encode(sha256(convert_to((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.command_id) FROM account_closure_operations o WHERE o.request_id=r.id)::text,'UTF8')),'hex') AS commands,
      (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') FROM account_closure_tombstones t WHERE t.request_id=r.id) AS tombstone,
      u.status AS user_status,u.email LIKE '%@closed.invalid' AND u.login_name IS NULL AS anonymized,
      NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.created_at>COALESCE(u.credential_reset_at,'-infinity'::timestamptz)) AS no_live_session
     FROM account_closure_requests r JOIN users u ON u.id=r.user_id WHERE r.id=ANY($1::uuid[]) ORDER BY r.id`,
      [[saved.closedId, saved.cancelledId, saved.pendingId]],
    )
  ).rows;
  assert.equal(
    rows.length,
    3,
    'Closed, explicitly cancelled and pending closure intents must remain distinct',
  );
  return rows;
}
async function captureClosure(c) {
  const { WechatService } = await import('../apps/api/dist/wechat-service.js');
  const { createExpansionServices } = await import('../apps/api/dist/expansion-services.js');
  const options = {
    databaseUrl: c.databaseUrl,
    appOrigin: c.appOrigin,
    participantDataKey: c.participantDataKey,
  };
  const domains = await createExpansionServices(
    c.runtimePool,
    options,
    {
      streaming: { autoDispatch: false },
      notifications: { autoDispatch: false },
      insurance: { autoDispatch: false },
      trade: {},
      accountClosure: { enabled: true, autoDispatch: false },
    },
    new WechatService(c.runtimePool, options, { configuration: { enabled: false } }),
  );
  const cancelledActor = await c.registerSynthetic('合成恢复可取消注销'),
    closedActor = await c.registerSynthetic('合成恢复已注销');
  try {
    assert.equal(
      domains.closure.capabilities().enabled,
      true,
      'The test must use all six real closure domain hooks',
    );
    const cancelInput = {
      clientRequestId: randomUUID(),
      password: cancelledActor.password,
      coolingOffDays: 7,
    };
    const first = await domains.closure.request(cancelledActor.cookie, cancelInput);
    assert.equal((await domains.closure.request(cancelledActor.cookie, cancelInput)).id, first.id);
    const cancelled = await domains.closure.cancel(cancelledActor.cookie, {
      clientRequestId: randomUUID(),
      requestId: first.id,
      expectedVersion: first.version,
      password: cancelledActor.password,
    });
    assert.equal(cancelled.status, 'CANCELLED');
    const pending = await domains.closure.request(cancelledActor.cookie, {
      clientRequestId: randomUUID(),
      password: cancelledActor.password,
      coolingOffDays: 7,
    });
    const closed = await domains.closure.request(closedActor.cookie, {
      clientRequestId: randomUUID(),
      password: closedActor.password,
    });
    assert.equal(await domains.closure.processOne(closed.id), 'CLOSED');
    const saved = {
      closedId: closed.id,
      cancelledId: cancelled.id,
      pendingId: pending.id,
      closedUserId: closedActor.id,
    };
    const proof = await closureProof(c.readPool, saved);
    const terminal = proof.find((r) => r.id === saved.closedId);
    assert.equal(terminal.status, 'CLOSED');
    assert.equal(terminal.user_status, 'DISABLED');
    assert.equal(terminal.no_live_session, true);
    assert.equal(terminal.anonymized, true);
    assert.ok(HASH.test(terminal.tombstone));
    return { ...saved, proof };
  } finally {
    domains.closure.onModuleDestroy();
    domains.notifications.onModuleDestroy();
    domains.insurance.onModuleDestroy();
    await domains.streaming.onModuleDestroy();
  }
}
async function verifyClosure(readPool, saved, quarantined = false) {
  for (const id of [saved?.closedId, saved?.cancelledId, saved?.pendingId])
    assert.ok(UUID.test(id));
  const rows = await closureProof(readPool, saved);
  if (!quarantined) assert.deepEqual(rows, saved.proof);
  else
    for (const row of rows) {
      const before = saved.proof.find((x) => x.id === row.id);
      assert.equal(row.identity, before.identity);
      assert.equal(row.commands, before.commands);
      assert.equal(row.tombstone, before.tombstone);
      assert.equal(row.no_live_session, true);
      if (row.id === saved.pendingId) {
        assert.equal(row.status, 'EXPIRED_AUTH');
        assert.ok(row.version > before.version);
        assert.ok(BigInt(row.fence) > BigInt(before.fence));
      } else assert.equal(row.status, before.status);
      if (row.id === saved.closedId) {
        assert.equal(row.user_status, 'DISABLED');
        assert.equal(row.anonymized, true);
      }
    }
}
