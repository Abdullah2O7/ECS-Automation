import { defineConfig } from '@playwright/test';

// Browserless unit tests of the pure code in src/ (env parsing, dates, text, runtime state).
// No browser, no .env, no application under test - they run anywhere in a few seconds.
// The E2E suite is configured in playwright.config.ts; its projects match only the TC*.spec.ts files,
// so these *.test.ts files are never picked up by an E2E run.
export default defineConfig({
  testDir: './tests/unit',
  testMatch: '**/*.test.ts',
  outputDir: 'test-output/reports/unit-results',
  reporter: [['list']],
  forbidOnly: !!process.env.CI,
  retries: 0,
});
