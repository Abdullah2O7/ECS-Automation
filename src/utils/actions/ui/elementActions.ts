import type { Locator } from '@playwright/test';
import { logger } from '../../logger/logger';
import { focusOnFailure } from '../../evidence/failure-focus';

/** The options Playwright's `locator.click()` accepts - timeout, noWaitAfter, force, position and so on. */
export type ClickOptions = Parameters<Locator['click']>[0];

/**
 * Replaces the value of an input, text area or search box with the provided text.
 * Uses Playwright's `fill()`, which clears the field itself before typing, so no separate clear is
 * performed - a second clear would fire extra input events that some controls react to.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} value - The text value to type into the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {Object} options - Optional configuration object
 * @param {boolean} [options.sensitive=false] - If true, hides the value in logs for sensitive data (passwords, tokens, etc.)
 * @returns {Promise<void>}
 * @example
 * await type(page.locator('#username'), 'john_doe', 'Username input');
 * await type(page.locator('#password'), 'secret123', 'Password input', { sensitive: true });
 */
export async function type(locator: Locator, value: string, elementName: string, options: { sensitive?: boolean } = {}): Promise<void> {
  logger.debug(`Filling element: "${elementName}"${options.sensitive ? ` (length: ${value.length})` : ` with value: "${value}"`}`);
  await focusOnFailure({ locator, what: elementName }, () => locator.fill(value));
}

/**
 * Types a value - committed with Enter and blurred when `commit` is set - and types it again while the field does not
 * keep it, at most `attempts` times: for a controlled input the application can clear just after it is filled (a date
 * field whose calendar is still opening). Fails with INPUT_VALUE_NOT_RETAINED, showing what the field held, when it
 * never keeps the value. Only for such fields; a field that keeps what is typed needs `type` alone.
 * @param {Locator} locator - The input
 * @param {string} value - The value it should hold
 * @param {string} elementName - Descriptive name of the element for logging and the error
 * @param {Object} [options]
 * @param {boolean} [options.commit=false] - Press Enter and blur after typing, as a date field needs
 * @param {number} [options.attempts=3] - How many times it is typed at most
 * @returns {Promise<void>}
 * @example
 * await typeUntilKept(page.locator('#birthDate-label'), '01/05/1998', 'Birthdate field', { commit: true });
 */
export async function typeUntilKept(locator: Locator, value: string, elementName: string, options: { commit?: boolean; attempts?: number } = {}): Promise<void> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await type(locator, value, elementName);
    if (options.commit) {
      await pressKey(locator, 'Enter', elementName);
      await blur(locator, elementName);
    }
    if ((await locator.inputValue()) === value) {
      return;
    }
    logger.debug(`"${elementName}" did not keep "${value}" (attempt ${attempt} of ${attempts})`);
  }
  throw new Error(`INPUT_VALUE_NOT_RETAINED:${elementName}: "${value}" typed ${attempts} times, the field holds "${await locator.inputValue()}".`);
}

/**
 * Performs a single click action on the specified element.
 * Waits for the element to be clickable before clicking.
 * @param {Locator} locator - The locator pointing to the element to click
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @param {ClickOptions} [options] - Passed to Playwright unchanged, e.g. `{ noWaitAfter: true }` for a click
 * that starts a navigation the caller waits for itself
 * @returns {Promise<void>}
 * @example
 * await click(page.locator('#submitButton'), 'Submit button');
 * await click(page.getByRole('button', { name: 'Sign In' }), 'Sign In button', { noWaitAfter: true });
 */
export async function click(locator: Locator, elementName: string, options?: ClickOptions): Promise<void> {
  logger.debug(`Clicking on element: "${elementName}"`);
  await focusOnFailure({ locator, what: elementName }, () => locator.click(options));
}

/**
 * Clears all text content from an input element or text area.
 * Removes any existing value without typing new content.
 * @param {Locator} locator - The locator pointing to the element to clear
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await clear(page.locator('#searchInput'), 'Search input field');
 */
export async function clear(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Clearing element: "${elementName}"`);
  await locator.clear();
}

/**
 * Presses a specific keyboard key on the focused element.
 * Useful for keyboard navigation, submitting forms, and triggering keyboard events.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} key - The key to press (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown')
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await pressKey(page.locator('#searchInput'), 'Enter', 'Search input');
 * await pressKey(page.locator('#modal'), 'Escape', 'Modal dialog');
 */
export async function pressKey(locator: Locator, key: string, elementName: string): Promise<void> {
  logger.debug(`Pressing key "${key}" on element: "${elementName}"`);
  await locator.press(key);
}

/**
 * Performs a double-click action on the specified element.
 * Useful for selecting text, opening edit modes, or triggering double-click handlers.
 * @param {Locator} locator - The locator pointing to the element to double-click
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await doubleClick(page.locator('.editable-cell'), 'Table cell');
 */
export async function doubleClick(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Double clicking on element: "${elementName}"`);
  await locator.dblclick();
}

/**
 * Performs a right-click (context menu) action on the specified element.
 * Useful for testing context menus and right-click behavior.
 * @param {Locator} locator - The locator pointing to the element to right-click
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await rightClick(page.locator('.menuItem'), 'Menu item');
 */
export async function rightClick(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Right clicking on element: "${elementName}"`);
  await locator.click({ button: 'right' });
}

/**
 * Drags an element and drops it onto a target element.
 * Simulates a complete drag-and-drop interaction across the DOM.
 * @param {Locator} sourceLocator - The locator pointing to the element to drag
 * @param {Locator} targetLocator - The locator pointing to the target drop location
 * @param {string} sourceElementName - Descriptive name of the source element for logging purposes
 * @param {string} targetElementName - Descriptive name of the target element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await dragAndDrop(
 *   page.locator('.draggable-item'),
 *   page.locator('.drop-zone'),
 *   'Draggable item',
 *   'Drop zone'
 * );
 */
export async function dragAndDrop(sourceLocator: Locator, targetLocator: Locator, sourceElementName: string, targetElementName: string): Promise<void> {
  logger.debug(`Dragging element: "${sourceElementName}" to element: "${targetElementName}"`);
  await sourceLocator.dragTo(targetLocator);
}

/**
 * Checks a checkbox or radio button element.
 * Ensures the element is checked/selected without errors if already checked.
 * @param {Locator} locator - The locator pointing to the checkbox or radio button
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await check(page.locator('#termsCheckbox'), 'Terms and conditions checkbox');
 * await check(page.locator('input[name="agreement"]'), 'Agreement radio button');
 */
export async function check(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Checking element: "${elementName}"`);
  await focusOnFailure({ locator, what: elementName }, () => locator.check());
}

/**
 * Unchecks a checkbox or deselects a radio button element.
 * Ensures the element is unchecked without errors if already unchecked.
 * @param {Locator} locator - The locator pointing to the checkbox or radio button
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await uncheck(page.locator('#termsCheckbox'), 'Terms and conditions checkbox');
 * await uncheck(page.locator('input[name="newsletter"]'), 'Newsletter subscription');
 */
export async function uncheck(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Unchecking element: "${elementName}"`);
  await locator.uncheck();
}

/**
 * Hovers the mouse cursor over an element.
 * Triggers hover states and tooltip displays without clicking.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await hover(page.locator('.tooltip-trigger'), 'Tooltip trigger element');
 * await hover(page.locator('.dropdown-menu'), 'Dropdown menu');
 */
export async function hover(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Hovering over element: "${elementName}"`);
  await locator.hover();
}

/**
 * Sets focus on an element.
 * Useful for triggering focus events and testing keyboard navigation.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await focus(page.locator('#emailInput'), 'Email input field');
 */
export async function focus(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Focusing on element: "${elementName}"`);
  await locator.focus();
}

/**
 * Removes focus from an element, firing its `blur` and `focusout` events.
 * Some inputs - spin buttons and masked fields among them - only commit a typed value to the form's
 * state when they lose focus, so a value that was filled but never blurred can be silently discarded.
 * @param {Locator} locator - The locator pointing to the element to blur
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await type(page.locator('#maxPlayers'), '25', 'Max Players field');
 * await blur(page.locator('#maxPlayers'), 'Max Players field');
 */
export async function blur(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Blurring element: "${elementName}"`);
  await locator.blur();
}

/**
 * Selects an option from a dropdown/select element by its value attribute.
 * Useful for testing select elements and dropdown menus.
 * @param {Locator} locator - The locator pointing to the select element
 * @param {string} value - The value attribute of the option to select
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await selectOptionByValue(page.locator('#countryDropdown'), 'US', 'Country dropdown');
 */
export async function selectOptionByValue(locator: Locator, value: string, elementName: string): Promise<void> {
  logger.debug(`Selecting option "${value}" in element: "${elementName}"`);
  await locator.selectOption({ value: value });
}

/**
 * Selects an option from a dropdown/select element by its visible label text.
 * More user-friendly than selecting by value as it matches visible text.
 * @param {Locator} locator - The locator pointing to the select element
 * @param {string} label - The visible text label of the option to select
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await selectOptionByLabel(page.locator('#countryDropdown'), 'United States', 'Country dropdown');
 */
export async function selectOptionByLabel(locator: Locator, label: string, elementName: string): Promise<void> {
  logger.debug(`Selecting option with label "${label}" in element: "${elementName}"`);
  await locator.selectOption({ label: label });
}

/**
 * Selects an option from a dropdown/select element by its index position.
 * Index starts at 0 for the first option.
 * @param {Locator} locator - The locator pointing to the select element
 * @param {number} index - The zero-based index of the option to select
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await selectOptionByIndex(page.locator('#typeDropdown'), 0, 'Type dropdown');
 */
export async function selectOptionByIndex(locator: Locator, index: number, elementName: string): Promise<void> {
  logger.debug(`Selecting option at index "${index}" in element: "${elementName}"`);
  await locator.selectOption({ index: index });
}

/**
 * Uploads a file to a file input element.
 * Sets the file path without triggering native file picker dialogs.
 * @param {Locator} locator - The locator pointing to the file input element
 * @param {string} filePath - The absolute or relative path to the file to upload
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await uploadFile(page.locator('#fileInput'), './test-data/document.pdf', 'File upload input');
 */
export async function uploadFile(locator: Locator, filePath: string, elementName: string): Promise<void> {
  logger.debug(`Uploading file "${filePath}" to element: "${elementName}"`);
  await locator.setInputFiles(filePath);
}

/**
 * Sets the value of an input element directly by setting the value property on the DOM element.
 * Useful for datetime-local, date, time, and other specialized input types where fill() doesn't work properly.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} value - The value to set into the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await setValue(page.locator('#dateTimeInput'), '2024-01-15T14:30', 'Date-Time input field');
 * await setValue(page.locator('#dateInput'), '2024-01-15', 'Date input');
 */
export async function setValue(locator: Locator, value: string, elementName: string): Promise<void> {
  logger.debug(`Setting value in element: "${elementName}" with value: "${value}"`);
  await locator.evaluate((element: HTMLInputElement, val: string) => { element.value = val; }, value);
}

/**
 * Scrolls an element to the middle of the viewport.
 *
 * Playwright scrolls an element only as far as it must before acting on it, which can leave it under a
 * sticky header or footer that then receives the click. Centring it avoids that. The element has to be
 * attached; one that is not fails with Playwright's own error.
 * @param {Locator} locator - The locator pointing to the element to scroll to
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<void>}
 * @example
 * await scrollIntoViewCentered(page.getByRole('button', { name: 'Submit' }), 'Submit button');
 */
export async function scrollIntoViewCentered(locator: Locator, elementName: string): Promise<void> {
  logger.debug(`Scrolling to the centre of the viewport: "${elementName}"`);
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
}

////////////////////////////////////Read Actions\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\

/**
 * Retrieves the text content of an element.
 * Returns the complete text including whitespace and nested content.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<string | null>} The text content of the element, or null if element has no text
 * @example
 * const buttonText = await getElementText(page.locator('#submitBtn'), 'Submit button');
 * logger.debug(buttonText); // "Submit"
 */
export async function getElementText(locator: Locator, elementName: string): Promise<string | null> {
  const text = await locator.textContent();
  logger.debug(`Retrieved text from element: "${elementName}" - Text: "${text}"`);
  return text;
}

/**
 * Retrieves the value of an input element.
 * Works with text inputs, textareas, selects, and other form elements.
 * @param {Locator} locator - The locator pointing to the input element
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<string | null>} The current value of the input element, or null if not applicable
 * @example
 * const emailValue = await getElementValue(page.locator('#emailInput'), 'Email input');
 * logger.debug(emailValue); // "user@example.com"
 */
export async function getElementValue(locator: Locator, elementName: string): Promise<string | null> {
  const value = await locator.inputValue();
  logger.debug(`Retrieved value from element: "${elementName}" - Value: "${value}"`);
  return value;
}

/**
 * Retrieves the value of a specific HTML attribute from an element.
 * Useful for verifying element properties like href, src, class, data-* attributes, etc.
 * @param {Locator} locator - The locator pointing to the element
 * @param {string} attributeName - The name of the attribute to retrieve (e.g., 'href', 'class', 'data-id')
 * @param {string} elementName - Descriptive name of the element for logging purposes
 * @returns {Promise<string | null>} The attribute value, or null if the attribute doesn't exist
 * @example
 * const href = await getElementAttribute(page.locator('a.link'), 'href', 'Navigation link');
 * logger.debug(href); // "https://example.com"
 * const dataId = await getElementAttribute(page.locator('.item'), 'data-id', 'List item');
 * logger.debug(dataId); // "12345"
 */
export async function getElementAttribute(locator: Locator, attributeName: string, elementName: string): Promise<string | null> {
  const attributeValue = await locator.getAttribute(attributeName);
  logger.debug(`Retrieved attribute "${attributeName}" from element: "${elementName}" - Value: "${attributeValue}"`);
  return attributeValue;
}
