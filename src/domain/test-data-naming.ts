/**
 * How the data the tests create in the back office is named, so it can always be told from real content.
 * Pure: no browser, no environment.
 */

/** Every article and uploaded file a test creates carries this prefix - the cleanup deletes nothing without it. */
export const TEST_DATA_PREFIX = 'auto-test';

/** A unique name for a thing a test creates: `auto-test-<run>-<label>-<n>`. */
export const testDataName = (runId: string, label: string, sequence: number): string =>
  `${TEST_DATA_PREFIX}-${runId}-${label}-${sequence}`;

/** Whether a name is one the tests gave (case-insensitive: the back office may change the case of a file name). */
export const isTestDataName = (name: string | undefined | null): boolean => Boolean(name?.trim().toLowerCase().startsWith(`${TEST_DATA_PREFIX}-`));

/**
 * When a test named this thing: the run id starts with the time it began, in base 36 (8 characters until the year 2059).
 * `undefined` for a name that is not test data or does not carry a time.
 */
export const testDataCreatedAt = (name: string | undefined | null): number | undefined => {
  const match = new RegExp(`^${TEST_DATA_PREFIX}-([0-9a-z]{8})`, 'i').exec(name?.trim() ?? '');
  if (!match) {
    return undefined;
  }
  const time = parseInt(match[1].toLowerCase(), 36);
  return Number.isFinite(time) ? time : undefined;
};
