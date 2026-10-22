import { defineConfig, devices } from '@playwright/test';

// Browser checks migrate their database. Require an explicit isolated target before
// starting either server; never inherit a developer or production .env implicitly.
try {
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(database.pathname.slice(1)))
  )
    throw new Error('Not an isolated test database');
} catch {
  throw new Error('API browser checks require an explicit DATABASE_URL named scb_test_*');
}

export default defineConfig({
  testDir: './tests/api-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
      env: { PORT: '3300', APP_ORIGIN: 'http://127.0.0.1:4273' },
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
  ],
});
