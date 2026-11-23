/**
 * What a failed test case means, told from its error text. Shared by the screenshot (src/utils/evidence) and the bug report
 * (src/reporters/bug-report), so both say the same.
 *
 *  - `bug`     a check of the application failed: it did not show / do what the sheet expects. The report lists it as a bug.
 *  - `blocked` the test could not get as far as the check (an element it had to use never appeared, the sign-in failed, ...).
 *              Not a confirmed bug: the report lists it apart, for someone to look at.
 */
export type FailureKind = 'bug' | 'blocked';

// colour codes in Playwright's messages
const ANSI = /\u001b\[[0-9;]*m/g;

export const plainText = (text: string): string => text.replace(ANSI, '');

/** How a hint starts in an error (see src/utils/core/hint.ts): what the application is known to do instead of the sheet. */
export const HINT_LABEL = 'Hint: ';

/** The hint a failed check carries, if any. */
export const hintOf = (message: string): string | undefined => new RegExp(`^\\s*${HINT_LABEL}(.+)$`, 'm').exec(plainText(message))?.[1]?.trim();

/** The actual result with the hint after it, when the failure has one. */
export const withHintText = (actual: string, message: string): string => {
  const hint = hintOf(message);
  return hint && !actual.includes(hint) ? `${actual}. ${HINT_LABEL}${hint}` : actual;
};

/** An application check (`expect(...)` or one of our own "not available" errors) failed - as opposed to a step that could not run. */
export const kindOfFailure = (message: string): FailureKind => {
  const text = plainText(message);
  if (/SETUP_FAILED/.test(text)) {
    return 'blocked';
  }
  if (/ACTION_NOT_AVAILABLE/.test(text)) {
    return 'bug';
  }
  if (/^\s*(Error:\s*)?(TimeoutError|locator\.|page\.|LOGIN_|INVALID_|MISSING_|NOT_A_SCENARIO)/m.test(text) && !/expect\(/.test(text)) {
    return 'blocked';
  }
  return /expect\(|\bExpected\b/.test(text) ? 'bug' : 'blocked';
};

/** The first lines of the error that say what was expected, without Playwright's call log. */
const headOf = (message: string): string[] => {
  const lines = plainText(message).split(/\r?\n/).map((line) => line.trim());
  const stop = lines.findIndex((line) => /^(Call log:|Locator:|Timeout:|=+ logs =+)/.test(line));
  return (stop < 0 ? lines : lines.slice(0, stop)).filter(Boolean);
};

/** In plain words: what the application did instead. */
export const actualOf = (message: string): string => {
  const text = plainText(message);
  const setup = /SETUP_FAILED: could not (.+?) before the check\.?\s*(.*)/.exec(text);
  if (setup) {
    const cause = (setup[2] ?? '').split('\n')[0].replace(/^(Error|TimeoutError):\s*/, '').trim();
    const why = cause ? `: ${cause.length > 220 ? `${cause.slice(0, 219)}…` : cause}` : '';
    return `the test could not ${setup[1]} (a step before the check), so the check itself was not reached${why}`;
  }
  const received = /^\s*Received(?: string| value| array)?:\s*(.+)$/m.exec(text)?.[1];
  if (received) {
    const expected = /^\s*Expected(?: string| substring| pattern| value| array)?:\s*(.+)$/m.exec(text)?.[1];
    return `${expected ? `expected ${expected.trim()}, but ` : ''}the system shows ${received.trim()}`;
  }
  if (/element\(s\) not found|waiting for locator|not found/i.test(text) && kindOfFailure(text) === 'bug') {
    return 'it is not on the page (nothing matching was found)';
  }
  if (/Timeout .* exceeded|Timeout:/i.test(text) && kindOfFailure(text) === 'blocked') {
    return 'the step timed out waiting for the page - the test could not continue';
  }
  const [first, second] = headOf(message);
  return [first, second && !/^expect\(/.test(second) ? second : ''].filter(Boolean).join(' - ');
};

/** What was expected, as the check says it (its own message), or the scenario's Then sentence. */
export const expectationOf = (message: string, then: string | undefined): string => {
  const first = headOf(message)[0]?.replace(/^(Error|TimeoutError):\s*/, '');
  if (then) {
    return then;
  }
  return first ?? 'the check passes';
};
