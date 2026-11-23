import type { Locator, Page } from '@playwright/test';
import { BasePage, registerSessionRecovery } from './base.page';
import { definitionOf, isPortalUrl, portals, type PortalName } from '../config/portals';
import { loginTimeouts } from '../config/timeouts';
import { step } from '../utils/core/stepDecorator';
import * as actions from '../utils/actions/ui/elementActions';
import * as assertions from '../utils/assertions/ui/elementAssertions';
import * as browserActions from '../utils/actions/ui/browserActions';
import { logger } from '../utils/logger/logger';

type SessionCredentials = {
  username: string;
  password: string;
};

// Keyed by Page so a fresh LoginPage on the same shared tab can recover an expired session.
const credentialsByPage = new WeakMap<Page, SessionCredentials>();

// Pages login() has just left on the rendered portal home, so the next session start skips its navigation.
const justSignedIn = new WeakSet<Page>();

/**
 * Sign-in with a username and password form.
 *
 * ADAPT TO YOUR PROJECT: a portal whose form does not match the defaults (a username or e-mail field, a password
 * field, a Sign in / Log in button) declares its own selectors - `login` in src/config/portals.ts. An identity
 * server on another origin (IdentityServer, Keycloak, Azure AD B2C) works the same way: the portal redirects to it
 * and back. Portals that share one identity server keep separate sessions (see sessionKeyOf).
 */
export class LoginPage extends BasePage {

  //=====================Locators=====================
  private readonly usernameField: Locator;
  private readonly passwordField: Locator;
  private readonly signInButton: Locator;
  private readonly signedIn: Locator;

  //=====================Constructor==================
  constructor(page: Page, portal: PortalName) {
    super(page, portal);
    // The portal's own selectors (`login` in portals.ts), or defaults that match most forms
    const { login, signedInSelector, appRootSelector } = definitionOf(portal);
    this.usernameField = this.page.locator(login?.username ?? 'input[name="username" i], input[name="email" i], input[type="email"], #Username').first();
    this.passwordField = this.page.locator(login?.password ?? 'input[type="password"]').first();
    this.signInButton = login?.submit ? this.page.locator(login.submit).first() : this.page.getByRole('button', { name: /^(sign in|log ?in)$/i }).first();
    this.signedIn = this.page.locator(signedInSelector ?? `${appRootSelector} > *:visible`).first();
  }

  /** For a page that starts from a captured storageState, so an expired session can still sign in again. */
  static rememberCredentials(page: Page, credentials: SessionCredentials): void {
    credentialsByPage.set(page, credentials);
  }

  //=====================Actions======================
  /**
   * Signs in, once more when the first attempt fails. A failure names, for every attempt, the stage it reached and
   * its error - cleaned (failureSummary), because the raw errors can carry a sign-in callback URL with its code.
   */
  async login(username: string, password: string): Promise<void> {
    credentialsByPage.set(this.page, { username, password });

    const failures: string[] = [];
    for (let attempt = 1; attempt <= loginTimeouts.attempts; attempt += 1) {
      let stage = 'checking for the sign-in form';
      try {
        // During session recovery the tab is already on the sign-in form, so it is filled directly.
        if (!(await this.isOnSignInForm())) {
          stage = 'opening the portal';
          await browserActions.navigate(this.page, `${this.baseUrl}${portals[this.portal].homePath}`, {
            timeout: loginTimeouts.navigation,
            waitUntil: 'domcontentloaded',
          });

          stage = 'waiting for the sign-in form or the portal';
          if ((await this.waitForEntryPoint(loginTimeouts.entryPoint)) === 'portal') {
            justSignedIn.add(this.page);
            return;
          }
        }

        stage = 'filling in the sign-in form';
        // The account is known from the role in the log; its user name is personal data, so only its length is logged
        await actions.type(this.usernameField, username, 'Username', { sensitive: true });
        await actions.type(this.passwordField, password, 'Password', { sensitive: true });
        await actions.click(this.signInButton, 'Sign In button', { noWaitAfter: true });

        stage = 'waiting to be back on the rendered portal';
        await this.waitForPortal();
        justSignedIn.add(this.page);
        return;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('LOGIN_REFUSED')) {
          throw error;
        }
        failures.push(`attempt ${attempt} failed while ${stage} (${failureSummary(error)})`);
        if (attempt === loginTimeouts.attempts) {
          throw new Error(`LOGIN_DID_NOT_COMPLETE_AFTER_RETRY:${this.portal}: ${failures.join('; ')}; last page: ${pageKindOf(this.portal, this.page.url())}`);
        }
      }
    }
  }

  /**
   * Signs the tab out of whatever account it holds and in as another one, on the same page. The cookies and storage
   * of the earlier account are cleared; the trace is paused while the password is typed.
   */
  @step('Sign in as {name}')
  async switchAccount(name: string, credentials: SessionCredentials): Promise<void> {
    await this.page.context().clearCookies();
    await this.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    }).catch(() => {});
    justSignedIn.delete(this.page);
    await this.page.context().tracing.stopChunk().catch(() => {});
    try {
      await this.login(credentials.username, credentials.password);
    } finally {
      await this.page.context().tracing.startChunk().catch(() => {});
    }
    justSignedIn.delete(this.page);
  }

  /** A real navigation, so anything a previous test left open is discarded; signs in again when expired. */
  @step('Open the portal on the signed-in session')
  async startAuthenticatedSession(): Promise<void> {
    if (justSignedIn.delete(this.page)) {
      return;
    }

    // A busy server can hold DOMContentLoaded past the timeout of a page that still renders: the rendered
    // content decides, and the timeout stands only when nothing renders.
    let slowNavigation: unknown;
    await browserActions.navigate(this.page, `${this.baseUrl}${portals[this.portal].homePath}`, {
      timeout: loginTimeouts.navigation,
      waitUntil: 'domcontentloaded',
    }).catch((error: unknown) => {
      if (!(error instanceof Error && error.name === 'TimeoutError')) {
        throw error;
      }
      slowNavigation = error;
    });

    const entryPoint = await this.waitForEntryPoint(loginTimeouts.applicationBoot).catch((error: unknown) => {
      throw slowNavigation ?? error;
    });
    if (entryPoint === 'signIn' && !(await signInAgain(this.page, this.portal))) {
      throw new Error(`SESSION_NO_LONGER_AUTHENTICATED:${this.portal}`);
    }
  }

  /** Decided on rendered content, not the URL: a portal URL can show briefly before its redirect to sign in. */
  async waitForEntryPoint(timeout: number): Promise<EntryPoint> {
    // An object, because the poll assigns it from a callback that control-flow analysis cannot follow.
    const settled: { outcome: EntryPoint | 'pending' } = { outcome: 'pending' };

    await assertions
      .assertEventually(
        async () => {
          if (await this.isOnSignInForm()) {
            settled.outcome = 'signIn';
          } else if (isPortalUrl(this.portal, this.page.url()) && (await this.signedIn.isVisible().catch(() => false))) {
            settled.outcome = 'portal';
          }
          return settled.outcome;
        },
        {
          message: `expected the ${this.portal} portal to show either the sign-in form or the application`,
          timeout,
        },
      )
      .not.toBe('pending');

    return settled.outcome === 'signIn' ? 'signIn' : 'portal';
  }

  /** A failed sign-in can also land on the portal, on an error page: the signed-in marker decides. */
  private async waitForPortal(): Promise<void> {
    await assertions
      .assertEventually(() => isPortalUrl(this.portal, this.page.url()), {
        message: 'expected the sign-in round trip to return to the portal',
        timeout: loginTimeouts.callback,
      })
      .toBe(true);

    await this.failFastWhenRefused();
    await this.leaveStuckCallback();
    await this.expectApplicationRendered(loginTimeouts.applicationBoot);
    await assertions.assertVisible(this.signedIn, 'Signed-in marker', {
      message: 'the portal should show the signed-in user once the session is established',
      timeout: loginTimeouts.applicationBoot,
    });
    await assertions.assertHidden(this.passwordField, 'Password', {
      message: 'the sign-in form should be gone once the session is established',
    });
  }

  /**
   * A refused user name or password ("Oops! We couldn't log you in. Please check your credentials...") is reported at once,
   * with that reason, instead of waiting for a portal that will not come - trying again cannot help.
   */
  private async failFastWhenRefused(): Promise<void> {
    const refusal = this.page.getByText(/couldn.t log you in|check your credentials|invalid (user ?name|e-?mail|password|login)|incorrect (user ?name|e-?mail|password)|login failed/i).first();
    const until = Date.now() + loginTimeouts.callbackStall;
    while (Date.now() < until) {
      if (await this.signedIn.isVisible().catch(() => false)) {
        return;
      }
      if (await refusal.isVisible().catch(() => false)) {
        const said = ((await refusal.innerText().catch(() => '')) || 'the sign-in was refused').replace(/\s+/g, ' ').trim();
        throw new Error(`LOGIN_REFUSED:${this.portal}: the ${portals[this.portal].title} refused the account's user name or password ("${said}") - check them in .env`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500)); // the poll interval
    }
  }

  /**
   * A sign-in callback page that sits there without the application showing (portals.ts `stuckCallback`): open the
   * portal home again, which finishes the sign-in with the session cookie already set.
   */
  private async leaveStuckCallback(): Promise<void> {
    const stuckCallback = definitionOf(this.portal).stuckCallback;
    if (!stuckCallback) {
      return;
    }
    // Right after Sign In the tab is still on the sign-in page; give the round trip its normal time first.
    const shown = await this.signedIn.waitFor({ state: 'visible', timeout: loginTimeouts.callbackStall }).then(() => true, () => false);
    if (shown || !stuckCallback.test(this.page.url())) {
      return;
    }
    logger.warn(`[login] the ${this.portal} sign-in callback page is stuck after ${loginTimeouts.callbackStall / 1000} s - opening ${portals[this.portal].homePath} again`);
    await browserActions.navigate(this.page, `${this.baseUrl}${portals[this.portal].homePath}`, {
      timeout: loginTimeouts.navigation,
      waitUntil: 'domcontentloaded',
    }).catch(() => {
      // The back office redirects as it boots, which can abort this navigation; the waits after this decide.
    });
  }

  async isOnSignInForm(): Promise<boolean> {
    return (await this.passwordField.isVisible().catch(() => false)) && (await this.usernameField.isVisible().catch(() => false));
  }

  //=====================Assertions===================
  /** The tab shows a sign-in form: the sign-in page, or Umbraco's "Sign in to Umbraco" panel over the back office. */
  @step('Assert the sign-in form is shown')
  async expectSignInForm(): Promise<void> {
    const signIn = this.passwordField.or(this.page.getByRole('heading', { name: /sign in to umbraco/i })).first();
    await assertions.assertVisible(signIn, 'Sign-in form', { message: 'a visitor who is not signed in should be asked to sign in', timeout: loginTimeouts.navigation });
  }

  @step('Assert the session is not sent back to sign in')
  async assertNotOnSignInForm(): Promise<void> {
    assertions.assertToBe(await this.isOnSignInForm(), false, 'Sign-in form shown');
  }
}

type EntryPoint = 'signIn' | 'portal';

/**
 * An error as a sign-in failure reports it: its class and the first line of its message, every URL cut to its path -
 * a sign-in callback can carry a code and state in the query.
 */
const failureSummary = (error: unknown): string => {
  const name = error instanceof Error ? error.name : typeof error;
  const firstLine = (error instanceof Error ? error.message : String(error)).split('\n')[0];
  const cleaned = firstLine.replace(/https?:\/\/[^\s'"]+/g, (url) => {
    try {
      return new URL(url).pathname;
    } catch {
      // Not a URL after all - dropped rather than risk printing a token
      return '<url>';
    }
  });
  return `${name}: ${cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned}`;
};

/** Where a failed sign-in left the tab: the portal or elsewhere, with the path only. */
const pageKindOf = (portal: PortalName, url: string): string => {
  const kind = isPortalUrl(portal, url) ? `the ${portal} portal` : 'another page (the sign-in server?)';
  try {
    return `${kind} (${new URL(url).pathname})`;
  } catch {
    return kind;
  }
};

/** Signs an expired tab in again with the credentials remembered for it; `false` when there are none. */
const signInAgain = async (page: Page, portal: PortalName): Promise<boolean> => {
  const credentials = credentialsByPage.get(page);
  if (!credentials) {
    return false;
  }

  // Tracing is paused while credentials are filled, so a recovered session never records a password.
  await page.context().tracing.stopChunk().catch(() => {});
  try {
    await new LoginPage(page, portal).login(credentials.username, credentials.password);
    // Already on the portal home now; a later session start in the same test still navigates.
    justSignedIn.delete(page);
  } finally {
    await page.context().tracing.startChunk().catch(() => {});
  }
  return true;
};

// A session can also expire mid-test, which the pages meet on their next navigation.
registerSessionRecovery(async (page, portal) => {
  const loginPage = new LoginPage(page, portal);
  return (await loginPage.waitForEntryPoint(loginTimeouts.applicationBoot)) === 'signIn' && (await signInAgain(page, portal));
});
