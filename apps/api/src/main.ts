import { createApi } from './app.js';
import { loadRootEnv } from './env.js';
import { readRuntimeConfig } from './runtime-config.js';

let instance: Awaited<ReturnType<typeof createApi>> | undefined;
let closing = false;
async function close() {
  if (closing || !instance) return;
  closing = true;
  try {
    await instance.app.close();
  } finally {
    await instance.pool.end();
  }
}
try {
  loadRootEnv();
  const config = readRuntimeConfig();
  instance = await createApi(config.apiOptions);
  await instance.app.listen(config.port, config.host);
  console.log(`小城市篮球 API listening on port ${config.port}`);
  const stop = () => {
    void close().catch(() => {
      console.error('API shutdown failed');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  try {
    await close();
  } catch {
    /* Only fixed startup failure is logged. */
  }
  console.error('API startup failed');
  process.exitCode = 1;
}
