import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AccountRecoveryService } from '../apps/api/dist/account-recovery-service.js';
import {
  accountTokenHash,
  deliveryKey,
  openMail,
} from '../apps/api/dist/account-recovery-domain.js';

const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const digest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function references(saved) {
  for (const name of ['userId', 'requestId', 'cancellationId', 'tokenId', 'mailJobId'])
    assert.ok(uuid(saved?.[name]), `X22 fixture requires an exact ${name} reference`);
  for (const name of [
    'request',
    'cancellation',
    'configuration',
    'token',
    'tokenIdentity',
    'job',
    'jobIdentity',
    'envelope',
    'configurationKeyId',
  ])
    assert.ok(digest(saved?.hashes?.[name]), `X22 fixture requires a retained ${name} digest`);
}
/** Read-only: private addresses, codes, ciphertext and credentials never leave SQL as metadata. */
async function retained(readPool, saved) {
  const r = await readPool.query(
    `SELECT
      encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') AS request_hash,
      encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex') AS cancellation_hash,
      encode(sha256(convert_to(to_jsonb(cfg)::text,'UTF8')),'hex') AS configuration_hash,
      cfg.key_id AS configuration_key_id,
      encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS token_hash,
      encode(sha256(convert_to((to_jsonb(t)-'revoked_at')::text,'UTF8')),'hex') AS token_identity_hash,
      encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex') AS job_hash,
      encode(sha256(convert_to((to_jsonb(j)-ARRAY['status','envelope','lease_id','lease_until','updated_at'])::text,'UTF8')),'hex') AS job_identity_hash,
      encode(sha256(j.envelope),'hex') AS envelope_hash,
      t.purpose,t.used_at IS NULL AND t.used_by IS NULL AND t.used_request_hash IS NULL AS token_unused,
      t.revoked_at IS NOT NULL AS token_revoked,j.status AS job_status,
      j.envelope IS NULL AS envelope_absent,j.lease_id IS NULL AND j.lease_until IS NULL AS no_lease,
      j.attempt_count AS attempts
     FROM account_action_requests a
     JOIN account_action_tokens t ON t.id=$4 AND t.user_id=$1
     JOIN account_action_cancellations c ON c.id=$3 AND c.user_id=t.user_id
     JOIN account_mail_jobs j ON j.id=$5 AND j.token_id=t.id
     JOIN account_mail_configuration cfg ON cfg.singleton=true
     WHERE a.id=$2 AND a.purpose=t.purpose`,
    [saved.userId, saved.requestId, saved.cancellationId, saved.tokenId, saved.mailJobId],
  );
  assert.equal(
    r.rows.length,
    1,
    'All five X22 private recovery fixture tables must retain their exact linked rows',
  );
  return r.rows[0];
}
const hashes = (r) => ({
  request: r.request_hash,
  cancellation: r.cancellation_hash,
  configuration: r.configuration_hash,
  configurationKeyId: r.configuration_key_id,
  token: r.token_hash,
  tokenIdentity: r.token_identity_hash,
  job: r.job_hash,
  jobIdentity: r.job_identity_hash,
  envelope: r.envelope_hash,
});
/** Only for the existing isolated acceptance harness, using the real restricted runtime role. */
export async function captureX22AccountRecovery({
  call,
  state,
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  requireRuntimeRole = true,
}) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('X22 capture requires a valid isolated PostgreSQL URL');
  }
  assert.equal(typeof requireRuntimeRole, 'boolean', 'X22 runtime-role mode must be explicit');
  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (!requireRuntimeRole) {
    let origin;
    try {
      origin = new URL(appOrigin);
    } catch {
      throw new Error('X22 local-owner mode requires an explicit loopback HTTP origin');
    }
    assert.ok(
      loopback.has(parsed.hostname) && origin.protocol === 'http:' && loopback.has(origin.hostname),
      'X22 local-owner mode refuses remote or HTTPS production targets',
    );
    assert.ok(
      parsed.username,
      'X22 local-owner mode requires the configured isolated database owner',
    );
  }
  assert.ok(
    ['postgres:', 'postgresql:'].includes(parsed.protocol),
    'X22 capture requires PostgreSQL',
  );
  const expectedDatabase = decodeURIComponent(parsed.pathname.slice(1));
  assert.match(
    expectedDatabase,
    /^scb_test_[A-Za-z0-9_]+$/,
    'X22 capture refuses non-isolated databases',
  );
  assert.ok(
    uuid(state?.userId) && typeof state.cookie === 'string' && state.cookie.startsWith('scb.sid='),
    'X22 capture requires the current synthetic owner session',
  );
  const runtime = (
    await runtimePool.query(
      'SELECT current_database() AS name,current_user AS role,pg_backend_pid() AS pid',
    )
  ).rows[0];
  assert.equal(runtime.name, expectedDatabase);
  assert.equal(
    runtime.role,
    requireRuntimeRole ? 'scb_runtime' : decodeURIComponent(parsed.username),
    requireRuntimeRole
      ? 'X22 writes must use the real restricted runtime role'
      : 'X22 local fixture role must match its explicit loopback database owner',
  );
  assert.equal(
    (await readPool.query('SELECT current_database() AS name')).rows[0].name,
    expectedDatabase,
  );
  const visible = (
    await readPool.query(
      'SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND datname=$2 AND usename=$3',
      [runtime.pid, expectedDatabase, runtime.role],
    )
  ).rowCount;
  assert.equal(
    visible,
    1,
    'Runtime and read-only verification pools must address the same isolated server',
  );
  const session = (await call('/v1/auth/session', { cookie: state.cookie })).data;
  assert.equal(session.user.id, state.userId);
  assert.equal(typeof session.user.email, 'string');
  const before = (
    await readPool.query('SELECT id FROM account_action_tokens WHERE user_id=$1', [state.userId])
  ).rows.map((r) => r.id);
  // A fixed synthetic key matches the independent X22 integration fixture; no production mail setup.
  const encodedKey = Buffer.alloc(32, 0x22).toString('base64');
  let deliveries = 0;
  const provider = {
    async send() {
      deliveries++;
      throw new Error('X22 archive fixture must never dispatch mail');
    },
  };
  const service = new AccountRecoveryService(
    runtimePool,
    { appOrigin },
    { provider, encryptionKey: encodedKey, autoDispatch: false },
  );
  try {
    await service.assertConfiguration();
    const requestId = randomUUID(),
      cancellationId = randomUUID();
    assert.deepEqual(
      await service.requestVerification(
        state.cookie,
        { clientRequestId: requestId },
        'isolated-x22-archive',
      ),
      { accepted: true },
    );
    const rows = (
      await runtimePool.query(
        `SELECT t.id AS token_id,t.token_hash,t.email_snapshot,j.id AS job_id,j.envelope,j.status,t.used_at,t.revoked_at
       FROM account_action_tokens t JOIN account_mail_jobs j ON j.token_id=t.id
       WHERE t.user_id=$1 AND t.purpose='VERIFY_EMAIL' AND NOT(t.id=ANY($2::uuid[]))`,
        [state.userId, before],
      )
    ).rows;
    assert.equal(
      rows.length,
      1,
      'The real verification command must create one token and encrypted PENDING job',
    );
    const row = rows[0];
    assert.equal(row.status, 'PENDING');
    assert.equal(row.used_at, null);
    assert.equal(row.revoked_at, null);
    assert.ok(Buffer.isBuffer(row.envelope) && row.envelope.length >= 30);
    assert.equal(row.email_snapshot, session.user.email);
    const mail = openMail(deliveryKey(encodedKey), row.job_id, row.envelope);
    assert.equal(mail.to, session.user.email);
    const token = String(mail.text)
      .split('\n')
      .find((v) => /^[A-Za-z0-9_-]{43}$/.test(v));
    assert.ok(token, 'The authenticated encrypted fixture must contain its actual single-use code');
    assert.equal(accountTokenHash(token), row.token_hash);
    assert.deepEqual(
      await service.cancel({ clientRequestId: cancellationId, token }, 'isolated-x22-archive'),
      { completed: false, cancelled: true },
    );
    assert.equal(deliveries, 0, 'Capturing private mail data must not contact any provider');
    const saved = {
      userId: state.userId,
      requestId,
      cancellationId,
      tokenId: row.token_id,
      mailJobId: row.job_id,
    };
    const snapshot = await retained(readPool, saved);
    assert.equal(snapshot.purpose, 'VERIFY_EMAIL');
    assert.equal(snapshot.token_unused, true);
    assert.equal(snapshot.token_revoked, false);
    assert.equal(snapshot.job_status, 'PENDING');
    assert.equal(snapshot.envelope_absent, false);
    assert.equal(snapshot.no_lease, true);
    assert.equal(snapshot.attempts, 0);
    const result = { ...saved, hashes: hashes(snapshot) };
    references(result);
    return result;
  } finally {
    service.onModuleDestroy();
  }
}
/** Restart/normal restore verification deliberately uses SELECT only. */
export async function verifyX22AccountRecovery({ readPool, saved }) {
  references(saved);
  const current = await retained(readPool, saved);
  assert.deepEqual(
    hashes(current),
    saved.hashes,
    'Encrypted mail, unused token and original request/cancellation receipts must survive exactly',
  );
  assert.equal(current.purpose, 'VERIFY_EMAIL');
  assert.equal(current.token_unused, true);
  assert.equal(current.token_revoked, false);
  assert.equal(current.job_status, 'PENDING');
  assert.equal(current.envelope_absent, false);
  assert.equal(current.no_lease, true);
  assert.equal(current.attempts, 0);
}
/** Restore quarantine destroys mail capabilities while retaining the audited receipts and identities. */
export async function verifyX22AccountRecoveryQuarantine({ readPool, saved }) {
  references(saved);
  const current = await retained(readPool, saved);
  assert.equal(current.request_hash, saved.hashes.request);
  assert.equal(current.cancellation_hash, saved.hashes.cancellation);
  assert.equal(current.configuration_hash, saved.hashes.configuration);
  assert.equal(current.configuration_key_id, saved.hashes.configurationKeyId);
  assert.equal(current.token_identity_hash, saved.hashes.tokenIdentity);
  assert.equal(current.job_identity_hash, saved.hashes.jobIdentity);
  assert.equal(current.token_unused, true);
  assert.equal(current.token_revoked, true, 'No restored action code may regain authority');
  assert.equal(current.job_status, 'EXPIRED');
  assert.equal(current.envelope_absent, true);
  assert.equal(current.envelope_hash, null);
  assert.equal(current.no_lease, true);
  assert.equal(current.attempts, 0);
}
