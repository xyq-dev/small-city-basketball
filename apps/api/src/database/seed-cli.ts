import { Pool } from 'pg';
import { loadRootEnv, requiredEnv } from '../env.js';
import { seedDev } from './seed.js';

loadRootEnv();
if (process.env.NODE_ENV === 'production')
  throw new Error('Development seed is not permitted in production');
const password = requiredEnv('DEV_SEED_PASSWORD');
const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL') });
try {
  await seedDev(pool, password);
  console.log(
    'Synthetic development fixtures available. Existing data and passwords were preserved.',
  );
} finally {
  await pool.end();
}
