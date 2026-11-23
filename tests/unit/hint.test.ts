import { expect, test } from '@playwright/test';
import { hintOf, kindOfFailure, withHintText } from '../../src/utils/evidence/failure-kind';

const failed = 'Error: the category list should have the columns Article Count\n\nexpect(received).toBe(expected)\n\nExpected: "all present"\nReceived: "missing Article Count"\nHint: the category list has no Article Count column.';

test.describe('Hints on a failed check (what the application does instead of the sheet)', () => {
  test('the hint is read from the error, and the failure is still a bug', () => {
    expect(hintOf(failed)).toBe('the category list has no Article Count column.');
    expect(kindOfFailure(failed)).toBe('bug');
  });

  test('the actual result carries the hint once; without a hint it is unchanged', () => {
    expect(withHintText('the system shows "missing Article Count"', failed)).toBe('the system shows "missing Article Count". Hint: the category list has no Article Count column.');
    expect(withHintText('the category list has no Article Count column.', failed)).toBe('the category list has no Article Count column.');
    expect(withHintText('it is not on the page', 'Error: expect(locator).toBeVisible() failed')).toBe('it is not on the page');
    expect(hintOf('Error: expect(locator).toBeVisible() failed')).toBeUndefined();
  });
});
