import { expect, test } from '@playwright/test';
import { aheadBehind, changedFiles, filesInGitMessage, forbiddenFiles, secretsIn, secretValues, shareMessage } from '../../src/scripts/team/team-rules';

test.describe('Sharing work through GitHub', () => {
  test('the .env and private keys are never shared, the .env example is', () => {
    expect(forbiddenFiles(['.env', 'sub/.env', '.env.local', 'keys/server.pem', 'id_rsa', '.env.example', 'tests/pages/a/page.json'])).toEqual(['.env', 'sub/.env', '.env.local', 'keys/server.pem', 'id_rsa']);
  });

  test('a password or user name from .env in the changes is caught, by its name only', () => {
    const secrets = secretValues({ CMS_CONTENT_USERNAME: 'sara@club.test', CMS_CONTENT_PASSWORD: 'S3cret!pass', HEADLESS: 'true', CMS_BASE_URL: 'https://cms.test', DB_PASSWORD: '123' });
    expect(Object.keys(secrets)).toEqual(['CMS_CONTENT_USERNAME', 'CMS_CONTENT_PASSWORD']);
    expect(secretsIn('+ const login = "S3cret!pass";', secrets)).toEqual(['CMS_CONTENT_PASSWORD']);
    expect(secretsIn('+ nothing private here', secrets)).toEqual([]);
  });

  test('the changed files are read from git, renamed ones by their new name', () => {
    const porcelain = [' M src/a.ts', '?? tests/pages/new story/x.spec.ts', 'R  new/name.ts', 'old/name.ts', 'A  docs/b.md', ''].join('\0');
    expect(changedFiles(porcelain)).toEqual(['src/a.ts', 'tests/pages/new story/x.spec.ts', 'new/name.ts', 'docs/b.md']);
    expect(changedFiles('')).toEqual([]);
  });

  test('ahead and behind the team copy', () => {
    expect(aheadBehind('2\t5\n')).toEqual({ ahead: 2, behind: 5 });
    expect(aheadBehind('')).toEqual({ ahead: 0, behind: 0 });
  });

  test('the files git names when local changes would be overwritten', () => {
    const message = 'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/a.ts\n\tREADME.md\nPlease commit your changes or stash them before you merge.\nAborting\n';
    expect(filesInGitMessage(message)).toEqual(['src/a.ts', 'README.md']);
  });

  test('a share says what changed, in one line', () => {
    expect(shareMessage('  Added the\nCMS-90 cases ', ['a'])).toBe('Added the CMS-90 cases');
    expect(shareMessage('', ['a', 'b'])).toBe('Update 2 files');
  });
});
