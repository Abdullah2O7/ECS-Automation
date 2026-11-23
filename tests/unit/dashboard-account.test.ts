import { expect, test } from '@playwright/test';
import { accountIn } from '../../src/scripts/dashboard/account';

test.describe("The dashboard's back-office account", () => {
  test('is the user name of the account the runs sign in with - never the password', () => {
    const env = { CMS_CONTENT_USERNAME: ' sara@club.test ', CMS_CONTENT_PASSWORD: 'secret', CMS_SECOND_USERNAME: 'claude@club.test' };
    expect(accountIn(env)).toBe('sara@club.test');
    expect(accountIn({ ...env, CMS_ACCOUNT: 'CMS_SECOND' })).toBe('claude@club.test');
    expect(JSON.stringify(accountIn(env))).not.toContain('secret');
  });

  test('is missing when .env has no account, or names a role that is not one', () => {
    expect(accountIn({})).toBeUndefined();
    expect(accountIn({ CMS_CONTENT_USERNAME: '  ' })).toBeUndefined();
    expect(accountIn({ CMS_ACCOUNT: 'x; rm', CMS_CONTENT_USERNAME: 'a' })).toBeUndefined();
  });
});
