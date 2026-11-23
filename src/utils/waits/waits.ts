import type { Locator, Page } from '@playwright/test';
import { logger } from '../logger/logger';

/**
 * Waits for a page to fully load by checking multiple load states.
 * Ensures the DOM is rendered, all network requests are complete, and the page is fully ready.
 * Waits for three states in sequence: 'domcontentloaded', 'networkidle', and 'load'.
 * @param {Page} page - The Playwright page object to wait for
 * @returns {Promise<void>}
 * @example
 * await waitForPageToLoad(page);
 * // Page is now fully loaded and ready for interaction
 */
export async function waitForPageToLoad(page: Page): Promise<void> {
    logger.debug('Waiting for page to load');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle');
    await page.waitForLoadState('load');
}

/**
 * Waits for an element to reach a state: attached to the DOM, detached from it, visible or hidden.
 *
 * The deterministic alternative to a fixed sleep - it returns as soon as the state is reached and
 * fails, with Playwright's own error, if it is not reached in time. A caller for which the state is
 * optional (a spinner a fast response may never show, say) catches that rejection itself, where the
 * reason can be written down, rather than having it swallowed here.
 * @param {Locator} locator - The locator pointing to the element; it must resolve to a single element
 * @param {'attached' | 'detached' | 'visible' | 'hidden'} state - The state to wait for
 * @param {{ timeout?: number }} [options] - Overrides the configured action timeout
 * @returns {Promise<void>}
 * @throws {Error} If the element does not reach the state before the timeout
 * @example
 * await waitForElementState(page.locator('.spinner').first(), 'hidden', { timeout: 30_000 });
 */
export async function waitForElementState(
    locator: Locator,
    state: 'attached' | 'detached' | 'visible' | 'hidden',
    options: { timeout?: number } = {},
): Promise<void> {
    logger.debug(`Waiting for the element to be ${state}`);
    await locator.waitFor({ state, timeout: options.timeout });
}

/**
 * Waits for the page to reach one load state - unlike `waitForPageToLoad`, which waits for all three
 * in turn, including `networkidle`, which a single-page application that keeps polling may never reach.
 * Resolves at once when the state has already been reached for the current document, so it is safe to
 * call after an action that may or may not have started a navigation.
 * @param {Page} page - The Playwright page object
 * @param {'load' | 'domcontentloaded' | 'networkidle'} [state='load'] - The load state to wait for
 * @param {{ timeout?: number }} [options] - Overrides the configured navigation timeout
 * @returns {Promise<void>}
 * @throws {Error} If the state is not reached before the timeout
 * @example
 * await click(submitButton, 'Submit button');
 * await waitForLoadState(page, 'domcontentloaded');
 */
export async function waitForLoadState(
    page: Page,
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
    options: { timeout?: number } = {},
): Promise<void> {
    logger.debug(`Waiting for the page to reach the "${state}" load state`);
    await page.waitForLoadState(state, { timeout: options.timeout });
}
