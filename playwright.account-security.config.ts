import { defineConfig, devices } from '@playwright/test';

// Playwright 1.62 also captures ARIA page snapshots independently of screenshots.
// Disable that recorder before workers start; preserveOutput removes any residual
// error context containing only our fixed phase and static test source.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// This suite must start from a fresh database: it exercises the public first-run
// form instead of silently creating a maintenance owner before the browser opens.
try {
  const database = new URL(process.env.DATABASE_URL ?? '');
  const name = decodeURIComponent(database.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(name) ||
    name.length > 63 ||
    database.search ||
    database.hash ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error();
} catch {
  throw new Error(
    'Account-security browser checks require an isolated loopback scb_test_* database',
  );
}

const origin = 'https://127.0.0.1:4473';

export default defineConfig({
  testDir: './tests/account-security-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 180000,
  reporter: 'list',
  // Setup fragments and passwords must never be persisted in traces, screenshots,
  // videos or ARIA page snapshots. Only fixed, non-sensitive phases print.
  preserveOutput: 'never',
  use: {
    baseURL: origin,
    ignoreHTTPSErrors: true, // Only the ephemeral loopback certificate in this suite.
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-api',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile-api', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npm run db:migrate && npm run dev:api',
      url: 'http://127.0.0.1:3300/health',
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3300',
        APP_ORIGIN: origin,
        COOKIE_SECURE: 'true',
        FIRST_RUN_SETUP_ENABLED: 'true',
        SCB_BACKGROUND_WORKERS_ENABLED: 'false',
      },
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'npm run dev --workspace @small-city-basketball/admin -- --host 127.0.0.1 --port 4273 --strictPort',
      url: 'http://127.0.0.1:4273',
      env: { VITE_DATA_MODE: 'api', API_PROXY_TARGET: 'http://127.0.0.1:3300' },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'node scripts/start-account-security-https.mjs',
      url: origin,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
