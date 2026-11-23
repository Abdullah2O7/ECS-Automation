import { test as base, expect } from '@playwright/test';
import { withBugEvidence } from './bug-evidence.fixture';
import { STOPPED_BY_USER, stopRequested } from '../utils/core/run-control';

/**
 * Fixtures for the public portal: a guest browses it, so nothing signs in. Playwright's own `page` is used as it is.
 *
 * ```ts
 * import { expect, test } from '../../../src/fixtures/portal.fixture';
 * test('...', async ({ page }) => { ... });
 * ```
 *
 * ADD THE ECS PORTAL PAGES HERE: each story's page objects (src/pages/portal/...) become fixtures of this file. Page
 * Objects are imported from their own files, so the sign-in page - and the session recovery it registers - is never
 * loaded for a guest.
 */
type PortalFixtures = {
  /** Frames the problem on the screenshot of a failed case; runs by itself. */
  bugEvidence: void;
  /** Skips the test when the dashboard's Stop button was pressed. */
  runStop: void;
};

export const test = base.extend<PortalFixtures>({
  runStop: [
    async ({}, use, testInfo) => {
      testInfo.skip(stopRequested(), STOPPED_BY_USER);
      await use();
    },
    { auto: true },
  ],
  bugEvidence: [async ({ page }, use, testInfo) => withBugEvidence(page, testInfo, use), { auto: true, timeout: 30_000 }],
});

export { expect };
