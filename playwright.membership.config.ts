import { defineConfig, devices } from '@playwright/test';

// Separate owned databases keep enforced membership billing from changing the
// established OFF-mode API browser suite. No real payment transport is enabled.
try {
  const target = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !/^scb_test_[A-Za-z0-9_]+$/.test(decodeURIComponent(target.pathname.slice(1))) ||
    target.search ||
    target.hash ||
    process.env.NODE_ENV === 'production'
  )
    throw new Error();
} catch {
  throw new Error('Membership browser checks require an isolated loopback scb_test_* database');
}

export default defineConfig({
  testDir: './tests/membership-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 180000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    actionTimeout: 15000,
    navigationTimeout: 20000,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-api',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1040 } },
    },
    { name: 'mobile-api', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command:
        'npm run db:migrate && node --import tsx scripts/prepare-api-browser-owner.mjs && npm run dev:api',
      url: 'http://127.0.0.1:3300/health',
      env: {
        NODE_ENV: 'test',
        PORT: '3300',
        APP_ORIGIN: 'http://127.0.0.1:4273',
        COMMERCE_MODE: 'ENFORCED',
        WECHAT_PAY_ENABLED: 'false',
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
  ],
});
