import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { envFlag } from './src/utils/core/env';

dotenv.config({ path: '.env', quiet: true });

/**
 * The user-guide builder (npm run guide, or "Create user guide" on the dashboard): one browser walks the back office with
 * the CMS account and writes a Word user guide. It only looks - it never saves, publishes or deletes anything.
 * Its own config, so the guide never shows up as a test of the suite.
 */
export default defineConfig({
  testDir: './src/scripts/user-guide',
  testMatch: '**/*.guide.ts',
  outputDir: 'test-output/user-guide/run',
  timeout: 45 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    ...(envFlag('CI') ? {} : { channel: 'chrome' }),
    headless: envFlag('CI') || !envFlag('GUIDE_HEADED'),
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
