import { createInterface } from 'node:readline/promises';
import { connectFolder, git, setAuthor, shareWork, TeamError } from './team-git.ts';

/**
 * Connects this project folder to the team's GitHub repository - once, by the person who uploads the project first:
 *
 *   npm run team:setup -- https://github.com/<owner>/ecs-automation
 *
 * The repository must be new: empty, or with only the README/licence/.gitignore GitHub offers to create. Teammates do not run this: they copy the repository instead (README, "Working
 * as a team"). The first upload goes through the same checks as every "Share my work": the code must pass, and
 * nothing private (.env, a password) is ever sent.
 */

const cwd = process.cwd();
// A terminal is here to answer: git may ask for the GitHub sign-in in it
process.env.TEAM_GIT_INTERACTIVE = '1';
const url = (process.argv[2] ?? '').trim();
const ask = createInterface({ input: process.stdin, output: process.stdout });
const say = (text: string) => console.log(text);

const main = async (): Promise<void> => {
  if (!/^(https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(url)) {
    throw new TeamError('Give the address of the empty GitHub repository: npm run team:setup -- https://github.com/<owner>/<name>');
  }
  say(`Checking ${url} ...`);
  const { starterFiles } = await connectFolder(cwd, url);
  if (starterFiles.length) {
    say(`GitHub started the repository with ${starterFiles.join(', ')} - the project goes on top (its own README and .gitignore replace GitHub's).`);
  }

  if (!(await git(cwd, ['config', 'user.name'])).out.trim() || !(await git(cwd, ['config', 'user.email'])).out.trim()) {
    say('Your teammates see who shared what.');
    const name = await ask.question('Your name: ');
    const email = await ask.question('Your e-mail (the one of your GitHub account): ');
    await setAuthor(cwd, name, email);
  }

  say('Checking the project and uploading it - a GitHub window may ask you to sign in the first time ...');
  const result = await shareWork(cwd, 'ECS automation: the project', (step) => say(`  ${step}`));
  say(`Done: ${result.files.length} files are on GitHub. Your teammates can copy the project now.`);
};

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof TeamError && error.files.length) {
      console.error(error.files.map((file) => `  ${file}`).join('\n'));
    }
    process.exitCode = 1;
  })
  .finally(() => ask.close());
