import type { Page, Locator, Frame, Response } from '@playwright/test';
import { logger } from '../../logger/logger';

/** The options Playwright's `page.goto()` accepts - `waitUntil`, `timeout` and `referer`. */
export type NavigateOptions = Parameters<Page['goto']>[1];

/**
 * Navigates the current page to a URL.
 * By default it returns once the page's `load` event fires; pass `waitUntil: 'domcontentloaded'` for a
 * single-page application whose shell loads long before its content.
 * @param {Page} page - The Playwright page object
 * @param {string} url - The absolute URL to navigate to (e.g., 'https://example.com/login')
 * @param {NavigateOptions} [options] - Passed to Playwright unchanged, e.g. `{ waitUntil: 'domcontentloaded', timeout: 60_000 }`
 * @returns {Promise<void>}
 * @example
 * await navigate(page, 'https://example.com/login');
 * await navigate(page, `${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
 */
export async function navigate(page: Page, url: string, options?: NavigateOptions): Promise<void> {
    logger.debug(`Navigating to URL: ${url}`);
    await page.goto(url, options);
}

/**
 * Sends every plain-http request to a site's host on to https - what a visitor's browser does on its own for a site
 * that has HTTPS enforced, but a fresh test browser does not.
 *
 * Needed for an application behind a proxy that ends TLS: it can build its redirects (the Umbraco sign-in page, for
 * one) as `http://<host>/...` while only https is reachable, which leaves the browser on an error page.
 * @param {Page} page - The Playwright page object
 * @param {string} siteUrl - The https address of the site, e.g. `https://example.com`
 * @example
 * await upgradeHttpToHttps(page, 'https://cms.example.com');
 */
export async function upgradeHttpToHttps(page: Page, siteUrl: string): Promise<void> {
    const { protocol, host } = new URL(siteUrl);
    if (protocol !== 'https:') {
        return;
    }
    await page.route(`http://${host}/**`, (route) => {
        const upgraded = route.request().url().replace(/^http:/, 'https:');
        logger.debug(`Upgrading an http request to https: ${new URL(upgraded).pathname}`);
        return route.fulfill({ status: 307, headers: { location: upgraded } });
    });
    // A server redirect to http is followed by the browser without passing the route above, so the answers that redirect
    // (Umbraco's sign-in endpoints) are rewritten before the browser sees them: their http Location becomes https.
    // Without this the browser waits for the closed http port to time out - 20 s or more on every sign-in.
    await page.route(`https://${host}/umbraco/management/api/v1/security/**`, async (route) => {
        const response = await route.fetch({ maxRedirects: 0 }).catch(() => undefined);
        if (!response) {
            return route.continue();
        }
        const headers = response.headers();
        if (headers.location?.startsWith(`http://${host}`)) {
            logger.debug(`Upgrading a redirect to https: ${new URL(headers.location).pathname}`);
            headers.location = headers.location.replace(/^http:/, 'https:');
        }
        return route.fulfill({ response, headers });
    });
}

/**
 * Refreshes the current page by reloading it.
 * Equivalent to pressing F5 or clicking the refresh button.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<void>}
 * @example
 * await refresh(page);
 */
export async function refresh(page: Page): Promise<void> {
    logger.debug('Refreshing the page');
    await page.reload();
}

/**
 * Navigates back to the previous page in the browser history.
 * Equivalent to clicking the back button in the browser.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<void>}
 * @example
 * await goBack(page);
 */
export async function goBack(page: Page): Promise<void> {
    logger.debug('Navigating back to the previous page');
    await page.goBack();
}

/**
 * Navigates forward to the next page in the browser history.
 * Equivalent to clicking the forward button in the browser.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<void>}
 * @example
 * await goForward(page);
 */
export async function goForward(page: Page): Promise<void> {
    logger.debug('Navigating forward to the next page');
    await page.goForward();
}

/**
 * Handles and accepts JavaScript alert dialogs.
 * Optionally provides text input for prompt dialogs before accepting.
 * @param {Page} page - The Playwright page object
 * @param {string} [text] - Optional text to input in prompt dialogs
 * @returns {Promise<void>}
 * @example
 * await acceptAlert(page);
 * await acceptAlert(page, 'User input text'); // For prompt dialogs
 */
export async function acceptAlert(page: Page, text?: string): Promise<void> {
    logger.debug('Accepting the alert dialog');
    page.once('dialog', dialog => dialog.accept(text));
}

/**
 * Dismisses JavaScript alert dialogs by clicking the cancel or close button.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<void>}
 * @example
 * await dismissAlert(page);
 */
export async function dismissAlert(page: Page): Promise<void> {
    logger.debug('Dismissing the alert dialog');
    page.once('dialog', dialog => dialog.dismiss());
}

/**
 * Retrieves the message text from a JavaScript alert dialog.
 * Automatically dismisses the dialog after capturing the message.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<string>} The message text from the alert dialog
 * @example
 * const alertMessage = await getAlertMessage(page);
 * logger.debug(alertMessage); // "Are you sure?"
 */
export async function getAlertMessage(page: Page): Promise<string> {
    return new Promise<string>((resolve) => {
        page.once('dialog', async (dialog) => {
            const message = dialog.message();
            logger.debug(`Retrieved alert dialog message: ${message}`);
            await dialog.dismiss();
            resolve(message);
        });
    });
}

/**
 * Retrieves the current URL of the page.
 * Useful for verifying page navigation and URL structure in tests.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<string>} The current URL
 * @example
 * const currentUrl = await getUrl(page);
 * logger.debug(currentUrl); // "https://example.com/dashboard"
 */
export async function getUrl(page: Page): Promise<string> {
    const currentUrl = page.url();
    logger.debug(`Current URL: ${currentUrl}`);
    return currentUrl;
}

/**
 * Retrieves the title of the current page from the <title> tag.
 * Useful for verifying page load and title validation in tests.
 * @param {Page} page - The Playwright page object
 * @returns {Promise<string>} The page title
 * @example
 * const pageTitle = await getTitle(page);
 * logger.debug(pageTitle); // "Welcome to Example"
 */
export async function getTitle(page: Page): Promise<string> {
    const title = await page.title();
    logger.debug(`Current page title: ${title}`);
    return title;
}

/**
 * Clicks an element that opens a new tab/window and switches to it.
 * Waits for the new page to open, brings it to front, and returns it.
 * @param {Page} page - The Playwright page object (current page)
 * @param {Locator} locator - The locator of the element that opens the new tab (e.g., a link with target="_blank")
 * @returns {Promise<Page>} The new page/tab object
 * @example
 * const newTab = await switchToNewTab(page, page.locator('a[target="_blank"]'));
 * // Now you can interact with newTab
 */
export async function switchToNewTab(page: Page, locator: Locator): Promise<Page> {
    const pagePromise = page.context().waitForEvent('page');
    await locator.click();
    const newPage = await pagePromise;
    await newPage.bringToFront();
    logger.debug(`Switched to new tab: "${await getTitle(newPage)}"`);
    return newPage;
}

/**
 * Switches focus to a specific page/tab in multi-tab scenarios.
 * Brings the page to the foreground for interaction.
 * @param {Page} page - The Playwright page object to switch to
 * @returns {Promise<Page>} The same page object (now focused)
 * @example
 * await switchToPage(secondTab);
 * // Now secondTab is in focus and ready for interaction
 */
export async function switchToPage(page: Page): Promise<Page> {
    await page.bringToFront();
    logger.debug(`Switched to page: "${await getTitle(page)}"`);
    return page;
}

/**
 * Closes a page/tab.
 * Useful for cleaning up multiple tabs or switching back to main window.
 * @param {Page} page - The Playwright page object to close
 * @returns {Promise<void>}
 * @example
 * await closePage(newTab);
 */
export async function closePage(page: Page): Promise<void> {
    logger.debug(`Closing page: "${await getTitle(page)}"`);
    await page.close();
}

/**
 * Switches to an iframe by its name attribute.
 * Returns the frame object for further interactions within the iframe.
 * @param {Page} page - The Playwright page object
 * @param {string} frameName - The name attribute of the iframe to switch to
 * @returns {Promise<Frame>} The Frame object
 * @throws {Error} If no frame with that name is attached to the page
 * @example
 * const frame = await switchToFrame(page, 'payment-iframe');
 * await click(frame.locator('#submitButton'), 'Submit button');
 */
export async function switchToFrame(page: Page, frameName: string): Promise<Frame> {
    const frame = page.frame({ name: frameName });
    if (!frame) {
        throw new Error(`FRAME_NOT_FOUND:${frameName}: no frame with this name is attached to the page.`);
    }
    logger.debug(`Switched to frame: "${frame.name()}"`);
    return frame;
}

/**
 * Waits until the page's URL matches, typically after a click that navigates.
 * Resolves as soon as the URL matches; with the default `waitUntil: 'load'` it also waits for that
 * navigation's `load` event.
 * @param {Page} page - The Playwright page object
 * @param {string | RegExp} url - The exact URL, or a pattern for routes that carry generated ids
 * @param {{ timeout?: number }} [options] - Overrides the configured navigation timeout
 * @returns {Promise<void>}
 * @throws {Error} If the URL does not match before the timeout
 * @example
 * await click(viewButton, 'View button');
 * await waitForUrl(page, /\/engagement\/teams\/\d+$/, { timeout: 60_000 });
 */
export async function waitForUrl(page: Page, url: string | RegExp, options: { timeout?: number } = {}): Promise<void> {
    logger.debug(`Waiting for the URL to match: ${url}`);
    await page.waitForURL(url, { timeout: options.timeout });
}

/**
 * Starts waiting for a network response that satisfies the predicate, and returns the pending wait.
 *
 * Deliberately not awaited here: the wait has to be started **before** the action that triggers the
 * request, or a fast response can arrive before anyone is listening. Start it, perform the action,
 * then await the returned promise. It rejects on timeout like Playwright's own wait; a caller that
 * treats the response as optional handles that rejection itself.
 * @param {Page} page - The Playwright page object
 * @param {(response: Response) => boolean | Promise<boolean>} predicate - Returns true for the response to wait for
 * @param {{ timeout?: number, name?: string }} [options] - `timeout` overrides the configured one for slow server
 * work; `name` says what is awaited, so a timeout reads `RESPONSE_NOT_RECEIVED: <name>` instead of Playwright's
 * bare "waiting for event response" (the original error stays as its cause)
 * @returns {Promise<Response>} Resolves with the first matching response
 * @example
 * const created = waitForResponse(page, (response) => response.request().method() === 'POST' && response.url().endsWith('/orders'), { timeout: 90_000, name: 'the create-order POST' });
 * await click(saveButton, 'Save button');
 * const response = await created;
 */
export function waitForResponse(
    page: Page,
    predicate: (response: Response) => boolean | Promise<boolean>,
    options: { timeout?: number; name?: string } = {},
): Promise<Response> {
    logger.debug(`Waiting for ${options.name ?? 'a matching network response'}`);
    const waited = page.waitForResponse(predicate, { timeout: options.timeout });
    if (!options.name) {
        return waited;
    }
    return waited.catch((error: unknown) => {
        if (error instanceof Error && error.name === 'TimeoutError') {
            throw new Error(`RESPONSE_NOT_RECEIVED: ${options.name} did not come within ${options.timeout ?? 'the configured'} ms.`, { cause: error });
        }
        throw error;
    });
}

/**
 * Presses a key on whatever element currently has focus, through the page's keyboard.
 * For controls whose key handling is not tied to a locatable element - closing an open list with
 * Escape, for instance. When the target element is known, prefer `pressKey(locator, ...)` from the
 * element actions, which focuses it first.
 * @param {Page} page - The Playwright page object
 * @param {string} key - The key to press (e.g., 'Escape', 'Enter', 'Tab')
 * @returns {Promise<void>}
 * @example
 * await pressKeyboardKey(page, 'Escape');
 */
export async function pressKeyboardKey(page: Page, key: string): Promise<void> {
    logger.debug(`Pressing key "${key}" on the focused element`);
    await page.keyboard.press(key);
}

/**
 * Types text key by key into whatever element currently has focus, through the page's keyboard.
 * For inputs Playwright refuses to fill - one inside an element marked `aria-disabled`, for instance -
 * which have to be focused some other way first. Key-by-key typing also fires the keydown/keyup
 * events that filter-as-you-type lists listen for.
 * @param {Page} page - The Playwright page object
 * @param {string} text - The text to type
 * @returns {Promise<void>}
 * @example
 * await focus(searchBox, 'Search box');
 * await typeWithKeyboard(page, 'Egypt');
 */
export async function typeWithKeyboard(page: Page, text: string): Promise<void> {
    logger.debug(`Typing on the focused element: "${text}"`);
    await page.keyboard.type(text);
}

/**
 * Starts waiting for the page's main frame to navigate - a full load or a same-document route change
 * - and returns the pending wait.
 *
 * For an action after which the application may or may not move to another page: start the wait,
 * perform the action, then await it (typically raced against another signal). It rejects if nothing
 * navigates before the timeout, so a caller treating the navigation as optional catches that itself.
 * @param {Page} page - The Playwright page object
 * @param {{ timeout?: number }} [options] - How long to wait before rejecting
 * @returns {Promise<void>} Resolves when the main frame navigates
 * @example
 * const navigated = waitForNavigation(page, { timeout: 5_000 }).catch(() => {});
 * await click(submitButton, 'Submit button');
 * await navigated;
 */
export function waitForNavigation(page: Page, options: { timeout?: number } = {}): Promise<void> {
    logger.debug('Waiting for the page to navigate');
    return page
        .waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame(), timeout: options.timeout })
        .then(() => undefined);
}
