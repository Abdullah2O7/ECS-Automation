import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Runs before the dashboard starts (`predashboard` in package.json): takes the tests and changes the team shared on
 * GitHub, so nobody runs an old copy by forgetting "Get latest". It runs before the dashboard, so a new version of the
 * dashboard itself is used straight away. It only ever moves forward (see getLatest): when work here is waiting to be
 * shared, or GitHub cannot be reached, it says so and the dashboard starts with what is on this computer. It never
 * stops the dashboard from starting.
 */

const cwd = process.cwd();
const GITHUB_WAIT = 45_000;
const say = (text: string) => console.log(`[team] ${text}`);

/** The project's packages (npm ci): without them neither this nor the dashboard can start. */
const PACKAGES = ['dotenv', '@playwright/test'];

const main = async (): Promise<void> => {
  const missing = PACKAGES.filter((name) => !existsSync(path.join(cwd, 'node_modules', name, 'package.json')));
  if (missing.length) {
    say("The project's packages are not installed (or the install did not finish).");
    say('Run   npm ci   in this folder - it must end with "added ... packages" - then npm run dashboard again.');
    process.exit(1);
  }
  // Imported only now: it needs the packages checked above
  const { getLatest, teamStatus } = await import('./team-git.ts');
  // A copy that is not connected to GitHub (a zip, a folder of one's own) has nothing to get
  if (!(await teamStatus(cwd, false)).connected) {
    return;
  }
  say('Getting the latest from your team on GitHub ...');
  const result = await getLatest(cwd);
  if (result.files.length === 0) {
    say('You are up to date with the team.');
    return;
  }
  say(`Got ${result.files.length} changed file${result.files.length === 1 ? '' : 's'} from your teammates.`);
  if (result.packagesChanged) {
    say('Your teammates added or updated packages - installing them (npm install) ...');
    const installed = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit', shell: true });
    if (installed.status !== 0) {
      say('npm install did not finish - run it yourself, then npm run dashboard again.');
    }
  }
};

const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), GITHUB_WAIT).unref());
Promise.race([main(), timeout])
  .then((outcome) => {
    if (outcome === 'timeout') {
      say('GitHub did not answer in time - the dashboard starts with what is on this computer. Press "Get latest" later.');
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    say(`Could not get the latest: ${message}`);
    say('The dashboard starts with what is on this computer.');
  })
  .finally(() => process.exit(0));
