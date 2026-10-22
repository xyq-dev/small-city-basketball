import { Pool } from 'pg';
import { loadRootEnv, requiredEnv } from '../env.js';
import { migrate } from './migrate.js';

loadRootEnv();
const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
try {
  const applied = await migrate(pool);
  console.log(
    applied.length
      ? `Applied migrations: ${applied.join(', ')}`
      : 'Migration checksums verified; no new migrations.',
  );
} finally {
  await pool.end();
}
