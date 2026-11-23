import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { envFlag, runFolderName } from './src/utils/core/env';
import { caseIdPattern, discoverTestPages } from './src/config/test-pages';
import { actionTimeout, expectTimeout, navigationTimeout, testTimeout } from './src/config/timeouts';
import { forgetOldRuns } from './src/utils/runtime/run-memory';

// dotenv config is used to load environment variables from a .env file into process.env.
import dotenv from 'dotenv';
dotenv.config({ path: '.env', quiet: true });

// Set by the CI pipeline: headless, Playwright's Chromium, retries.
const isCI = envFlag('CI');

const browser = {
  ...devices['Desktop Chrome'],
  // Local runs use the installed Chrome channel. CI uses Playwright's managed Chromium
  // (npx playwright install chromium), which does not require an interactive desktop.
  ...(isCI ? {} : { channel: 'chrome' }),
};

// The pages under test: one Playwright project per folder of tests/pages (see src/config/test-pages.ts). To add a page,
// add a folder with its *.spec.ts files - there is nothing to register here. Run one page: npx playwright test --project=news
const testPages = discoverTestPages();
const includeNotApplicable = envFlag('INCLUDE_NOT_APPLICABLE');
const toRegExp = (source: string | undefined): RegExp | undefined => (source ? new RegExp(source) : undefined);

// A labelled run (RUN_LABEL, set by a pipeline running one Playwright process per case) keeps its own results,
// report and JUnit file instead of the next process clearing them. The run id is fixed by the main process when it
// loads this file, and its workers inherit it, so they write to the same folder.
process.env.PW_RUN_ID ??= String(Date.now());
// The main process (not its workers) clears what runs older than a day remembered (src/utils/runtime/run-memory.ts)
if (!process.env.TEST_WORKER_INDEX) {
  forgetOldRuns();
}
const runLabel = runFolderName();

// The test dashboard (npm run dashboard) sets DASHBOARD_RUN_DIR: it adds a JSON report for the dashboard and a reporter
// that tells it how each test ended while the run is going. The other reports are written as usual.
const dashboardReporters: ReporterDescription[] = process.env.DASHBOARD_RUN_DIR
  ? [['json', { outputFile: path.join(process.env.DASHBOARD_RUN_DIR, 'report.json') }], ['./src/scripts/dashboard/live-reporter.ts']]
  : [];

export default defineConfig({
  testDir: './tests',
  // The most workers any page uses - see `workers` in a page's page.json. Playwright runs one project's tests
  // with that project's own worker count, so this is the most that ever run together.
  workers: Math.max(1, ...testPages.map((page) => page.workers)),
  // CI stops after a few failures; a local run goes on, so one run shows every failing test case.
  maxFailures: isCI ? 3 : 0,
  // The timeout for each test - see config/timeouts.ts.
  timeout: testTimeout,
  // The timeout for each assertion - see config/timeouts.ts.
  expect: {
    timeout: expectTimeout,
  },
  // Every case gets 3 tries: one that could not complete its steps (the server too slow, a step that did not take) is run
  // again, and after the third try it is reported blocked with what happened. A case whose check failed (a bug) is not
  // run again - its retries repeat that result at once (src/fixtures/bug-evidence.fixture.ts).
  retries: 2,
  // The output directory for test results and reports.
  // (The dashboard gives every page its own folder: Playwright empties this folder at the start of a run, which would
  // otherwise delete the screenshots of the page that was run before.)
  outputDir: process.env.DASHBOARD_OUTPUT_DIR ?? (runLabel ? `test-output/reports/test-results/${runLabel}` : 'test-output/reports/test-results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: runLabel ? `test-output/reports/html/${runLabel}` : 'test-output/reports/Playwright-Report' }],
    // For a CI's test results tab: one file per Playwright process
    ['junit', { outputFile: `test-output/reports/junit/${runLabel ?? 'local'}.xml` }],
    ['allure-playwright',
      {
        resultsDir: 'test-output/reports/allure-results',
        detail: true,
        suiteTitle: true,
        environmentInfo: {
          OS_Platform: os.platform(),
          OS_Release: os.release(),
          Node_Version: process.version,
          Environment: process.env.ENVIRONMENT?.toUpperCase(),
        },
      }],
    // One Word file per user story with a failed check: test-output/bug-reports/<story> bug report.docx
    ['./src/reporters/bug-report/bug-report.reporter.ts'],
    ...dashboardReporters,
  ],
  use: {
    // Run headless in CI or when the HEADLESS environment variable is set to "true". Local runs are visible for debugging.
    headless: isCI || envFlag('HEADLESS'),
    // Fixed so expected texts and date formats do not depend on the machine running the tests.
    locale: 'en-US',
    // The default timeouts are set in config/timeouts.ts, and the session fixture overrides them for sign-in.
    actionTimeout,
    navigationTimeout,
    // Test environments often use certificates the machine does not trust.
    ignoreHTTPSErrors: true,
    // Always take screenshots, and retain trace and video on failure.
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  // One project per page folder. A page with `after` (page.json) depends on that page: it runs after it, and is skipped
  // when that page fails - for a chain where one page's tests create the records the next page acts on (see runtime
  // state). Every project is listed before the first test runs, so a spec must build its test titles from test data,
  // never from the runtime state an earlier step writes - see prepareFromState.
  projects: testPages.map((page) => ({
    name: page.id,
    // Test cases marked "not applicable" (tests/pages/<page>/not-applicable.json) are not run. The dashboard lists the tests
    // with INCLUDE_NOT_APPLICABLE=1, so it can still show them.
    grepInvert: includeNotApplicable ? undefined : toRegExp(caseIdPattern(Object.keys(page.notApplicable))),
    testMatch: `pages/${page.id}/**/*.spec.ts`,
    dependencies: page.after ? [page.after] : [],
    workers: page.workers,
    // More than one worker only helps when the tests of a file may run side by side (they do not depend on each other)
    fullyParallel: page.workers > 1,
    use: browser,
  })),
});
