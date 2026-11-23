import type { Page } from '@playwright/test';
import { logger } from '../../logger/logger';

/**
 * Network conditions the application cannot be put into on demand: a slow server, an unavailable service.
 * They apply to the one page, for the requests whose URL matches `urlPattern`; nothing is sent to the real server
 * for a failed request.
 */

/**
 * Makes every matching request take `delayMs` longer to be answered; the answer itself is the real one.
 * @param {Page} page - The page whose requests are slowed down
 * @param {string | RegExp} urlPattern - Which requests, e.g. `'**\/api/news/GetPagedPortal*'`
 * @param {number} delayMs - The extra time before the request goes on to the server
 * @returns {Promise<void>}
 * @example
 * await delayResponses(page, '**\/api/news/**', 3_000);
 */
export async function delayResponses(page: Page, urlPattern: string | RegExp, delayMs: number): Promise<void> {
  logger.info(`Delaying requests matching "${String(urlPattern)}" by ${delayMs} ms`);
  await page.route(urlPattern, async (route) => {
    // A simulated slow server, not a wait for the application: the delay is the condition under test
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

/**
 * Answers every matching request with an error status and an empty body, as an unavailable service would.
 * @param {Page} page - The page whose requests fail
 * @param {string | RegExp} urlPattern - Which requests
 * @param {number} status - The HTTP status to answer with, e.g. 503
 * @returns {Promise<void>}
 * @example
 * await failResponses(page, '**\/api/news/**', 503);
 */
export async function failResponses(page: Page, urlPattern: string | RegExp, status: number): Promise<void> {
  logger.info(`Answering requests matching "${String(urlPattern)}" with status ${status}`);
  await page.route(urlPattern, (route) => route.fulfill({ status, contentType: 'application/json', body: '{}' }));
}

/**
 * Records the HTTP status of every response whose URL contains `urlPart`, from now on. The returned array grows as
 * responses arrive - read it after the action it is meant to observe.
 * @param {Page} page - The page to observe
 * @param {string} urlPart - Part of the request URL, e.g. `/api/`
 * @returns {number[]} The statuses seen so far, in order
 */
export function recordStatuses(page: Page, urlPart: string): number[] {
  const statuses: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes(urlPart)) {
      statuses.push(response.status());
    }
  });
  return statuses;
}
