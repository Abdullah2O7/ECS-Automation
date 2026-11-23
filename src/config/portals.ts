/**
 * The applications ("portals") the suite drives - one entry per web application of the project under test: one for
 * a single-site project, several for, say, an admin back office and a customer site.
 *
 * ADAPT TO YOUR PROJECT: add, rename or remove entries below. Everything that differs per portal is declared here,
 * so a test never hard-codes a URL. A portal whose base URL is not set in `.env` is simply not in use: nothing signs
 * in to it - so a project can declare a portal before it has an environment.
 */

type PortalDefinition = {
  /** Human name used in logs and failure messages. */
  title: string;
  /** Environment variable holding the portal root, e.g. `https://<host>:<port>`. */
  baseUrlVariable: string;
  /** Route a signed-in session is sent to at the start of every test. */
  homePath: string;
  /**
   * The element the application renders itself into: `#root` (React), `app-root` (Angular), `#app` (Vue), or
   * `body` for a server-rendered site. Once sign-in returns to the portal, this element having content is what
   * proves the application actually booted, rather than the browser landing on an error page.
   */
  appRootSelector: string;
  /**
   * An element only a signed-in user sees - the user menu or a Logout button, e.g. `[data-testid="user-menu"]`.
   * It tells "signed in" from "still on the sign-in page" when both are on the same origin; without it the
   * application root is used, which is enough only when the sign-in form is on another origin.
   */
  signedInSelector?: string;
  /** The portal's sign-in form, when its fields differ from the defaults in src/pages/login.page.ts. */
  login?: LoginSelectors;
  /**
   * The sign-in callback page, when it can get stuck. If the tab is still on it after `loginTimeouts.callbackStall`
   * without the application showing, sign-in opens `homePath` again: the session cookie is already set, so that
   * finishes the sign-in. (Normally the callback is faster - it carries the one-time code - so this is only a fallback.)
   */
  stuckCallback?: RegExp;
};

/** CSS selectors of a sign-in form; any one left out keeps its default. */
export type LoginSelectors = {
  username?: string;
  password?: string;
  submit?: string;
};

export const portals = {
  // The public website (guests, no sign-in): news, partners catalog, quick payment.
  portal: {
    title: 'Public portal',
    baseUrlVariable: 'PORTAL_BASE_URL',
    homePath: '/',
    appRootSelector: 'body',
  },
  // The Umbraco back office (needs the VPN). /umbraco/ sends a guest to its own sign-in page (/umbraco/login) and back.
  cms: {
    title: 'CMS',
    baseUrlVariable: 'CMS_BASE_URL',
    homePath: '/umbraco/',
    appRootSelector: 'body',
    // Only the signed-in back office renders its header; the sign-in page lives in the same <body>.
    signedInSelector: 'umb-backoffice-header',
    login: {
      username: '#username-input',
      password: '#password-input',
      submit: '#umb-login-button',
    },
    // Umbraco's /umbraco/oauth_complete?code=... page sometimes hangs; opening /umbraco/ again then signs in.
    stuckCallback: /\/umbraco\/oauth_complete/i,
  },
} as const satisfies Record<string, PortalDefinition>;

export type PortalName = keyof typeof portals;

/** A portal's definition, with the optional fields typed as optional. */
export const definitionOf = (portal: PortalName): PortalDefinition => portals[portal];

/** Root URL of a portal, e.g. `https://<host>:<port>`, without its trailing slashes. */
export const baseUrlOf = (portal: PortalName): string => {
  const variable = portals[portal].baseUrlVariable;
  const value = process.env[variable]?.trim();
  if (!value) {
    throw new Error(`MISSING_ENVIRONMENT_CONFIGURATION:${variable}: the ${portals[portal].title} is used but has no base URL in .env.`);
  }
  return value.replace(/\/+$/, '');
};

const hasOrigin = (url: string, expected: string): boolean => {
  try {
    return new URL(url).origin === new URL(expected).origin;
  } catch {
    return false;
  }
};

/**
 * True when the browser is inside the given portal. A full origin check, so portals on the same host that differ
 * only by port are told apart.
 */
export const isPortalUrl = (portal: PortalName, url: string): boolean => hasOrigin(url, baseUrlOf(portal));
