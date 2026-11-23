import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { STOPPED_BY_USER } from '../../utils/core/run-control';
import { actualOf, kindOfFailure, withHintText } from '../../utils/evidence/failure-kind';

/**
 * Tells the dashboard, while a run is going, how each test ended - so the page updates test by test instead of at the
 * end. It only runs when the dashboard starts Playwright (playwright.config.ts adds it when DASHBOARD_RUN_DIR is set).
 * Each line is `@@dashboard {json}` on stdout; the dashboard reads those lines and keeps them out of the log.
 *
 * A try that failed but will be tried again is reported as still running, with which try comes next and why the last
 * one failed. A case that could not complete its steps after its last try is blocked, with the reason.
 */
export const LIVE_PREFIX = '@@dashboard ';

export type LiveEvent = {
  project: string;
  title: string;
  status: 'passed' | 'failed' | 'blocked' | 'running';
  /** Why it is blocked, or which try is running and why the previous one failed. */
  reason?: string;
  /** The error of a failed case. */
  error?: string;
};

const send = (event: LiveEvent): void => {
  process.stdout.write(`${LIVE_PREFIX}${JSON.stringify(event)}\n`);
};

export default class LiveReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? '';
    const message = result.error?.message ?? '';
    // A retried test reports each try; only the last one is its outcome
    if ((result.status === 'failed' || result.status === 'timedOut') && result.retry < test.retries) {
      send({ project, title: test.title, status: 'running', reason: `try ${result.retry + 2} of ${test.retries + 1} - the last try: ${withHintText(actualOf(message), message)}` });
      return;
    }
    // A test that was not started because Stop was pressed has not changed: the dashboard keeps its earlier result
    if (test.annotations.some((annotation) => annotation.description === STOPPED_BY_USER)) {
      return;
    }
    if (test.outcome() === 'skipped') {
      send({ project, title: test.title, status: 'blocked' });
      return;
    }
    if (result.status === 'passed') {
      send({ project, title: test.title, status: 'passed' });
      return;
    }
    if (kindOfFailure(message) === 'blocked') {
      send({ project, title: test.title, status: 'blocked', reason: `${actualOf(message)} (after ${result.retry + 1} ${result.retry ? 'tries' : 'try'})`, error: message });
      return;
    }
    send({ project, title: test.title, status: 'failed', error: message });
  }
}
