import { type Locator, expect } from '@playwright/test';
import { logger } from '../../logger/logger';
import { focusOnFailure } from '../../evidence/failure-focus';

/**
 * Options every element assertion accepts.
 *
 * `message` becomes the assertion's title in the report and the first line of its failure, so a
 * failure says what was expected in the application's terms rather than only naming a locator.
 * `timeout` overrides the configured expect timeout for assertions that wait on slow server work.
 */
export type AssertionOptions = {
    message?: string;
    timeout?: number;
    /** Where the element should be, for the failure screenshot to frame when the element itself is missing. */
    frame?: Locator;
};

/** Playwright's `expect`, carrying the custom message when one is given. */
const expectLocator = (locator: Locator, options: AssertionOptions) =>
    // eslint-disable-next-line playwright/valid-expect -- returned for the calling assertion to apply its matcher
    expect(locator, options.message);

////////////////////////////////////State Assertions\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\

/**
 * Asserts that an element is visible in the viewport.
 * Throws an error if the element is hidden, detached, or outside the viewport.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is not visible
 * @example
 * await assertVisible(page.locator('#successMessage'), 'Success message');
 * await assertVisible(row, 'Grid row', { message: 'the grid should list the new record', timeout: 30_000 });
 */
export async function assertVisible(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is visible`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeVisible({ timeout: options.timeout }));
}

/**
 * Asserts that an element is hidden from view.
 * An element is considered hidden if it's not visible, detached, or has display:none.
 * Waits for the element to become hidden, up to the timeout; it does not wait for the page to go
 * quiet first, since a single-page application may never stop polling.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is visible
 * @example
 * await assertHidden(page.locator('#errorModal'), 'Error modal');
 */
export async function assertHidden(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is hidden`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeHidden({ timeout: options.timeout }));
}

/**
 * Asserts that a form element (button, input, select, etc.) is enabled and interactive.
 * Useful for verifying that form controls are ready for user interaction.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is disabled
 * @example
 * await assertEnabled(page.locator('#submitButton'), 'Submit button');
 */
export async function assertEnabled(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is enabled`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeEnabled({ timeout: options.timeout }));
}

/**
 * Asserts that a form element is disabled and not interactive.
 * Useful for verifying that controls are gated until a form is complete.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is enabled
 * @example
 * await assertDisabled(page.locator('#submitButton'), 'Submit button');
 */
export async function assertDisabled(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is disabled`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeDisabled({ timeout: options.timeout }));
}

/**
 * Asserts that a checkbox, radio button or switch is checked.
 * @param {Locator} locator - The locator pointing to the checkbox or radio button
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is not checked
 * @example
 * await assertChecked(page.locator('#termsCheckbox'), 'Terms checkbox');
 */
export async function assertChecked(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is checked`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeChecked({ timeout: options.timeout }));
}

/**
 * Asserts that a checkbox, radio button or switch is not checked.
 * @param {Locator} locator - The locator pointing to the checkbox or radio button
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is checked
 * @example
 * await assertNotChecked(page.locator('#newsletterCheckbox'), 'Newsletter checkbox');
 */
export async function assertNotChecked(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is not checked`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).not.toBeChecked({ timeout: options.timeout }));
}

/**
 * Asserts that an input element is editable (enabled and not read-only).
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is not editable
 * @example
 * await assertEditable(page.locator('#nameInput'), 'Name input');
 */
export async function assertEditable(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is editable`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toBeEditable({ timeout: options.timeout }));
}

/**
 * Asserts that an input element is not editable (disabled or read-only).
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is editable
 * @example
 * await assertNotEditable(page.locator('#organizerInput'), 'Organizer input');
 */
export async function assertNotEditable(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is not editable`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).not.toBeEditable({ timeout: options.timeout }));
}

/**
 * Asserts that an element is not empty: an input has a value, or any other element has text.
 * Useful for fields the application fills in by itself, where the exact value is not known.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element is still empty when the timeout expires
 * @example
 * await assertNotEmpty(page.locator('#generatedCode'), 'Generated code');
 */
export async function assertNotEmpty(locator: Locator, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" is not empty`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).not.toBeEmpty({ timeout: options.timeout }));
}

/////////////////////////////////////Content Assertions\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\

/**
 * Asserts that an element's text matches the expected text.
 * A string is an exact match on the element's trimmed text; a RegExp is matched against it.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string | RegExp} expectedText - The exact text, or a pattern, expected in the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element's text does not match
 * @example
 * await assertText(page.locator('.header'), 'Welcome to Dashboard', 'Page header');
 */
export async function assertText(locator: Locator, expectedText: string | RegExp, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the expected text: "${expectedText}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveText(expectedText, { timeout: options.timeout }));
}

/**
 * Asserts that an element's text contains the specified substring.
 * Performs a partial match, allowing for other text before or after the substring.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string | RegExp} expectedSubstring - The substring, or a pattern, expected in the element's text
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element's text does not contain the substring
 * @example
 * await assertTextContains(page.locator('.message'), 'Success', 'Status message');
 */
export async function assertTextContains(locator: Locator, expectedSubstring: string | RegExp, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" contains the expected substring: "${expectedSubstring}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toContainText(expectedSubstring, { timeout: options.timeout }));
}


/**
 * Asserts that a value already read during the flow - a count, a flag, a cell's text - is exactly the expected one
 * (`toBe`). Synchronous: it checks a value in hand. A value that is still settling on the page needs a locator
 * assertion or `assertEventually` instead.
 * @param actualValue - The value the application produced
 * @param expectedValue - The exact value expected
 * @param description - What is being checked; a failure shows it above Playwright's expected/received diff
 * @throws {Error} If the value is not exactly the expected one
 * @example
 * assertToBe(await page.isGenerateOffered(), false, 'Generate Fixture offered once the fixtures exist');
 */
export function assertToBe<T>(actualValue: T, expectedValue: T, description: string): void {
    logger.debug(`Asserting that ${description} is: "${String(expectedValue)}"`);
    expect(actualValue, description).toBe(expectedValue);
}

/**
 * Asserts that a value already read during the flow equals one of the allowed values (deep equality, so objects
 * and arrays compare by content) - for a rule with more than one right answer, such as a date that may be today
 * or yesterday depending on the server's clock. A failure lists the allowed values and the value received.
 * @param actualValue - The value the application produced
 * @param allowedValues - Every value that is acceptable
 * @param description - What is being checked; a failure shows it above Playwright's diff
 * @throws {Error} If the value equals none of the allowed values
 * @example
 * assertOneOf(rowDate, [today, yesterday], `request ${id} should be dated today`);
 */
export function assertOneOf<T>(actualValue: T, allowedValues: readonly T[], description: string): void {
    logger.debug(`Asserting that ${description} is one of: ${allowedValues.map((value) => JSON.stringify(value)).join(', ')}`);
    expect(allowedValues, description).toContainEqual(actualValue);
}

/**
 * Asserts that an input element holds the expected value.
 * A string is an exact match; a RegExp is matched against the value.
 * @param {Locator} locator - The locator pointing to the input element
 * @param {string | RegExp} expectedValue - The value, or a pattern, expected in the input
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the input's value does not match
 * @example
 * await assertInputValue(page.locator('#email'), 'user@example.com', 'Email input');
 */
export async function assertInputValue(locator: Locator, expectedValue: string | RegExp, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the expected input value: "${expectedValue}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveValue(expectedValue, { timeout: options.timeout }));
}

/**
 * Asserts that an element has an attribute with the expected value.
 * A string is an exact match; a RegExp is matched against the attribute value.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} attributeName - The name of the attribute to check (e.g., 'href', 'aria-selected')
 * @param {string | RegExp} expectedValue - The value, or a pattern, expected in the attribute
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the attribute is missing or its value does not match
 * @example
 * await assertAttribute(page.getByRole('tab', { name: 'Rules' }), 'aria-selected', 'true', 'Rules tab');
 */
export async function assertAttribute(locator: Locator, attributeName: string, expectedValue: string | RegExp, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the attribute: "${attributeName}" with the expected value: "${expectedValue}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveAttribute(attributeName, expectedValue, { timeout: options.timeout }));
}

/**
 * Asserts that an element's attribute contains the specified substring.
 * The substring is matched literally, so characters such as `.` or `(` need no escaping.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} attributeName - The name of the attribute to check
 * @param {string} expectedSubstring - The substring expected in the attribute value
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the attribute is missing or does not contain the substring
 * @example
 * await assertAttributeContains(page.locator('a.logo'), 'href', '/home', 'Logo link');
 */
export async function assertAttributeContains(locator: Locator, attributeName: string, expectedSubstring: string, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the attribute: "${attributeName}" containing the expected substring: "${expectedSubstring}"`);
    const literal = new RegExp(expectedSubstring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveAttribute(attributeName, literal, { timeout: options.timeout }));
}

/**
 * Asserts that an element's class list matches the expected value.
 * A string is an exact match on the whole `class` attribute; a RegExp can check for a single class,
 * e.g. `/\bactive\b/`.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string | RegExp} expectedClass - The full class value, or a pattern for one class
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the class list does not match when the timeout expires
 * @example
 * await assertClass(page.getByRole('tab').nth(1), /\bactive\b/, 'Second tab');
 */
export async function assertClass(locator: Locator, expectedClass: string | RegExp, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the class: "${expectedClass}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveClass(expectedClass, { timeout: options.timeout }));
}

/**
 * Asserts that a locator resolves to exactly the expected number of elements.
 * Waits for the count to settle on the expected number, up to the timeout.
 * @param {Locator} locator - The locator whose matches are counted
 * @param {number} expectedCount - The number of elements expected
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns {Promise<void>}
 * @throws {Error} If the count differs when the timeout expires
 * @example
 * await assertCount(page.locator('.grid-row'), 3, 'Grid rows');
 */
export async function assertCount(locator: Locator, expectedCount: number, elementName: string, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Asserting that the element: "${elementName}" has the expected count: "${expectedCount}"`);
    await focusOnFailure({ locator, area: options.frame, what: options.message ?? elementName }, () => expectLocator(locator, options).toHaveCount(expectedCount, { timeout: options.timeout }));
}

/////////////////////////////////////Polling Assertions\\\\\\\\\\\\\\\\\

/**
 * Starts a retrying assertion on a value computed by the probe, for state no single locator matcher
 * covers - a count summed from several elements, a URL read alongside the DOM, a figure read from a
 * dashboard that fills in after it renders.
 *
 * Returns Playwright's polling assertion, so the caller chains the matcher that fits and keeps its
 * diagnostics (`expected 24, received 23`) rather than a bare "condition not met". The probe is called
 * repeatedly until the matcher passes or the timeout expires; it should only read, never act.
 * @param {() => T | Promise<T>} probe - Reads the value to assert on
 * @param {AssertionOptions} [options] - Custom failure message and timeout
 * @returns The polling assertion to chain a matcher on, e.g. `.toBe(expected)` or `.not.toBe('')`
 * @example
 * await assertEventually(() => dashboard.readParticipatingTeams(), { message: 'every team should be engaged', timeout: 60_000 }).toBe(24);
 * await assertEventually(() => isPortalUrl(page.url()), { message: 'the sign-in should return to the portal' }).toBe(true);
 */
export function assertEventually<T>(probe: () => T | Promise<T>, options: AssertionOptions = {}) {
    logger.debug(`Polling until: ${options.message ?? 'the probed value matches'}`);
    // eslint-disable-next-line playwright/valid-expect -- returned for the caller to chain its matcher (see @returns)
    return expect.poll(probe, { message: options.message, timeout: options.timeout });
}

/**
 * Repeats an IDEMPOTENT interaction together with its own check until the check passes (Playwright's `toPass`) - for a
 * UI that can ignore an action made while it is still loading or re-rendering: searching again, hovering again.
 * Only for interactions that are safe to repeat; never for a business action (Submit, Save, Publish, Send, Approve),
 * which would then be performed twice.
 * @param {() => Promise<void>} interaction - The action(s) and the assertion proving they took effect
 * @param {AssertionOptions} [options] - Custom failure message and timeout for the whole retry
 * @returns {Promise<void>}
 * @example
 * await retryIdempotent(async () => {
 *   await hover(icon, 'Published icon');
 *   await assertVisible(tooltip, 'tooltip', { timeout: 2_000 });
 * }, { message: 'hovering the icon should show its tooltip', timeout: 20_000 });
 */
export async function retryIdempotent(interaction: () => Promise<void>, options: AssertionOptions = {}): Promise<void> {
    logger.debug(`Repeating until it takes effect: ${options.message ?? 'an idempotent interaction'}`);
    await expect(interaction, options.message).toPass({ timeout: options.timeout });
}
