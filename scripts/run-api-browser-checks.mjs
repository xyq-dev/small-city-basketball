import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Each browser project owns a fresh database. Registration abuse protection is
// shared by real client IP, so unrelated projects must not consume one budget.
const allProjects = ['desktop-api', 'mobile-api'];
const selected = [];
const forwarded = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const value = args[i];
  if (value === '--project' || value.startsWith('--project=')) {
    const project = value === '--project' ? args[++i] : value.slice('--project='.length);
    if (!allProjects.includes(project)) throw new Error('Use desktop-api or mobile-api');
    selected.push(project);
  } else if (value === '--config' || value.startsWith('--config=') || value.startsWith('-c')) {
    throw new Error('API browser checks use the fixed isolated-test configuration');
  } else forwarded.push(value);
}
const projects = allProjects.filter((project) => !selected.length || selected.includes(project));
let base;
let baseName;
try {
  base = new URL(process.env.DATABASE_URL ?? '');
  baseName = decodeURIComponent(base.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(base.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(baseName) ||
    baseName.length > 63 ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error('Invalid test target');
} catch {
  throw new Error('API browser checks require DATABASE_URL naming an isolated scb_test_* database');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const pool = new pg.Pool({ connectionString: base.href, max: 1, connectionTimeoutMillis: 5000 });
let activeChild;
let stopped = false;
const stop = (signal) => {
  stopped = true;
  activeChild?.kill(signal);
};
const interrupt = () => stop('SIGINT');
const terminate = () => stop('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);
let exitCode = 0;
try {
  for (const project of projects) {
    if (stopped) {
      exitCode = 130;
      break;
    }
    const inspectOnly = forwarded.some((arg) => ['--list', '--help', '-h'].includes(arg));
    const databaseName = `${baseName.slice(0, 35)}_${project === 'desktop-api' ? 'd' : 'm'}_${randomBytes(8).toString('hex')}`;
    // This name is generated from a strictly validated ASCII prefix and random
    // hex. Only a successfully created database from this invocation is dropped.
    if (!/^scb_test_[A-Za-z0-9_]+$/.test(databaseName) || databaseName.length > 63)
      throw new Error('Invalid generated test database name');
    let created = false;
    try {
      const target = new URL(base);
      if (!inspectOnly) {
        await pool.query(`CREATE DATABASE "${databaseName}"`);
        created = true;
        target.pathname = databaseName;
        console.log(`[api-browser] ${project}: isolated database ${databaseName}`);
      }
      if (stopped) {
        exitCode = 130;
        break;
      }
      exitCode = await new Promise((resolve, reject) => {
        activeChild = spawn(
          process.execPath,
          [cli, 'test', '--config', 'playwright.api.config.ts', ...forwarded, '--project', project],
          { cwd: root, env: { ...process.env, DATABASE_URL: target.href }, stdio: 'inherit' },
        );
        activeChild.once('error', reject);
        activeChild.once('exit', (code) => resolve(stopped ? 130 : (code ?? 1)));
      });
      activeChild = undefined;
    } finally {
      if (created) {
        await pool.query(`DROP DATABASE "${databaseName}"`);
        console.log(`[api-browser] removed owned database ${databaseName}`);
      }
    }
    if (exitCode !== 0) break;
  }
} catch (error) {
  // Never print the connection string or driver messages containing credentials.
  const code = /^[A-Z0-9_]+$/.test(error?.code ?? '') ? ` (${error.code})` : '';
  console.error(
    `API browser setup/cleanup failed${code}; check the isolated database and CREATEDB permission.`,
  );
  exitCode ||= 1;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  await pool.end();
}
process.exitCode = exitCode;
