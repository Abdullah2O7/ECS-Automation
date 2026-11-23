/** Default ceiling for a single Playwright action (click, fill, ...). */
export const actionTimeout = 15_000;

/** Default ceiling for a single `expect(locator)` assertion. */
export const expectTimeout = 10_000;

/** Default ceiling for a navigation that does not pass its own timeout. */
export const navigationTimeout = 60_000;

export const loginTimeouts = {
  /**
   * `page.goto(portal)` at the start of an attempt (passed explicitly, so it overrides navigationTimeout). The back office
   * loads a few hundred script files before it shows the sign-in form; when the server is slow (~0.8 s a file) that alone
   * takes 25-45 s.
   */
  navigation: 60_000,
  /** Waiting for either the sign-in form or an already-authenticated portal to appear. */
  entryPoint: 45_000,
  /** Actions performed per attempt: fill username, fill password, click Sign In. */
  actionsPerAttempt: 3,
  /** Waiting for the sign-in round trip to land back inside the portal. */
  callback: 45_000,
  /** Waiting for the single-page application to render after the callback. */
  applicationBoot: 40_000,
  /** How long the sign-in callback page may sit without the application showing before it counts as stuck (portals.ts `stuckCallback`). Normally ~8 s. */
  callbackStall: 20_000,
  /** Sign-in attempts before the login fails with LOGIN_DID_NOT_COMPLETE_AFTER_RETRY. */
  attempts: 2,
} as const;

/**
 * Worst case cost of one sign-in attempt: navigation + entry point + the three login actions +
 * callback + application boot. 60s + 45s + 3x15s + 45s + 40s = 235s.
 */
const loginAttemptBudget =
  loginTimeouts.navigation +
  loginTimeouts.entryPoint +
  loginTimeouts.actionsPerAttempt * actionTimeout +
  loginTimeouts.callback +
  loginTimeouts.applicationBoot;

/** Worst case cost of signing in including the retry: 2 x 235s = 470s. (A portal that does not answer at all is found within a minute, see session.ts.) */
const loginTimeBudget = loginTimeouts.attempts * loginAttemptBudget;

/**
 * Time left for the test body after signing in.
 *
 * Only the first test on each account pays the sign-in cost - the session fixture keeps that session
 * for the rest of the worker - so for every other test this whole budget is headroom.
 */
const testStepsBudget = 300_000;

/** Per-test timeout: two worst-case sign-in attempts plus the longest test body: 470s + 300s = 770s. */
export const testTimeout = loginTimeBudget + testStepsBudget;

/**
 * The back office (Umbraco) is slow, and slower still when several cases use it at once: a page can take a minute to render
 * and a save or publish half a minute to be answered. These waits are for the application, not for the test: a case that
 * passes is not slowed by them.
 */
export const backOfficeTimeouts = {
  /** A screen (list, editor, form) until it has rendered its content. */
  pageLoad: 90_000,
  /** The server's answer to a save, publish, unpublish, trash, restore or delete. */
  serverAnswer: 60_000,
  /** A message (pop-up or the one under a field) after the server answered. */
  message: 30_000,
  /** A list or the content tree showing a change the server has made. */
  listRefresh: 45_000,
  /** The public portal showing (or no longer showing) a published article. */
  portal: 90_000,
} as const;
