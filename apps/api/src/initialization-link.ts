import { Pool } from 'pg';
import { isDirectExecution, loadRootEnv } from './env.js';
import { readDatabaseUrl } from './runtime-config.js';
import { issueInitializationLink } from './first-run-setup.js';

export async function runInitializationLinkCli(): Promise<void> {
  if (process.argv.length > 2 || !process.stdout.isTTY || process.env.CI)
    throw new Error('Initialization links require a private interactive terminal');
  loadRootEnv();
  const pool = new Pool({ connectionString: readDatabaseUrl(), connectionTimeoutMillis: 5000 });
  try {
    const result = await issueInitializationLink(pool, {
      enabled: process.env.FIRST_RUN_SETUP_ENABLED === 'true',
      appOrigin: process.env.APP_ORIGIN ?? '',
    });
    // This command is TTY-only and its Compose service disables container logging.
    // Never print the result anywhere else or include it in generic app logs.
    process.stdout.write(`${result.link}\n有效期至 ${result.expiresAt}\n`);
  } finally {
    await pool.end();
  }
}
if (isDirectExecution(import.meta.url)) {
  try {
    await runInitializationLinkCli();
  } catch {
    console.error('Initialization link issuance failed');
    process.exitCode = 1;
  }
}
