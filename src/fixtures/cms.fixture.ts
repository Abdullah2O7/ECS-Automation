import path from 'node:path';
import type { TestInfo } from '@playwright/test';
import { test as sessionTest, expect } from './session';
import { withBugEvidence } from './bug-evidence.fixture';
import { CmsApi } from '../api/cms/cms.api';
import { testDataName } from '../domain/test-data-naming';
import { logger } from '../utils/logger/logger';
import { writeTestFile, type TestFileKind } from '../utils/core/test-files';

/**
 * Fixtures for the back office (CMS) test cases: Playwright's `page`, already signed in as the CMS account (see session.ts),
 * plus the helpers a case needs to create its own data.
 *
 * ```ts
 * import { expect, test } from '../../../src/fixtures/cms.fixture';
 * test('...', async ({ cmsApi, testData }) => { ... });
 * ```
 *
 * ADD THE ECS SCREENS HERE: each story's page objects (src/pages/cms/...) become fixtures of this file, the way the
 * generic `cmsApi` and `testData` are below. The building blocks are src/pages/cms/document-editor.page.ts,
 * document-form.page.ts and umbraco-ui.ts.
 *
 * DATA RULE: whatever a case creates (pages, uploaded pictures and files) is named by `testData` and tracked by its id;
 * when the case ends, pass or fail, exactly those are removed - and only those (see CmsApi.cleanUp).
 */
export type TestData = {
  /** A unique name for something this case creates: `auto-test-<run>-<label>-<n>`. */
  name: (label: string) => string;
  /** Writes a file of a format and an exact size, named as test data, and returns its path. */
  file: (kind: TestFileKind, label: string, size: number) => string;
};

type CmsFixtures = {
  cmsApi: CmsApi;
  testData: TestData;
  /** Removes what the case created; runs by itself after every case. */
  cmsCleanup: void;
  /** Frames the problem on the screenshot of a failed case; depends on the clean-up so it is torn down first, while the screen is still as the test left it. */
  bugEvidence: void;
};

// Test data an interrupted run left behind is removed once per worker, before its first case (see CmsApi.sweepLeftovers)
const LEFTOVER_AGE = 90 * 60_000;
let leftoversSwept = false;

/** How long removing a case's test data may take, after the case. */
export const CLEANUP_TIMEOUT = 120_000;

/**
 * Where the cases create their test data. Home only for now: ADD the ids of the lists a story creates under (a news
 * list, say), so the test data an interrupted run left there is swept too.
 */
const leftoverParents = async (cmsApi: CmsApi): Promise<string[]> => {
  const homeId = await cmsApi.homeId().catch(() => undefined);
  return [homeId].filter((id): id is string => Boolean(id));
};

/**
 * Removes the test data an earlier, interrupted run left behind, once per worker, before its first case. Only what is
 * named as test data and older than LEFTOVER_AGE is removed (see CmsApi.sweepLeftovers).
 */
export const sweepLeftoversOnce = async (cmsApi: CmsApi): Promise<void> => {
  if (leftoversSwept) {
    return;
  }
  leftoversSwept = true;
  const lists = await leftoverParents(cmsApi);
  const removed = await cmsApi.sweepLeftovers(lists, LEFTOVER_AGE).catch((error: unknown) => {
    logger.warn(`Leftover test data could not be checked: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  });
  if (removed.length > 0) {
    logger.info(`Removed test data an earlier, interrupted run left behind: ${removed.join(', ')}`);
  }
};

/** Removes exactly what the case created (see CmsApi.cleanUp); what could not be removed is logged and noted on the case. */
export const cleanUpCase = async (cmsApi: CmsApi, testInfo: TestInfo): Promise<void> => {
  const problems = await cmsApi.cleanUp().catch((error: unknown) => [`cleanup failed: ${error instanceof Error ? error.message : String(error)}`]);
  for (const problem of problems) {
    logger.warn(`Test data left in the back office: ${problem}`);
    testInfo.annotations.push({ type: 'cleanup', description: problem });
  }
};

export const test = sessionTest.extend<CmsFixtures>({
  cmsApi: async ({ page }, use) => use(new CmsApi(page)),

  testData: async ({}, use) => {
    const runId = `${Date.now().toString(36)}${process.pid.toString(36)}`;
    let sequence = 0;
    await use({
      name: (label) => testDataName(runId, label, (sequence += 1)),
      file: (kind, label, size) => writeTestFile(path.resolve('test-output', 'cms-test-files', runId), testDataName(runId, label, (sequence += 1)), kind, size),
    });
  },

  cmsCleanup: [
    async ({ cmsApi }, use, testInfo) => {
      await sweepLeftoversOnce(cmsApi);
      await use();
      await cleanUpCase(cmsApi, testInfo);
    },
    { auto: true, timeout: CLEANUP_TIMEOUT },
  ],

  bugEvidence: [async ({ page, cmsCleanup: _cleanup }, use, testInfo) => withBugEvidence(page, testInfo, use), { auto: true, timeout: 30_000 }],
});

export { expect };
