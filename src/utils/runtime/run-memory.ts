import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What one run has learned so far, shared by all its workers: Playwright starts a new worker after every failed test, so
 * memory in a worker does not last - this is kept in files under test-output/run-state/<run id> (the run id is fixed by
 * playwright.config.ts for the main process and inherited by its workers).
 *
 *  - an environment problem (the back office does not answer, signing in fails): once one case found it after its tries,
 *    every later case of the run is blocked at once with the same reason, instead of waiting minutes to find it again.
 *  - how a case's last try ended: a retry of a case whose check failed (a bug) repeats that result at once - a bug is not a
 *    flake, so it is not run three times.
 */
const ROOT = path.resolve('test-output', 'run-state');
const runFolder = (): string => path.join(ROOT, process.env.PW_RUN_ID ?? 'local');

const read = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

const write = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
};

const safe = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, '_');

/** Notes that a portal cannot be used in this run, and why. */
export const rememberEnvironmentProblem = (portal: string, reason: string): void => write(path.join(runFolder(), `environment-${safe(portal)}.json`), { reason });

/** Why the portal cannot be used in this run, when a case already found out. */
export const environmentProblem = (portal: string): string | undefined => read<{ reason: string }>(path.join(runFolder(), `environment-${safe(portal)}.json`))?.reason;

export type TryResult = { kind: 'bug' | 'blocked'; message: string; evidence?: string };

/** Notes how a case's try failed. */
export const rememberTry = (testId: string, result: TryResult): void => write(path.join(runFolder(), 'tries', `${safe(testId)}.json`), result);

/** How the case's previous try failed, if it did. */
export const previousTry = (testId: string): TryResult | undefined => read<TryResult>(path.join(runFolder(), 'tries', `${safe(testId)}.json`));

/** Removes what runs older than a day left (called by the main process when a run starts). */
export const forgetOldRuns = (now: number = Date.now()): void => {
  if (!existsSync(ROOT)) {
    return;
  }
  for (const name of readdirSync(ROOT)) {
    const folder = path.join(ROOT, name);
    try {
      if (now - statSync(folder).mtimeMs > 24 * 3_600_000) {
        rmSync(folder, { recursive: true, force: true });
      }
    } catch {
      // another process removed it, or it is in use: left for the next run
    }
  }
};

/**
 * Runs `step` while no other case of this run holds the same lock - for steps that change something every case shares
 * (the display order of the categories: two cases sorting at once would overwrite each other's order). A lock older than
 * `staleMs` is taken over (its case ended without releasing it).
 */
export const withRunLock = async <T>(name: string, step: () => Promise<T>, { waitMs = 300_000, staleMs = 300_000 } = {}): Promise<T> => {
  const lock = path.join(runFolder(), 'locks', safe(name));
  mkdirSync(path.dirname(lock), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      const age = (() => {
        try {
          return Date.now() - statSync(lock).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (age > staleMs) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > until) {
        throw new Error(`RUN_LOCK_TIMEOUT: waited ${waitMs / 1000} s for another case to finish "${name}"`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  try {
    return await step();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
};
