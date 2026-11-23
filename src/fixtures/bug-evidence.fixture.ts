import type { Page, TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { captureBugEvidence, EVIDENCE_ATTACHMENT } from '../utils/evidence/bug-evidence';
import { clearFocus } from '../utils/evidence/failure-focus';
import { kindOfFailure } from '../utils/evidence/failure-kind';
import { previousTry, rememberTry } from '../utils/runtime/run-memory';

/**
 * The auto fixture that frames the problem on the screenshot of a failed test case (see utils/evidence/bug-evidence.ts).
 * Each fixture file adds it to its `test.extend`:
 *
 *   bugEvidence: [async ({ page }, use, testInfo) => withBugEvidence(page, testInfo, use), { auto: true, timeout: 30_000 }],
 *
 * It must be torn down BEFORE anything that changes the screen (the CMS clean-up), so a fixture that does that lists
 * this one as its dependency's dependent: here, `bugEvidence` depends on `cmsCleanup`.
 */
/**
 * A retry of a case whose check failed (a bug, not a step that could not be done): the bug is reported again at once, with
 * its screenshot, instead of a second and third full run. Used as an auto fixture that needs nothing else, so the retry
 * does not even sign in (src/fixtures/session.ts).
 */
export const repeatKnownBug = async (testInfo: TestInfo): Promise<void> => {
  const previous = testInfo.retry > 0 ? previousTry(testInfo.testId) : undefined;
  if (previous?.kind !== 'bug') {
    return;
  }
  if (previous.evidence && existsSync(previous.evidence)) {
    await testInfo.attach(EVIDENCE_ATTACHMENT, { path: previous.evidence, contentType: 'image/png' });
  }
  // The message as Playwright reported it starts with the error's class ("Error: ..."), which a new Error adds again
  throw new Error(previous.message.replace(/^\s*Error:\s*/, ''));
};

export const withBugEvidence = async (page: Page, testInfo: TestInfo, use: () => Promise<void>): Promise<void> => {
  clearFocus();
  await use();
  await captureBugEvidence(page, testInfo);
  if (testInfo.status !== testInfo.expectedStatus && testInfo.status !== 'skipped') {
    const message = testInfo.error?.message ?? 'The test failed.';
    const evidence = testInfo.attachments.find((attachment) => attachment.name === EVIDENCE_ATTACHMENT)?.path;
    rememberTry(testInfo.testId, { kind: kindOfFailure(message), message, ...(evidence ? { evidence } : {}) });
  }
};
