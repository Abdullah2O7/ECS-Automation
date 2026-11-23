import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test as base, expect, type BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { cmsAccount, credentialsOf, portalOf, sessionKeyOf, type RoleName } from '../config/auth-state';
import { baseUrlOf, portals } from '../config/portals';
import { upgradeHttpToHttps } from '../utils/actions/ui/browserActions';
import { logger } from '../utils/logger/logger';
import { STOPPED_BY_USER, stopRequested } from '../utils/core/run-control';
import { SETUP_FAILED } from '../utils/core/setup-step';
import { environmentProblem, rememberEnvironmentProblem } from '../utils/runtime/run-memory';
import { repeatKnownBug } from './bug-evidence.fixture';
import { loginTimeouts } from '../config/timeouts';

/**
 * Signs each portal-account in once per worker, and gives every test Playwright's own `page`, already
 * signed in as the role it declares:
 *
 * ```ts
 * test.use({ role: 'ADMIN' });
 * ```
 *
 * Each test runs in a fresh context that Playwright creates for it, so everything configured in the
 * `use` block of playwright.config.ts applies to it as-is - the `video`, `screenshot` and `trace`
 * recorders included. What is shared is only the sign-in: the account's cookies and storage are captured
 * once (`storageState`) and every later test starts from them.
 *
 * The captured state is held in memory and never written to disk, so session cookies and tokens do not end up in the
 * repository or the test output. (It is not shared between workers or runs either: Umbraco renews a session with a
 * one-time refresh token, so two workers on one session sign each other out - "Your session has timed out".)
 * Sign-in is lazy: a run that touches one account never pays for the others, and never needs their credentials to be configured.
 */

type SessionOptions = {
  /** Which signed-in account this test's `page` belongs to. */
  role: RoleName;
};

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

type SessionAutoFixtures = {
  /** Skips the test when the dashboard's Stop button was pressed; declared first so it runs before anything signs in. */
  runStop: void;
  /** A retry of a case whose check failed repeats that result at once, before anything signs in. */
  knownBug: void;
};

type SessionWorkerFixtures = {
  /** The signed-in state of each portal-account this worker has signed in. */
  signedInStates: Map<string, StorageState>;
};

export const test = base.extend<SessionOptions & SessionAutoFixtures, SessionWorkerFixtures>({
  runStop: [
    async ({}, use, testInfo) => {
      testInfo.skip(stopRequested(), STOPPED_BY_USER);
      await use();
    },
    { auto: true },
  ],

  /** A retry of a case whose check failed repeats that result at once (see repeatKnownBug). */
  knownBug: [async ({}, use, testInfo) => {
    await repeatKnownBug(testInfo);
    await use();
  }, { auto: true }],

  role: [cmsAccount(), { option: true }],

  signedInStates: [async ({}, use) => {
    const states = new Map<string, StorageState>();
    // Verification runs one case after another (one worker) can carry the sign-in over from the previous run:
    // KEEP_SIGN_IN_FILE names a file outside the project. Never set it for parallel runs or the dashboard.
    const keptFile = process.env.KEEP_SIGN_IN_FILE;
    if (keptFile && existsSync(keptFile)) {
      for (const [key, state] of Object.entries(JSON.parse(readFileSync(keptFile, 'utf8')) as Record<string, StorageState>)) {
        states.set(key, state);
      }
    }
    await use(states);
    keepSignIn(states);
  }, { scope: 'worker' }],

  /** Playwright's own context option: the account's captured state, or none before its first sign-in. */
  storageState: async ({ role, signedInStates }, use) => {
    await use(signedInStates.get(sessionKeyOf(role)));
  },

  /**
   * Playwright's own `page`, signed in as the role the test declares. An account's first test signs in on this
   * very page and its state is captured for every later test of the account in this worker. The credentials are
   * remembered for the page, so a session the server has expired since is signed in again rather than failing.
   */
  page: async ({ page, role, signedInStates }, use) => {
    // Smooth scrolling (html { scroll-behavior: smooth }) makes Playwright's click point land on sticky headers and
    // footers while the page is still gliding: scrolling jumps instead, on every page.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = 'html, :root { scroll-behavior: auto !important; }';
      document.documentElement.append(style);
    });

    // A portal behind a proxy can redirect to its own http address (the Umbraco sign-in does); only https is reachable.
    await upgradeHttpToHttps(page, baseUrlOf(portalOf(role)));

    const credentials = credentialsOf(role);
    LoginPage.rememberCredentials(page, credentials);

    const sessionKey = sessionKeyOf(role);
    if (!signedInStates.has(sessionKey)) {
      const portal = portalOf(role);
      const title = portals[portal].title;
      // A case of this run already found the portal unusable: this one is blocked at once, with the same reason
      const known = environmentProblem(portal);
      if (known) {
        throw new Error(`${SETUP_FAILED}: could not sign in to the ${title} before the check. ${known}`);
      }
      await ensureReachable(page, portal);
      // The trace is paused while the credentials are typed and posted, so a trace kept for a failed
      // test never holds the password.
      await page.context().tracing.stopChunk().catch(() => {});
      try {
        await new LoginPage(page, portal).login(credentials.username, credentials.password);
      } catch (error) {
        const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0];
        const reason = detail.startsWith('LOGIN_REFUSED') ? detail.replace(/^LOGIN_REFUSED:\w+:\s*/, '') : `signing in did not complete in ${loginTimeouts.attempts} tries (${detail})`;
        rememberEnvironmentProblem(portal, reason);
        throw new Error(`${SETUP_FAILED}: could not sign in to the ${title} before the check. ${reason}`, { cause: error });
      } finally {
        await page.context().tracing.startChunk().catch(() => {});
      }
      const state = await page.context().storageState();
      signedInStates.set(sessionKey, state);
      keepSignIn(signedInStates);
      logger.info(`signed in ${portals[portal].title} for role: ${role}`);
    }

    await use(page);

    // The server can renew the session cookies while a test uses them, so the state is captured again at the end.
    const latest = await page.context().storageState().catch(() => undefined);
    if (latest) {
      signedInStates.set(sessionKey, latest);
      keepSignIn(signedInStates);
    }
  },
});

/** Writes the sign-ins to KEEP_SIGN_IN_FILE when it is set (see signedInStates). */
const keepSignIn = (states: Map<string, StorageState>): void => {
  const keptFile = process.env.KEEP_SIGN_IN_FILE;
  if (keptFile) {
    writeFileSync(keptFile, JSON.stringify(Object.fromEntries(states)), { mode: 0o600 });
  }
};

/** How long the portal may take to answer at all, and how many times it is asked, before the run is blocked. */
const REACH_TIMEOUT = 20_000;
const REACH_TRIES = 3;

/**
 * Asks the portal for its home page before signing in: a portal that does not answer (VPN off, network down, server down)
 * blocks the case within a minute, with that reason, instead of every sign-in step waiting out its own timeout. The
 * reason is remembered, so the rest of the run is blocked at once.
 */
const ensureReachable = async (page: import('@playwright/test').Page, portal: ReturnType<typeof portalOf>): Promise<void> => {
  const address = `${baseUrlOf(portal)}${portals[portal].homePath}`;
  const failures: string[] = [];
  for (let attempt = 1; attempt <= REACH_TRIES; attempt += 1) {
    try {
      const response = await page.request.get(address, { timeout: REACH_TIMEOUT, maxRedirects: 0, failOnStatusCode: false });
      if (response.status() < 500) {
        return;
      }
      failures.push(`HTTP ${response.status()}`);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).split('\n')[0].replace(/https?:\/\/\S+/g, '<address>').replace(/^apiRequestContext\.get:\s*/, '');
      failures.push(/Timeout \d+ms exceeded/.test(detail) ? `no answer within ${REACH_TIMEOUT / 1000} s` : detail);
    }
    if (attempt < REACH_TRIES) {
      logger.warn(`[session] ${portals[portal].title} did not answer (try ${attempt} of ${REACH_TRIES}), trying again`);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  const reason = `the ${portals[portal].title} (${new URL(address).host}) did not answer in ${REACH_TRIES} tries (${[...new Set(failures)].join('; ')}) - check the VPN and the network`;
  rememberEnvironmentProblem(portal, reason);
  throw new Error(`${SETUP_FAILED}: could not reach the ${portals[portal].title} before the check. ${reason}`);
};

export { expect };
