import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

// CI owns every generated project, volume, credential and archive. Nothing is deployed remotely.
if (process.env.CI !== 'true' || !process.env.RUNNER_TEMP)
  throw new Error('Production checks require an isolated GitHub Actions runner');
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(process.env.RUNNER_TEMP, 'scb-production-'));
await chmod(temporary, 0o700);
const suffix = randomBytes(6).toString('hex');
const source = `scb_src_${suffix}`;
const target = `scb_dst_${suffix}`;
const control = `scb_control_${suffix}`;
const prefix = `scb-check-${suffix}`;
const sourceDatabase = `scb_test_production_${suffix}`;
const restoreDatabase = `scb_restore_${suffix}`;
const origin = 'https://localhost:9443';
const sourceSecrets = path.join(temporary, 'source-secrets');
const targetSecrets = path.join(temporary, 'target-secrets');
const restoreSecrets = path.join(temporary, 'restore-secrets');
const archives = path.join(temporary, 'archives');
const stateDirectory = path.join(temporary, 'state');
const certificateDirectory = path.join(temporary, 'certificates');
const hostOwner = path.join(temporary, 'owner.json');
const hostState = path.join(temporary, 'state.json');
const passwords = Object.fromEntries(
  ['source', 'target'].map((cluster) => [
    cluster,
    Object.fromEntries(
      ['admin', 'migrator', 'runtime', 'backup'].map((role) => [
        role,
        randomBytes(24).toString('base64url'),
      ]),
    ),
  ]),
);
const owner = {
  email: `owner-${suffix}@example.test`,
  password: randomBytes(24).toString('base64url'),
  displayName: '生产包验证负责人',
  organizationName: '隔离生产包验证机构',
};
const secrets = [
  ...Object.values(passwords.source),
  ...Object.values(passwords.target),
  owner.password,
];
let controlCreated = false;
let sourceStarted = false;
let targetStarted = false;
let tlsCa;

function redacted(value) {
  let result = String(value);
  for (const secret of secrets) result = result.split(secret).join('[redacted]');
  return result
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[database URL]')
    .replace(/(?:scb\.(?:sid|overlay)=)[^;\s'"<>]+/g, '[session]')
    .replace(/#token=[^\s'"<>]+/g, '#token=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[opaque value]');
}

async function run(command, args, { env = {}, allowFailure = false, input } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-250000);
    });
  child.stdin.end(input);
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (status !== 0 && !allowFailure) {
    console.error(redacted(output.slice(-8000)));
    throw new Error(`Isolated check command failed: ${command}`);
  }
  return { status, output };
}

function configuration(secretDirectory, database = sourceDatabase) {
  return {
    APP_ORIGIN: origin,
    SCB_HTTPS_PORT: '127.0.0.1:9443',
    SCB_IMAGE_PREFIX: prefix,
    SCB_SECRET_DIR: secretDirectory,
    SCB_RESTORE_SECRET_DIR: restoreSecrets,
    SCB_BACKUP_DIR: archives,
    POSTGRES_DB: database,
    COMMERCE_MODE: 'ENFORCED',
  };
}
const sourceEnv = configuration(sourceSecrets);
const targetEnv = configuration(targetSecrets, 'postgres');
async function compose(project, env, args, options) {
  return run('docker', ['compose', '-p', project, '-f', 'compose.production.yaml', ...args], {
    ...options,
    env: { ...env, ...options?.env },
  });
}
async function stage(label, action) {
  console.log(`[production] ${label}`);
  await action();
}
async function ownedFile(file, content, uid = 10001, gid = uid, mode = 0o400) {
  const staged = path.join(temporary, 'write-' + randomBytes(6).toString('hex'));
  await writeFile(staged, content, { mode: 0o600 });
  try {
    await run('sudo', [
      'install',
      '-m',
      mode.toString(8),
      '-o',
      String(uid),
      '-g',
      String(gid),
      staged,
      file,
    ]);
  } finally {
    await rm(staged, { force: true });
  }
}
function databaseUrl(role, host, database, cluster = host === 'restoredb' ? 'target' : 'source') {
  return `postgresql://scb_${role}:${encodeURIComponent(passwords[cluster][role])}@${host}:5432/${database}`;
}
async function urlFiles(directory, database, host = 'postgres') {
  for (const role of ['admin', 'migrator', 'runtime', 'backup'])
    await ownedFile(
      path.join(directory, `database_${role}_url`),
      databaseUrl(role, host, database, directory === targetSecrets ? 'target' : 'source'),
    );
}
async function jsonCommand(args) {
  const result = await run('docker', args);
  return JSON.parse(result.output);
}
async function container(project, env, service) {
  const result = await compose(project, env, ['ps', '-q', service]);
  const id = result.output.trim();
  assert.ok(/^[a-f0-9]{12,64}$/.test(id), 'Expected exactly one owned service container');
  return id;
}
async function waitDatabase(project, env) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const result = await compose(
      project,
      env,
      ['exec', '-T', 'postgres', 'pg_isready', '-U', 'scb_admin', '-d', env.POSTGRES_DB],
      { allowFailure: true },
    );
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Owned PostgreSQL did not become ready');
}
async function tlsRequest(route, options = {}) {
  const { body, ...requestOptions } = options;
  return new Promise((resolve, reject) => {
    const request = https.request(
      new URL(origin + route),
      {
        ...requestOptions,
        ca: tlsCa,
        signal: AbortSignal.timeout(8000),
      },
      (response) => {
        let content = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          content += chunk;
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: { getSetCookie: () => response.headers['set-cookie'] ?? [] },
            json: async () => JSON.parse(content),
          }),
        );
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}
async function waitReady() {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      if ((await tlsRequest('/ready')).status === 200) return;
    } catch {
      /* start-up */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('TLS readiness did not succeed');
}
const mount = (from, to, readonly = true) => [
  '--mount',
  `type=bind,src=${from},dst=${to}${readonly ? ',readonly' : ''}`,
];
async function validator(project, env, mode, recovery = false) {
  const args = [
    'create',
    '--network',
    `${project}_backend`,
    '--label',
    `scb.check=${suffix}`,
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--env',
    'NODE_ENV=production',
    '--env',
    `APP_ORIGIN=${origin}`,
    '--env',
    'SCB_CHECK_BASE_URL=https://web:8443',
    '--env',
    'NODE_EXTRA_CA_CERTS=/check-ca.crt',
    '--env',
    'TEST_DATABASE_URL_FILE=/check-runtime',
    '--env',
    'SCB_FINGERPRINT_DATABASE_URL_FILE=/check-backup',
    '--env',
    'SCB_CHECK_OWNER_FILE=/check-owner',
    '--env',
    'SCB_CHECK_MAINTENANCE_URL_FILE=/check-maintenance',
    '--env',
    'SCB_PERSISTENCE_FILE=/check-state/application.json',
    ...(recovery ? ['--env', 'SCB_CHECK_RECOVERY=1'] : []),
    ...mount(path.join(env.SCB_SECRET_DIR, 'database_runtime_url'), '/check-runtime'),
    ...mount(path.join(env.SCB_SECRET_DIR, 'database_backup_url'), '/check-backup'),
    ...mount(path.join(env.SCB_SECRET_DIR, 'database_migrator_url'), '/check-maintenance'),
    ...mount(path.join(sourceSecrets, 'bootstrap_owner_input'), '/check-owner'),
    ...mount(path.join(certificateDirectory, 'ca.crt'), '/check-ca.crt'),
    ...mount(stateDirectory, '/check-state', false),
    ...mount(
      path.join(root, 'scripts/check-database-restart.mjs'),
      '/app/scripts/check-database-restart.mjs',
    ),
    ...mount(
      path.join(root, 'scripts/c05-media-fixtures.mjs'),
      '/app/scripts/c05-media-fixtures.mjs',
    ),
    ...mount(
      path.join(root, 'scripts/c05-commerce-check.mjs'),
      '/app/scripts/c05-commerce-check.mjs',
    ),
    '--entrypoint',
    'node',
    `${prefix}/db-tools:local`,
    'scripts/check-database-restart.mjs',
    mode,
  ];
  const created = await run('docker', args);
  const id = created.output.trim();
  assert.ok(/^[a-f0-9]{12,64}$/.test(id), 'Expected an owned validator container');
  try {
    await run('docker', ['network', 'connect', `${project}_frontend`, id]);
    return await run('docker', ['start', '-a', id]);
  } finally {
    await run('docker', ['rm', '-f', id]);
  }
}
async function copyState() {
  const result = await run('sudo', ['cat', path.join(stateDirectory, 'application.json')]);
  await writeFile(hostState, result.output, { mode: 0o600 });
  const saved = JSON.parse(result.output);
  secrets.push(saved.cookie, saved.registration.leaderCookie, saved.scoring.writerCookie);
  for (const operator of saved.commerce.operators) secrets.push(operator.cookie);
  for (const overlay of [...saved.overlays.active, saved.overlays.revoked, saved.lifecycle.overlay])
    secrets.push(overlay.cookie, overlay.token);
  return saved;
}
async function checkPrivateSession(saved) {
  const response = await tlsRequest('/v1/auth/session', { headers: { Cookie: saved.cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.data.user.id === saved.userId, 'Persisted identity must survive recreation');
}
async function checkQuarantine(saved) {
  assert.equal(
    (await tlsRequest('/v1/auth/session', { headers: { Cookie: saved.cookie } })).status,
    401,
  );
  assert.equal(
    (await tlsRequest('/v1/auth/session', { headers: { Cookie: saved.registration.leaderCookie } }))
      .status,
    401,
  );
  for (const publicId of [saved.viewing.publicId, saved.lifecycle.publicId])
    for (const suffix of ['', '/schedule', '/standings'])
      assert.equal((await tlsRequest(`/v1/public/events/${publicId}${suffix}`)).status, 404);
  for (const match of saved.lifecycle.schedule)
    assert.equal(
      (
        await tlsRequest(
          `/v1/public/events/${saved.lifecycle.publicId}/matches/${match.publicMatchId}`,
        )
      ).status,
      404,
    );
  for (const suffix of ['', '/schedule', '/groups', '/knockout'])
    assert.equal(
      (await tlsRequest(`/v1/public/events/${saved.groups.publicId}${suffix}`)).status,
      404,
    );
  for (const match of saved.groups.schedule)
    assert.equal(
      (
        await tlsRequest(
          `/v1/public/events/${saved.groups.publicId}/matches/${match.publicMatchId}`,
        )
      ).status,
      404,
    );
  for (const operator of saved.commerce.operators) {
    assert.equal(
      (await tlsRequest('/v1/platform/commerce', { headers: { Cookie: operator.cookie } })).status,
      401,
    );
    assert.equal(
      (await tlsRequest('/v1/commerce/capabilities', { headers: { Cookie: operator.cookie } }))
        .status,
      401,
    );
  }
  for (const suffix of ['', '/schedule', '/knockout'])
    assert.equal(
      (await tlsRequest(`/v1/public/events/${saved.knockout.publicId}${suffix}`)).status,
      404,
    );
  for (const match of saved.knockout.schedule)
    assert.equal(
      (
        await tlsRequest(
          `/v1/public/events/${saved.knockout.publicId}/matches/${match.publicMatchId}`,
        )
      ).status,
      404,
    );
  for (const overlay of [...saved.overlays.active, saved.lifecycle.overlay]) {
    const route = `/v1/overlays/${overlay.overlayId}`;
    assert.equal(
      (await tlsRequest(`${route}/snapshot`, { headers: { Cookie: overlay.cookie } })).status,
      404,
    );
    assert.equal(
      (
        await tlsRequest(`${route}/bootstrap`, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: overlay.token }),
        })
      ).status,
      404,
    );
  }
  for (const item of saved.media.published.media) {
    assert.equal((await tlsRequest(item.contentPath)).status, 404);
    assert.equal(
      (await tlsRequest(item.contentPath, { headers: { Range: 'bytes=0-15' } })).status,
      404,
    );
  }
  assert.equal(
    (
      await tlsRequest(saved.media.privatePath, {
        headers: { Cookie: saved.registration.leaderCookie },
      })
    ).status,
    401,
  );
  const response = await tlsRequest('/v1/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: owner.email, password: owner.password }),
  });
  assert.equal(response.status, 200);
  const session = (await response.json()).data;
  assert.ok(
    session.organizations.length === 0,
    'Relogin cannot recover quarantined organization access',
  );
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  assert.ok(cookie, 'Relogin must still use a distinct authenticated session');
  assert.equal(
    (await tlsRequest(`/v1/orgs/${saved.orgId}/events`, { headers: { Cookie: cookie } })).status,
    404,
  );
}

try {
  await stage('Create private synthetic credentials and a trusted local TLS chain', async () => {
    for (const directory of [
      sourceSecrets,
      targetSecrets,
      restoreSecrets,
      archives,
      stateDirectory,
      certificateDirectory,
    ])
      await mkdir(directory, { mode: 0o700 });
    for (const directory of [archives, stateDirectory])
      await run('sudo', ['chown', '10001:10001', directory]);
    await writeFile(hostOwner, JSON.stringify(owner), { mode: 0o600 });
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      path.join(certificateDirectory, 'ca.key'),
      '-out',
      path.join(certificateDirectory, 'ca.crt'),
      '-subj',
      '/CN=SCB isolated CI CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    ]);
    await run('openssl', [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(certificateDirectory, 'server.key'),
      '-out',
      path.join(certificateDirectory, 'server.csr'),
      '-subj',
      '/CN=localhost',
    ]);
    const extensions = path.join(certificateDirectory, 'server.ext');
    await writeFile(
      extensions,
      'subjectAltName=DNS:localhost,DNS:web,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
    );
    await run('openssl', [
      'x509',
      '-req',
      '-days',
      '2',
      '-in',
      path.join(certificateDirectory, 'server.csr'),
      '-CA',
      path.join(certificateDirectory, 'ca.crt'),
      '-CAkey',
      path.join(certificateDirectory, 'ca.key'),
      '-CAcreateserial',
      '-extfile',
      extensions,
      '-out',
      path.join(certificateDirectory, 'server.crt'),
    ]);
    await chmod(path.join(certificateDirectory, 'ca.crt'), 0o444);
    process.env.NODE_EXTRA_CA_CERTS = path.join(certificateDirectory, 'ca.crt');
    tlsCa = await readFile(path.join(certificateDirectory, 'ca.crt'), 'utf8');
    // Node reads NODE_EXTRA_CA_CERTS at process start. Its native TLS checker runs as a new child below.
    const nss = path.join(process.env.HOME, '.pki/nssdb');
    await mkdir(nss, { recursive: true });
    const initialized = await run('certutil', ['-d', `sql:${nss}`, '-L'], { allowFailure: true });
    if (initialized.status !== 0)
      await run('certutil', ['-N', '-d', `sql:${nss}`, '--empty-password']);
    await run('certutil', [
      '-A',
      '-d',
      `sql:${nss}`,
      '-n',
      `SCB-${suffix}`,
      '-t',
      'C,,',
      '-i',
      path.join(certificateDirectory, 'ca.crt'),
    ]);
    const certificate = await readFile(path.join(certificateDirectory, 'server.crt'), 'utf8');
    const key = await readFile(path.join(certificateDirectory, 'server.key'), 'utf8');
    for (const directory of [sourceSecrets, targetSecrets]) {
      await ownedFile(
        path.join(directory, 'postgres_admin_password'),
        passwords[directory === targetSecrets ? 'target' : 'source'].admin,
        0,
      );
      await ownedFile(path.join(directory, 'tls_certificate'), certificate, 101);
      await ownedFile(path.join(directory, 'tls_private_key'), key, 101);
      await ownedFile(path.join(directory, 'bootstrap_owner_input'), JSON.stringify(owner));
      await ownedFile(
        path.join(directory, 'database_restore_url'),
        databaseUrl('admin', 'restoredb', 'postgres'),
      );
    }
    await urlFiles(sourceSecrets, sourceDatabase);
    await urlFiles(targetSecrets, 'postgres');
    await ownedFile(
      path.join(restoreSecrets, 'database_restore_url'),
      databaseUrl('admin', 'restoredb', 'postgres'),
    );
    await ownedFile(
      path.join(restoreSecrets, 'database_migrator_url'),
      databaseUrl('migrator', 'restoredb', 'postgres'),
    );
    await run('docker', ['volume', 'create', '--label', `scb.check=${suffix}`, control]);
    controlCreated = true;
  });
  await stage(
    'Build production api, web and database tools plus an isolated test image',
    async () => {
      for (const image of [
        'node:24.22.1-bookworm-slim',
        'nginx:1.30.6-alpine',
        'node:24.22.1-alpine3.24',
        'postgres:18.6-alpine3.24',
      ]) {
        await run('docker', ['pull', image]);
        const metadata = (await jsonCommand(['image', 'inspect', image]))[0];
        console.log(
          `[production] base ${image} ${(metadata.RepoDigests ?? [metadata.Id]).join(',')}`,
        );
      }
      for (const [buildTarget, image] of [
        ['api', 'api'],
        ['web', 'web'],
        ['db-tools', 'db-tools'],
        ['build', 'checks'],
      ])
        await run('docker', [
          'build',
          '--target',
          buildTarget,
          '-t',
          `${prefix}/${image}:local`,
          '.',
        ]);
      for (const [image, uid] of [
        ['api', '10001:10001'],
        ['db-tools', '10001:10001'],
        ['web', '101:101'],
      ]) {
        const details = await jsonCommand(['image', 'inspect', `${prefix}/${image}:local`]);
        assert.equal(details[0].Config.User, uid);
        console.log(`[production] built ${image} ${details[0].Id}`);
      }
      await run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'node',
        `${prefix}/api:local`,
        '--input-type=module',
        '-e',
        "import assert from 'node:assert/strict';import fs from 'node:fs';import('@small-city-basketball/contracts');assert.equal(process.getuid(),10001);for(const p of ['apps/api/dist/main.js','apps/api/dist/bootstrap-owner.js','apps/api/dist/database/migrate.js','packages/contracts/runtime-privileges.json'])assert.ok(fs.existsSync(p));assert.equal(fs.readdirSync('apps/api/migrations').filter(x=>x.endsWith('.sql')).length,15);assert.ok(!fs.existsSync('apps/api/src'));for(const p of ['tsx','vite']){let found=false;try{import.meta.resolve(p);found=true}catch{}assert.ok(!found)}",
      ]);
      await run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'node',
        `${prefix}/db-tools:local`,
        '--input-type=module',
        '-e',
        "import assert from 'node:assert/strict';import pg from 'pg';import('@small-city-basketball/contracts');assert.equal(process.getuid(),10001);assert.ok(pg.Pool)",
      ]);
      const version = await run('docker', [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'pg_dump',
        `${prefix}/db-tools:local`,
        '--version',
      ]);
      assert.ok(/18\.6/.test(version.output));
    },
  );
  await stage(
    'Provision roles, explicitly migrate and run the additional PostgreSQL checks',
    async () => {
      sourceStarted = true;
      await compose(source, sourceEnv, ['up', '-d', '--no-build', 'postgres']);
      await waitDatabase(source, sourceEnv);
      await compose(source, sourceEnv, ['run', '--rm', '--no-deps', 'provision']);
      await compose(source, sourceEnv, ['run', '--rm', '--no-deps', 'migrate']);
      const result = await run('docker', [
        'run',
        '--rm',
        '--network',
        `${source}_backend`,
        '--workdir',
        '/app/apps/api',
        '--env',
        'NODE_ENV=test',
        '--env',
        'TEST_P07_ADMIN_DATABASE_URL_FILE=/check-admin',
        '--env',
        'TEST_P07_MIGRATOR_DATABASE_URL_FILE=/check-migrator',
        '--env',
        'TEST_P07_RUNTIME_DATABASE_URL_FILE=/check-runtime',
        '--env',
        'TEST_P07_BACKUP_DATABASE_URL_FILE=/check-backup',
        ...mount(path.join(sourceSecrets, 'database_admin_url'), '/check-admin'),
        ...mount(path.join(sourceSecrets, 'database_migrator_url'), '/check-migrator'),
        ...mount(path.join(sourceSecrets, 'database_runtime_url'), '/check-runtime'),
        ...mount(path.join(sourceSecrets, 'database_backup_url'), '/check-backup'),
        '--entrypoint',
        'node',
        `${prefix}/checks:local`,
        '/app/node_modules/vitest/vitest.mjs',
        'run',
        'test/p07',
      ]);
      console.log(
        redacted(result.output)
          .split('\n')
          .filter((line) => /Test Files|Tests\s/.test(line))
          .join('\n'),
      );
      await compose(source, sourceEnv, [
        '--profile',
        'ops',
        'run',
        '--rm',
        '--no-deps',
        'bootstrap-owner',
      ]);
      const repeated = await compose(
        source,
        sourceEnv,
        ['--profile', 'ops', 'run', '--rm', '--no-deps', 'bootstrap-owner'],
        { allowFailure: true },
      );
      assert.notEqual(repeated.status, 0, 'Bootstrap cannot overwrite an existing organization');
      await compose(source, sourceEnv, ['up', '-d', '--no-build', '--no-deps', 'api']);
      await compose(source, sourceEnv, ['up', '-d', '--no-build', '--no-deps', 'web']);
    },
  );
  // A child with startup CA settings performs all host TLS operations, including the remainder here.
  // Pass only private file paths and nonsecret topology through environment/argv.
  await stage('Verify the trusted host connection', async () => {
    await run(process.execPath, [
      '--input-type=module',
      '-e',
      "let last='NO_RESPONSE';for(let i=0;i<45;i++){try{const r=await fetch('https://localhost:9443/ready',{signal:AbortSignal.timeout(3000)});if(r.status===200)process.exit(0);last='HTTP_'+r.status}catch(e){const code=e.cause?.code??e.code??e.name;last=/^[A-Z0-9_]+$/i.test(code??'')?code:'CONNECTION_ERROR'}await new Promise(r=>setTimeout(r,1000))}console.error('Host readiness failed: '+last);process.exit(1)",
    ]);
  });
  await stage(
    'Inspect least privilege mounts and run the full business chain through TLS',
    async () => {
      for (const service of ['api', 'postgres']) {
        const id = await container(source, sourceEnv, service);
        const details = (await jsonCommand(['inspect', id]))[0];
        assert.equal(Object.keys(details.HostConfig.PortBindings ?? {}).length, 0);
        if (service === 'api') {
          assert.equal(details.HostConfig.ReadonlyRootfs, true);
          assert.equal(details.HostConfig.Init, true);
          assert.deepEqual(
            details.Mounts.filter((item) => item.Destination.startsWith('/run/secrets/')).map(
              (item) => item.Destination,
            ),
            ['/run/secrets/database_runtime_url'],
          );
        }
      }
      await validator(source, sourceEnv, 'capture');
      await copyState();
      const env = {
        SCB_CHECK_BASE_URL: origin,
        SCB_CHECK_OWNER_FILE: hostOwner,
        SCB_PERSISTENCE_FILE: hostState,
      };
      const smoke = await run(process.execPath, ['scripts/check-production-http.mjs', 'smoke'], {
        env,
      });
      console.log(smoke.output.trim());
      const browsers = await run(
        'npx',
        ['playwright', 'test', '--config', 'tests/production/playwright.config.ts'],
        { env },
      );
      console.log(browsers.output.trim());
      const rateLimit = await run(
        process.execPath,
        ['scripts/check-production-http.mjs', 'rate-limit'],
        { env },
      );
      console.log(rateLimit.output.trim());
    },
  );
  await stage(
    'Check graceful termination, database outage and recreation on the same volume',
    async () => {
      const saved = await copyState();
      const apiId = await container(source, sourceEnv, 'api');
      const webId = await container(source, sourceEnv, 'web');
      const apiBefore = (await jsonCommand(['inspect', apiId]))[0];
      const previousAddress = apiBefore.NetworkSettings.Networks[`${source}_frontend`].IPAddress;
      await compose(source, sourceEnv, ['stop', '-t', '10', 'api']);
      const stopped = (await jsonCommand(['inspect', apiId]))[0];
      assert.equal(stopped.State.ExitCode, 0);
      // Migration/provision jobs ran explicitly and were removed. Start this
      // existing owned container without asking Compose to rebuild that graph.
      await run('docker', ['start', apiId]);
      await waitReady();
      await checkPrivateSession(saved);
      await compose(source, sourceEnv, ['stop', 'api']);
      await compose(source, sourceEnv, ['rm', '-f', 'api']);
      // Keep an owned endpoint during recreation using Docker's automatic IPAM.
      // Explicit --ip is invalid on Compose's automatically allocated subnet.
      // The new API address is independently asserted different below.
      // This process has no secrets, ports, API alias or elevated privileges.
      const anchor = await run('docker', [
        'create',
        '--network',
        `${source}_frontend`,
        '--label',
        `com.docker.compose.project=${source}`,
        '--label',
        'com.docker.compose.service=ip-anchor',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--entrypoint',
        'node',
        `${prefix}/api:local`,
        '-e',
        'setInterval(()=>{},1000)',
      ]);
      const anchorId = anchor.output.trim();
      assert.ok(/^[a-f0-9]{12,64}$/.test(anchorId), 'Expected one owned address anchor');
      try {
        await run('docker', ['start', anchorId]);
        await compose(source, sourceEnv, ['up', '-d', '--no-build', '--no-deps', 'api']);
        const recreatedApi = await container(source, sourceEnv, 'api');
        assert.notEqual(recreatedApi, apiId, 'The API container must actually be recreated');
        assert.equal(await container(source, sourceEnv, 'web'), webId, 'Web must remain running');
        const apiAfter = (await jsonCommand(['inspect', recreatedApi]))[0];
        assert.notEqual(
          apiAfter.NetworkSettings.Networks[`${source}_frontend`].IPAddress,
          previousAddress,
          'The recreated API must receive a different address',
        );
        await waitReady();
        await checkPrivateSession(saved);
        console.log(
          '[production] API address changed; the unchanged Web resolved it and preserved the private session.',
        );
      } finally {
        await run('docker', ['rm', '-f', anchorId]);
      }
      const pgId = await container(source, sourceEnv, 'postgres');
      const volume = (await jsonCommand(['inspect', pgId]))[0].Mounts.find(
        (item) => item.Destination === '/var/lib/postgresql',
      ).Name;
      await compose(source, sourceEnv, ['stop', 'postgres']);
      assert.equal((await tlsRequest('/ready')).status, 503);
      await compose(source, sourceEnv, ['up', '-d', '--force-recreate', '--no-deps', 'postgres']);
      await waitDatabase(source, sourceEnv);
      await waitReady();
      const recreated = (
        await jsonCommand(['inspect', await container(source, sourceEnv, 'postgres')])
      )[0];
      assert.equal(
        recreated.Mounts.find((item) => item.Destination === '/var/lib/postgresql').Name,
        volume,
      );
      await checkPrivateSession(saved);
    },
  );
  let saved;
  await stage('Stop all source writers and capture an exact, quiescent full backup', async () => {
    await compose(source, sourceEnv, ['stop', 'web', 'api']);
    await validator(source, sourceEnv, 'freeze');
    saved = await copyState();
    await compose(source, sourceEnv, [
      '--profile',
      'ops',
      'run',
      '--rm',
      '--no-deps',
      '-e',
      'ARCHIVE_PATH=/backups/application.dump',
      'backup',
    ]);
    const metadata = await run('sudo', [
      'stat',
      '-c',
      '%a %u %s',
      path.join(archives, 'application.dump'),
    ]);
    const [mode, uid, size] = metadata.output.trim().split(' ');
    assert.equal(mode, '600');
    assert.equal(uid, '10001');
    assert.ok(Number(size) > 0);
  });
  await stage('Restore the full archive to a second PostgreSQL instance and volume', async () => {
    targetStarted = true;
    await compose(target, targetEnv, ['up', '-d', '--no-build', 'postgres']);
    await waitDatabase(target, targetEnv);
    await compose(target, targetEnv, ['run', '--rm', '--no-deps', 'provision']);
    const recoveryNetwork = `${source}_recovery`;
    const exists = await run('docker', ['network', 'inspect', recoveryNetwork], {
      allowFailure: true,
    });
    if (exists.status !== 0)
      await run('docker', [
        'network',
        'create',
        '--label',
        `com.docker.compose.project=${source}`,
        '--label',
        'com.docker.compose.network=recovery',
        recoveryNetwork,
      ]);
    await run('docker', [
      'network',
      'connect',
      '--alias',
      'restoredb',
      recoveryNetwork,
      await container(target, targetEnv, 'postgres'),
    ]);
    await compose(source, sourceEnv, [
      '--profile',
      'ops',
      'run',
      '--rm',
      '--no-deps',
      '-e',
      'ARCHIVE_PATH=/backups/application.dump',
      '-e',
      'RESTORE_RECEIPT_PATH=/backups/restore-receipt.json',
      '-e',
      `RESTORE_DATABASE_NAME=${restoreDatabase}`,
      'restore',
    ]);
    await urlFiles(targetSecrets, restoreDatabase);
    await run('docker', [
      'run',
      '--rm',
      '--network',
      recoveryNetwork,
      ...mount(path.join(sourceSecrets, 'database_runtime_url'), '/check-source'),
      ...mount(path.join(targetSecrets, 'database_runtime_url'), '/check-target'),
      '--entrypoint',
      'node',
      `${prefix}/db-tools:local`,
      '--input-type=module',
      '-e',
      "import assert from 'node:assert/strict';import fs from 'node:fs';import pg from 'pg';const source=new URL(fs.readFileSync('/check-source','utf8'));const target=new URL(fs.readFileSync('/check-target','utf8'));target.hostname='restoredb';target.password=source.password;const pool=new pg.Pool({connectionString:target.toString(),connectionTimeoutMillis:5000});let denied=false;try{await pool.query('SELECT 1')}catch(error){denied=error.code==='28P01'}finally{await pool.end()}assert.ok(denied,'Source database credentials must not authenticate to the target cluster')",
    ]);

    await compose(target, targetEnv, ['up', '-d', '--no-build', '--no-deps', 'api']);
    await compose(target, targetEnv, ['up', '-d', '--no-build', '--no-deps', 'web']);
    await waitReady();
    await validator(target, targetEnv, 'verify', true);
    console.log(
      '[production] Full restore matched all 58 exact tables, business snapshots and backup-point fencing.',
    );
  });
  await stage(
    'Reject overwrites, preserve source/control, and quarantine the restored authorization',
    async () => {
      const targetApiId = await container(target, targetEnv, 'api');
      const targetWebId = await container(target, targetEnv, 'web');
      await compose(target, targetEnv, ['stop', 'web', 'api']);
      const collision = await compose(
        source,
        sourceEnv,
        [
          '--profile',
          'ops',
          'run',
          '--rm',
          '--no-deps',
          '-e',
          'ARCHIVE_PATH=/backups/application.dump',
          '-e',
          'RESTORE_RECEIPT_PATH=/backups/collision.json',
          '-e',
          `RESTORE_DATABASE_NAME=${restoreDatabase}`,
          'restore',
        ],
        { allowFailure: true },
      );
      assert.notEqual(collision.status, 0);
      const jobs = await run('docker', [
        'ps',
        '-aq',
        '--filter',
        `label=com.docker.compose.project=${source}`,
        '--filter',
        'label=com.docker.compose.service=restore',
      ]);
      assert.equal(
        jobs.output.trim(),
        '',
        'A failed one-off restore must leave no owned job container',
      );
      await run('docker', ['volume', 'inspect', control]);
      await validator(source, sourceEnv, 'freeze');
      const after = await copyState();
      assert.ok(
        after.fingerprint === saved.fingerprint,
        'A failed restore cannot change the frozen source',
      );
      await compose(source, sourceEnv, [
        '--profile',
        'ops',
        'run',
        '--rm',
        '--no-deps',
        '-e',
        'RESTORE_RECEIPT_PATH=/backups/restore-receipt.json',
        'quarantine',
      ]);
      await run('docker', ['start', targetApiId, targetWebId]);
      await waitReady();
      await checkQuarantine(saved);
      console.log(
        '[production] Old private, public and overlay credentials are invalid; relogin exposes no quarantined organization.',
      );
    },
  );
  console.log(
    '[production] Production package, TLS, role, persistence, full restore and quarantine checks passed.',
  );
} catch (error) {
  // Capture only bounded, redacted service diagnostics before owned resources
  // disappear. Never inspect container environment or credential mounts here.
  for (const [started, project, env] of [
    [sourceStarted, source, sourceEnv],
    [targetStarted, target, targetEnv],
  ]) {
    if (!started) continue;
    try {
      const services = await compose(project, env, ['ps', '--all', '--format', 'json'], {
        allowFailure: true,
      });
      console.error(redacted(services.output.slice(-6000)));
      const logs = await compose(
        project,
        env,
        ['logs', '--no-color', '--tail', '40', 'api', 'web'],
        { allowFailure: true },
      );
      console.error(redacted(logs.output.slice(-8000)));
    } catch {
      console.error('[production] Owned service diagnostics unavailable');
    }
  }
  throw error;
} finally {
  let cleanupFailed = false;
  for (const [started, project, env] of [
    [targetStarted, target, targetEnv],
    [sourceStarted, source, sourceEnv],
  ]) {
    if (!started) continue;
    const result = await compose(
      project,
      env,
      ['--profile', 'ops', 'down', '--volumes', '--remove-orphans'],
      { allowFailure: true },
    );
    if (result.status !== 0) cleanupFailed = true;
    const leftovers = await run(
      'docker',
      ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`],
      { allowFailure: true },
    );
    if (leftovers.output.trim()) cleanupFailed = true;
  }
  if (controlCreated) {
    await run('docker', ['volume', 'inspect', control]);
    console.log(
      '[production] Cleanup removed only owned projects; the independent control volume remains.',
    );
    await run('docker', ['volume', 'rm', control]);
  }
  await run('sudo', ['chown', '-R', `${process.getuid()}:${process.getgid()}`, temporary]);
  await rm(temporary, { recursive: true, force: true });
  if (cleanupFailed) throw new Error('Owned production-check resources were not fully cleaned');
}
