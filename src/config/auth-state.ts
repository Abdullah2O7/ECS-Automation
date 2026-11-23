import { requiredEnv } from '../utils/core/env';
import type { PortalName } from './portals';

/**
 * Every role the suite can sign in as, and the portal it belongs to.
 *
 * Credentials are never hard-coded: each role reads `<ROLE>_USERNAME` / `<ROLE>_PASSWORD` from the
 * environment. Adding a role is one line here plus the two variables in `.env`. Rename the examples to the
 * accounts of your project - the name is only a lookup key, nothing else depends on it.
 */
const rolePortals = {
  // CMS accounts, one per permission level in the user stories. Only the public portal has no role: it needs no sign-in.
  CMS_CONTENT: 'cms',
  // A second back-office account: Claude's own verification runs sign in with it (CMS_ACCOUNT=CMS_SECOND), so they never
  // sign the dashboard's runs out - the back office keeps one session per account.
  CMS_SECOND: 'cms',
} as const satisfies Record<string, PortalName>;

export type RoleName = keyof typeof rolePortals;

export const portalOf = (role: RoleName): PortalName => rolePortals[role];

const isRole = (name: string): name is RoleName => Object.hasOwn(rolePortals, name);

/**
 * The account the back-office tests sign in with: CMS_CONTENT, unless CMS_ACCOUNT names another role (CMS_ACCOUNT=CMS_SECOND
 * for a run that must not share the dashboard's account). A name that is not a role stops the run at once.
 */
export const cmsAccount = (): RoleName => {
  const chosen = process.env.CMS_ACCOUNT?.trim();
  if (!chosen) {
    return 'CMS_CONTENT';
  }
  if (!isRole(chosen)) {
    throw new Error(`INVALID_ENVIRONMENT_VARIABLE:CMS_ACCOUNT: "${chosen}" is not a role (${Object.keys(rolePortals).join(', ')})`);
  }
  return chosen;
};

export type Credentials = {
  username: string;
  password: string;
};

/**
 * Credentials for a role.
 *
 * Resolved **on demand** rather than up front, so a run that uses one role does not require every
 * other role - or every other portal - to be configured.
 */
export const credentialsOf = (role: RoleName): Credentials => ({
  username: requiredEnv(`${role}_USERNAME`),
  password: requiredEnv(`${role}_PASSWORD`),
});

/**
 * Key identifying the browser session a role runs in: the portal and the account. Cookies are scoped to a host,
 * not a port, so two portals on one host would overwrite each other's session if they shared a context - one per
 * portal-account keeps them apart, and roles that share an account on the same portal share one sign-in.
 */
export const sessionKeyOf = (role: RoleName): string => {
  const { username } = credentialsOf(role);
  return `${portalOf(role)}\u0000${username}`;
};
