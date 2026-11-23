import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { storyProblems } from '../story/story-readiness.ts';
import { aheadBehind, changedFiles, filesInGitMessage, forbiddenFiles, secretsIn, secretValues, shareMessage } from './team-rules.ts';

/**
 * Working as a team through GitHub, for people who do not use git themselves: the dashboard's "Get latest" and
 * "Share my work" (and `npm run team:setup`) call these. The shared copy is the `main` branch on GitHub (`origin`).
 * Everyone shares their own work; nothing is ever forced: a share that clashes with a teammate's work stops and keeps
 * the work safe on this computer.
 */

const REMOTE = 'origin';
const MAIN = 'main';
const UPSTREAM = `${REMOTE}/${MAIN}`;

export type GitResult = { code: number; out: string; err: string };

/**
 * Runs git in the project folder. From the dashboard it never asks in a terminal (there is none to answer): a sign-in
 * GitHub needs opens Git's own window. `npm run team:setup` runs in a terminal and lets git ask there too.
 */
export const git = (cwd: string, args: readonly string[]): Promise<GitResult> =>
  new Promise((resolve) => {
    const prompts = process.env.TEAM_GIT_INTERACTIVE === '1' ? {} : { GIT_TERMINAL_PROMPT: '0' };
    const child = spawn('git', args, { cwd, env: { ...process.env, ...prompts, LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', (error) => resolve({ code: -1, out, err: `GIT_NOT_FOUND: ${error.message} - install Git for Windows (git-scm.com)` }));
    child.on('close', (code) => resolve({ code: code ?? -1, out, err }));
  });

/** A git step that must work: its output, or an error with what git said. */
const must = async (cwd: string, args: readonly string[], what: string): Promise<string> => {
  const result = await git(cwd, args);
  if (result.code !== 0) {
    throw new TeamError(`${what}: ${(result.err || result.out).trim().split('\n').slice(-3).join(' ')}`);
  }
  return result.out;
};

/** A problem the person can act on, said in plain words (shown on the dashboard as it is). */
export class TeamError extends Error {
  /** The files the problem is about, when there are some. */
  readonly files: string[];

  constructor(message: string, files: string[] = []) {
    super(message);
    this.files = files;
  }
}

export type TeamStatus = {
  /** The folder is a git copy of the shared project on GitHub. */
  connected: boolean;
  /** Commits made here that GitHub does not have yet. */
  ahead: number;
  /** Changes on GitHub this copy does not have yet: "Get latest". */
  behind: number;
  /** Files changed here and not shared yet. */
  changes: string[];
  /** The name the person's shares carry; missing until it is set. */
  author?: string;
  /** Why the team status could not be read fully (offline, not connected...). */
  problem?: string;
  checkedAt: number;
};

/** Where this copy stands against GitHub; `fetch` first asks GitHub what is new (needs the network). */
export const teamStatus = async (cwd: string, fetch = false): Promise<TeamStatus> => {
  const checkedAt = Date.now();
  const empty = { ahead: 0, behind: 0, changes: [], checkedAt };
  if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])).code !== 0) {
    return { connected: false, ...empty, problem: 'This folder is not connected to GitHub yet (npm run team:setup).' };
  }
  if ((await git(cwd, ['remote', 'get-url', REMOTE])).code !== 0) {
    return { connected: false, ...empty, problem: 'This folder has no GitHub address yet (npm run team:setup).' };
  }
  let problem: string | undefined;
  if (fetch) {
    const fetched = await git(cwd, ['fetch', '--quiet', REMOTE]);
    if (fetched.code !== 0) {
      problem = "GitHub could not be reached - check the internet connection. What you see may not be the latest.";
    }
  }
  if (existsSync(path.join(cwd, '.git', 'rebase-merge')) || existsSync(path.join(cwd, '.git', 'rebase-apply')) || existsSync(path.join(cwd, '.git', 'MERGE_HEAD'))) {
    problem = 'A combine of your work with the team\'s was left half-way - ask Claude to finish it.';
  }
  const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const hasUpstream = (await git(cwd, ['rev-parse', '--verify', '--quiet', UPSTREAM])).code === 0;
  const hasHead = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0;
  const counts = hasUpstream && hasHead ? aheadBehind((await git(cwd, ['rev-list', '--left-right', '--count', `HEAD...${UPSTREAM}`])).out) : { ahead: hasHead ? 1 : 0, behind: 0 };
  const author = (await git(cwd, ['config', 'user.name'])).out.trim() || undefined;
  return { connected: true, ...counts, changes: changedFiles(status.out), ...(author ? { author } : {}), ...(problem ? { problem } : {}), checkedAt };
};

export type LatestResult = { files: string[]; dashboardChanged: boolean; packagesChanged: boolean };

/**
 * "Get latest": takes the team's new changes from GitHub. Only ever moves forward - it never changes or drops work
 * done here. When work made here is waiting to be shared, or the team changed the same files as unshared changes here,
 * it stops and says what to do.
 */
export const getLatest = async (cwd: string): Promise<LatestResult> => {
  const status = await teamStatus(cwd, true);
  if (!status.connected) {
    throw new TeamError(status.problem ?? 'Not connected to GitHub.');
  }
  if (status.problem) {
    throw new TeamError(status.problem);
  }
  if (status.behind === 0) {
    return { files: [], dashboardChanged: false, packagesChanged: false };
  }
  if (status.ahead > 0) {
    throw new TeamError('You have saved work that is not on GitHub yet. Press "Share my work" - it gets the team\'s changes at the same time.');
  }
  const before = (await must(cwd, ['rev-parse', 'HEAD'], 'Could not read this copy')).trim();
  const merged = await git(cwd, ['merge', '--ff-only', '--quiet', UPSTREAM]);
  if (merged.code !== 0) {
    const files = filesInGitMessage(merged.err);
    throw new TeamError(
      files.length
        ? 'Your unshared changes are in files the team changed too. Press "Share my work" (it combines them), or ask Claude.'
        : `Could not take the team's changes: ${merged.err.trim().split('\n')[0]}`,
      files,
    );
  }
  const files = (await must(cwd, ['diff', '--name-only', before, 'HEAD'], 'Could not list the new changes')).split('\n').filter(Boolean);
  return { files, dashboardChanged: files.some((file) => file.startsWith('src/scripts/dashboard/')), packagesChanged: files.includes('package-lock.json') };
};

export type Check = { name: string; args: string[] };

/** What must pass before work is shared: the same checks GitHub runs (.github/workflows/checks.yml). */
const CHECKS: readonly Check[] = [
  { name: 'Type check', args: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { name: 'Scripts run in Node', args: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json'] },
  { name: 'Lint', args: ['node_modules/eslint/bin/eslint.js', '.'] },
  { name: 'Unit tests', args: ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.unit.config.ts', '--reporter=line'] },
  { name: 'Every test is found', args: ['node_modules/@playwright/test/cli.js', 'test', '--list', '--reporter=line', '--pass-with-no-tests'] },
];

const runCheck = (cwd: string, check: Check): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, check.args, { cwd, env: { ...process.env, FORCE_COLOR: '0', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', (error) => resolve({ ok: false, output: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });

/** The .env values that must never be shared (read fresh: a changed .env counts at once). */
const secretsOf = (cwd: string): Record<string, string> => {
  const file = path.join(cwd, '.env');
  return existsSync(file) ? secretValues(dotenv.parse(readFileSync(file))) : {};
};

export type ShareResult = { files: string[]; commits: number };

/**
 * "Share my work": checks the code, saves the changes made here as one commit, puts it on top of the team's latest
 * work and sends it to GitHub. Stops - with the work kept safe here - when a check fails, when something private would
 * be sent, or when the work changes the same lines as a teammate's.
 */
export const shareWork = async (cwd: string, text: string | undefined, step: (what: string) => void = () => {}): Promise<ShareResult> => {
  step('Looking at your changes');
  const status = await teamStatus(cwd, true);
  if (!status.connected) {
    throw new TeamError(status.problem ?? 'Not connected to GitHub.');
  }
  if (status.problem && !status.problem.startsWith('GitHub could not be reached')) {
    throw new TeamError(status.problem);
  }
  if (status.changes.length === 0 && status.ahead === 0) {
    throw new TeamError('There is nothing to share: no changes since your last share.');
  }
  if (!status.author || !(await git(cwd, ['config', 'user.email'])).out.trim()) {
    throw new TeamError('NO_AUTHOR: say your name and e-mail once, so your teammates see who shared what.');
  }
  const forbidden = forbiddenFiles(status.changes);
  if (forbidden.length) {
    throw new TeamError('These files are private and are never shared - nothing was sent:', forbidden);
  }

  // A new sheet goes with its tests (npm run story:new), so the story is on everyone's dashboard; its cases may wait to be built
  step('Checking: every sheet has its tests');
  const unfinished = storyProblems(cwd);
  if (unfinished.length) {
    throw new TeamError(`Nothing was shared:\n${unfinished.join('\n')}`);
  }
  for (const check of CHECKS) {
    step(`Checking: ${check.name.toLowerCase()}`);
    const result = await runCheck(cwd, check);
    if (!result.ok) {
      const tail = result.output.trim().split('\n').filter((line) => line.trim()).slice(-6).join('\n');
      throw new TeamError(`"${check.name}" failed, so nothing was shared. Ask Claude to fix it:\n${tail}`);
    }
  }

  const files = status.changes;
  if (files.length) {
    step('Saving your work');
    await must(cwd, ['add', '--all'], 'Could not save your work');
    const staged = await git(cwd, ['diff', '--cached', '--no-color', '--text']);
    const leaked = secretsIn(staged.out, secretsOf(cwd));
    if (leaked.length) {
      await git(cwd, ['reset', '--quiet']);
      throw new TeamError(`Your changes contain a value from your .env (${leaked.join(', ')}) - nothing was sent. Ask Claude to remove it.`);
    }
    await must(cwd, ['commit', '--quiet', '-m', shareMessage(text, files)], 'Could not save your work');
  }

  // GitHub may get a teammate's share while this one is on its way: then the team's work is taken again, once
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    step("Combining with your teammates' work");
    await must(cwd, ['fetch', '--quiet', REMOTE], 'GitHub could not be reached - your work is saved here; share again when online');
    if ((await git(cwd, ['rev-parse', '--verify', '--quiet', UPSTREAM])).code === 0) {
      const rebased = await git(cwd, ['rebase', '--quiet', UPSTREAM]);
      if (rebased.code !== 0) {
        const clashing = (await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).out.split('\n').filter(Boolean);
        await git(cwd, ['rebase', '--abort']);
        throw new TeamError(
          'Your work is saved on this computer - nothing was lost - but it changes the same lines as a teammate\'s work. Ask Claude to combine them, then share again:',
          clashing,
        );
      }
    }
    step('Sending to GitHub');
    const pushed = await git(cwd, ['push', '--quiet', REMOTE, `HEAD:${MAIN}`]);
    if (pushed.code === 0) {
      const after = await teamStatus(cwd, false);
      return { files, commits: Math.max(1, status.ahead + (files.length ? 1 : 0) - after.ahead) };
    }
    if (!/rejected|fetch first|non-fast-forward/i.test(pushed.err) || attempt === 2) {
      throw new TeamError(`GitHub did not take your work (it is saved here): ${pushed.err.trim().split('\n').slice(-2).join(' ')}`);
    }
  }
  throw new TeamError('GitHub did not take your work (it is saved here). Try again.');
};

/** Sets the name and e-mail the person's shares carry, for this project only. */
export const setAuthor = async (cwd: string, name: string, email: string): Promise<void> => {
  const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  const cleanEmail = email.trim().slice(0, 120);
  if (!cleanName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new TeamError('Give your name and a valid e-mail address.');
  }
  await must(cwd, ['config', 'user.name', cleanName], 'Could not save your name');
  await must(cwd, ['config', 'user.email', cleanEmail], 'Could not save your e-mail');
};

/** Files GitHub can put in a new repository when it is created (README, licence, ignore list): not a project yet. */
const STARTER_FILE = /^(README(\.\w+)?|LICENSE(\.\w+)?|\.gitignore|\.gitattributes)$/i;

/**
 * Connects a project folder to the team's repository on GitHub, for its first upload (npm run team:setup). The
 * repository must be new: empty, or holding only the files GitHub offers to create with it (a README, a licence, a
 * .gitignore) - the project then goes on top of those, its own README and .gitignore replacing them. A repository that
 * already holds a project is refused: that project is copied instead (git clone), never mixed with this folder.
 * Returns the starter files GitHub had made.
 */
export const connectFolder = async (cwd: string, url: string): Promise<{ starterFiles: string[] }> => {
  const heads = await git(cwd, ['ls-remote', '--heads', url]);
  if (heads.code !== 0) {
    throw new TeamError(`GitHub did not answer for that address - check it, that you can open it in the browser, and sign in when Git asks.\n${heads.err.trim()}`);
  }
  const created = !existsSync(path.join(cwd, '.git'));
  if (created) {
    await must(cwd, ['init', '--quiet', '-b', MAIN], 'Could not start');
  }
  const current = await git(cwd, ['remote', 'get-url', REMOTE]);
  await must(cwd, current.code === 0 ? ['remote', 'set-url', REMOTE, url] : ['remote', 'add', REMOTE, url], 'Could not save the GitHub address');
  if (!heads.out.trim()) {
    await must(cwd, ['checkout', '--quiet', '-B', MAIN], 'Could not start');
    return { starterFiles: [] };
  }

  const refuse = (message: string): never => {
    if (created) {
      // Leave the folder as it was: not connected
      rmSync(path.join(cwd, '.git'), { recursive: true, force: true });
    }
    throw new TeamError(message);
  };
  if (!/\srefs\/heads\/main$/m.test(heads.out)) {
    refuse('That repository already has work, but no "main" branch - ask Claude to look at it.');
  }
  await must(cwd, ['fetch', '--quiet', REMOTE, MAIN], 'Could not read the repository');
  const files = (await must(cwd, ['ls-tree', '-r', '--name-only', UPSTREAM], 'Could not read the repository')).split('\n').filter(Boolean);
  if (files.some((file) => !STARTER_FILE.test(file))) {
    refuse('That repository already holds the project (or other work): copy it instead of uploading this folder - README, "Working as a team".');
  }
  // On top of GitHub's first commit: this folder's files stay as they are; a starter file this folder does not have (a licence) is kept
  await must(cwd, ['reset', '--quiet', UPSTREAM], 'Could not start from the repository');
  for (const file of files.filter((name) => !existsSync(path.join(cwd, name)))) {
    await must(cwd, ['checkout', '--quiet', '--', file], 'Could not keep a starter file');
  }
  return { starterFiles: files };
};
