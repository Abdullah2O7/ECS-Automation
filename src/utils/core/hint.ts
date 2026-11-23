import { test } from '@playwright/test';
import { HINT_LABEL } from '../evidence/failure-kind';

/**
 * Runs a check written against the sheet where the application is known to behave differently. When the check fails, the
 * failure says what the application does instead ("Hint: the back office limits Name to 100 characters"): the line is added
 * to the error, so the dashboard, the screenshot and the bug report show it. A check that passes shows nothing.
 *
 * Never loosens the check: the case still fails when the application differs from the sheet.
 */
export const withHint = async <T>(hint: string, check: () => Promise<T> | T): Promise<T> => {
  try {
    return await check();
  } catch (error) {
    if (error instanceof Error && !error.message.includes(`\n${HINT_LABEL}`)) {
      error.message = `${error.message}\n${HINT_LABEL}${hint}`;
    }
    test.info().annotations.push({ type: 'Hint', description: hint });
    throw error;
  }
};
