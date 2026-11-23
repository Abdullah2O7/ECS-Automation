import type { Page } from '@playwright/test';
import { baseUrlOf, portals, type PortalName } from '../config/portals';
import * as browserActions from '../utils/actions/ui/browserActions';
import * as assertions from '../utils/assertions/ui/elementAssertions';
import * as waits from '../utils/waits/waits';

/** Waits for a navigated tab to show the portal or the sign-in form, and signs it in again on the form; `true` if it did. */
type SessionRecovery = (page: Page, portal: PortalName) => Promise<boolean>;

let sessionRecovery: SessionRecovery | undefined;

/**
 * Lets `visit()` sign a tab in again when its session expired mid-test. Set by LoginPage, which holds the
 * credentials - importing it here would make the two modules depend on each other.
 * @param {SessionRecovery} recover - Signs the tab in again if it landed on the sign-in form, returning whether it did
 * @returns {void}
 * @example
 * registerSessionRecovery(async (page, portal) => (await onSignInForm(page)) && (await signIn(page, portal)));
 */
export const registerSessionRecovery = (recover: SessionRecovery): void => {
  sessionRecovery = recover;
};

/**
 * Shared base for every Page Object.
 *
 * It holds the two things all of them need - the tab, and which portal that tab belongs to - and
 * nothing else. Locators and actions stay in the concrete Page Objects; this class exists so a
 * Page Object cannot accidentally navigate to the wrong portal, because `visit()` always resolves
 * against its own portal's root.
 */
export abstract class BasePage {
  protected constructor(
    protected readonly page: Page,
    readonly portal: PortalName,
  ) {}

  /** Root URL of the portal this Page Object belongs to. */
  get baseUrl(): string {
    return baseUrlOf(this.portal);
  }

  /**
   * Navigates to a path inside this portal, e.g. `visit('/orders')`. A session that expired since the
   * test started ends on the sign-in form instead, so the tab signs in again and goes back to the path.
   */
  protected async visit(routePath: string): Promise<void> {
    const url = new URL(routePath, `${this.baseUrl}/`).toString();
    await this.navigateAllowingRedirect(url);
    if (sessionRecovery && (await sessionRecovery(this.page, this.portal))) {
      await this.navigateAllowingRedirect(url);
    }
  }

  /**
   * A navigation that another one takes over is not a failure: the redirect to the sign-in form can land
   * before the portal has loaded, and an application often redirects some addresses as they open. The
   * page the redirect lands on is waited for instead.
   *
   * A navigation the server does not answer in time is tried once more, so one stalled page does not
   * fail the test case; a server that stays down still does.
   */
  protected async navigateAllowingRedirect(url: string, attempt = 1): Promise<void> {
    await browserActions.navigate(this.page, url, { waitUntil: 'domcontentloaded' }).catch(async (error: Error) => {
      if (/interrupted by another navigation|net::ERR_ABORTED/.test(error.message)) {
        await waits.waitForLoadState(this.page, 'domcontentloaded');
        return;
      }
      if (attempt === 1 && /Timeout \d+ms exceeded/.test(error.message)) {
        await this.navigateAllowingRedirect(url, 2);
        return;
      }
      throw error;
    });
  }

  /**
   * Confirms the single-page application has rendered into its root element.
   *
   * Used after navigation instead of a fixed wait: a single-page application serves an empty shell first
   * and fills it from JavaScript, so a navigation resolving says nothing about the application being up.
   * For a server-rendered application set `appRootSelector` to `body` in src/config/portals.ts.
   */
  protected async expectApplicationRendered(timeout?: number): Promise<void> {
    await assertions.assertNotEmpty(this.page.locator(portals[this.portal].appRootSelector), 'Application root', {
      message: `the ${portals[this.portal].title} application should have rendered`,
      timeout,
    });
  }
}
