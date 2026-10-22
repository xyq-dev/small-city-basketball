import { createApi } from './app.js';
import { loadRootEnv, requiredEnv } from './env.js';

loadRootEnv();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be from 1 to 65535');
const { app, pool } = await createApi({
  databaseUrl: requiredEnv('DATABASE_URL'),
  appOrigin: requiredEnv('APP_ORIGIN'),
  secureCookies: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
  registrationEnabled:
    process.env.REGISTRATION_ENABLED === undefined
      ? process.env.NODE_ENV !== 'production'
      : process.env.REGISTRATION_ENABLED === 'true',
});
await app.listen(port, process.env.HOST ?? '127.0.0.1');
console.log(`小城市篮球 API listening on port ${port}`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
