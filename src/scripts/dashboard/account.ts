import { existsSync, readFileSync, statSync } from 'node:fs';
import dotenv from 'dotenv';

/**
 * The back-office account this computer's runs sign in with, read from its own .env: each person on the team has their
 * own account there, so their runs never sign another person out (the back office keeps one session per account).
 * Only the user name is read out - never the password.
 */

const ROLE_NAME = /^[A-Z][A-Z0-9_]*$/;

/** The user name of the account a run signs in with: <CMS_ACCOUNT, default CMS_CONTENT>_USERNAME; undefined when not set. */
export const accountIn = (values: Record<string, string | undefined>): string | undefined => {
  const role = values.CMS_ACCOUNT?.trim() || 'CMS_CONTENT';
  return ROLE_NAME.test(role) ? values[`${role}_USERNAME`]?.trim() || undefined : undefined;
};

let cached: { file: string; at: number; account: string | undefined } | undefined;

/** The account of the .env file (re-read when the file changes); what the dashboard's own environment sets wins. */
export const backOfficeAccount = (file = '.env'): string | undefined => {
  const at = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (!cached || cached.file !== file || cached.at !== at) {
    const values = at ? dotenv.parse(readFileSync(file)) : {};
    cached = { file, at, account: accountIn({ ...values, ...process.env }) };
  }
  return cached.account;
};
