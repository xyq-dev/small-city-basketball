import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Exercise real CREATE/failing child/DROP without launching another application.
let database;
let baseName;
try {
  database = new URL(process.env.DATABASE_URL ?? '');
  baseName = decodeURIComponent(database.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(baseName) ||
    baseName.length > 63 ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Invalid test target');
} catch {
  throw new Error('Browser database isolation check requires an isolated scb_test_* target');
}
const pool = new pg.Pool({
  connectionString: database.href,
  max: 1,
  connectionTimeoutMillis: 5000,
});
try {
  const connected = await pool.query('SELECT current_database() AS name');
  assert.equal(connected.rows[0].name, baseName);
  const outcome = await new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./run-api-browser-checks.mjs', import.meta.url)),
        '--project=desktop-api',
        '--scb-deliberate-invalid-cli-option',
      ],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
    );
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-65536);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
  assert.equal(outcome.code, 1, 'A deliberate child failure must retain a nonzero exit code');
  const created = outcome.output.match(
    /\[api-browser\] desktop-api: isolated database (scb_test_[A-Za-z0-9_]+)\b/,
  );
  assert.ok(created, 'The failing run must have created its own database before the CLI failure');
  const owned = created[1];
  assert.notEqual(owned, baseName);
  assert.ok(outcome.output.includes(`[api-browser] removed owned database ${owned}`));
  assert.match(outcome.output, /unknown option.*scb-deliberate-invalid-cli-option/);
  const remaining = await pool.query(
    'SELECT datname FROM pg_database WHERE datname=ANY($1::text[])',
    [baseName, owned],
  );
  assert.deepEqual(
    remaining.rows.map((row) => row.datname),
    [baseName],
  );
  console.log(
    'A failing browser child kept its failure code, removed only its owned database, and retained the control database.',
  );
} finally {
  await pool.end();
}
