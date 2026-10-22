import { runMigrationCli } from './migrate.js';
try {
  await runMigrationCli();
} catch {
  console.error('Database migration failed');
  process.exitCode = 1;
}
