import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { envFlag } from './src/utils/core/env';

dotenv.config({ path: '.env', quiet: true });

/**
 * Claude's back-office tools (cms-model, cms-probe, cms-cleanup - `npx playwright test --config=playwright.tools.config.ts cms-model`): they sign in with the CMS account like a test and read the
 * back office's content model through its API. Their own config, so they never show up as tests of the suite.
 */
export default defineConfig({
  testDir: './src/scripts/cms-tools',
  testMatch: '**/*.tool.ts',
  outputDir: 'test-output/cms-model/run',
  timeout: 40 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    ...(envFlag('CI') ? {} : { channel: 'chrome' }),
    headless: true,
    locale: 'en-US',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
