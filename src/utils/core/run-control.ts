import { existsSync } from 'node:fs';

/**
 * How the dashboard's Stop button asks a run to finish politely. It creates the file named by DASHBOARD_STOP_FILE; every test
 * checks for it before it starts and skips itself, so the test that is running ends normally (its clean-up runs, its
 * screenshot is taken) and Playwright still writes its reports and the bug report for everything that was tested.
 * Plain Node, no Playwright import: the dashboard uses the same constants.
 */
export const STOP_FILE_VARIABLE = 'DASHBOARD_STOP_FILE';

/** The skip reason of a test that was not started because the run was stopped. The dashboard keeps such a test's earlier result. */
export const STOPPED_BY_USER = 'Run stopped by the user - this test was not started';

export const stopRequested = (): boolean => {
  const file = process.env[STOP_FILE_VARIABLE];
  return Boolean(file) && existsSync(file as string);
};
