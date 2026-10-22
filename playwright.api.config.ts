import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/api-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
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
