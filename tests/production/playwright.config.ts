import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { httpsOrigin } from './support.js';

// No webServer: root owns an already-running, isolated HTTPS deployment. The
// runner's Chromium trust store must contain the test CA; no TLS bypass exists.
const origin = httpsOrigin();
if (!process.env.SCB_CHECK_OWNER_FILE)
  throw new Error('P07_CHECK:private-output-directory-required');
export default defineConfig({
  testDir: '.',
  testMatch: 'https.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: [['./sanitized-reporter.ts']],
  // Playwright may create error-context even with screenshot/trace disabled.
  // Keep all such files outside repository and CI artifact collection paths.
  outputDir: join(dirname(process.env.SCB_CHECK_OWNER_FILE), 'p07-browser-private-output'),
  use: {
    baseURL: origin,
    actionTimeout: 15000,
    navigationTimeout: 20000,
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'desktop-https',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile-https', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
});
