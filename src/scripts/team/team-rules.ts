/**
 * The safety rules of sharing work through GitHub, kept apart from git itself so they can be tested on their own:
 * which changed files a share may never send, and whether the changes hold a password or user name from .env.
 */

/** Files that must never go to GitHub, whatever .gitignore says: the .env with the accounts, and private keys. */
const FORBIDDEN = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.(pem|key|pfx|p12)$/i, /(^|\/)id_(rsa|ecdsa|ed25519)(\.pub)?$/];

/** The changed files a share refuses to send. */
export const forbiddenFiles = (paths: readonly string[]): string[] => paths.filter((file) => FORBIDDEN.some((rule) => rule.test(file)));

/** The .env values that must never appear in what is shared: accounts, passwords, tokens and keys (6 characters or more). */
export const secretValues = (env: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([name, value]) => /(USERNAME|USER|PASSWORD|TOKEN|SECRET|API_KEY)$/.test(name) && value.trim().length >= 6).map(([name, value]) => [name, value.trim()]));

/** The names of the .env values that appear in a text (a diff about to be shared). Never the values themselves. */
export const secretsIn = (text: string, secrets: Record<string, string>): string[] =>
  Object.entries(secrets).filter(([, value]) => text.includes(value)).map(([name]) => name);

/**
 * The changed files in `git status --porcelain=v1 -z` output: one entry per file, its new name when renamed. Entries are
 * separated by NUL; a rename or copy (R or C in either column) is followed by an entry with its old name.
 */
export const changedFiles = (porcelain: string): string[] => {
  const entries = porcelain.split('\0');
  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) {
      continue;
    }
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      i += 1;
    }
  }
  return files;
};

/** `git rev-list --left-right --count HEAD...origin/main`: commits only here (ahead) and only on GitHub (behind). */
export const aheadBehind = (output: string): { ahead: number; behind: number } => {
  const [ahead, behind] = output.trim().split(/\s+/).map(Number);
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
};

/** The files git names after "would be overwritten by merge:" (each on its own line, indented). */
export const filesInGitMessage = (message: string): string[] =>
  message.split(/\r?\n/).filter((line) => /^\s+\S/.test(line) && !/^\s*(Please|Aborting|hint:)/.test(line)).map((line) => line.trim());

/** A share's message: what the person wrote, one line, at most 120 characters; a plain default when empty. */
export const shareMessage = (text: string | undefined, files: readonly string[]): string => {
  const line = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return line || `Update ${files.length} file${files.length === 1 ? '' : 's'}`;
};
