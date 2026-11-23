import { execSync } from 'node:child_process';
import { defineConfig } from 'allure';

/** Reads the current git branch and commit, or "unknown" outside a repository. */
function readGitMetadata() {
  const run = (command) => {
    try {
      return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return 'unknown';
    }
  };
  return {
    branch: process.env.BUILD_SOURCEBRANCHNAME || process.env.GITHUB_REF_NAME || run('git rev-parse --abbrev-ref HEAD'),
    commit: (process.env.BUILD_SOURCEVERSION || process.env.GITHUB_SHA)?.slice(0, 7) || run('git rev-parse --short HEAD'),
  };
}

const git = readGitMetadata();
const buildNumber = process.env.BUILD_BUILDNUMBER ?? process.env.GITHUB_RUN_NUMBER ?? `local-${Date.now()}`;

// Rename the report for your project
const reportName = 'E2E Automation Report';

export default defineConfig({
  name: reportName,
  output: './test-output/reports/Allure-Report',
  historyPath: './test-output/reports/allure/history/history.jsonl',
  historyLimit: 30,
  resolutions: {
    rules: [],
    knownIssuesPath: './test-output/reports/allure/known-issues.json',
  },
  categories: {
    rules: [
      {
        name: 'Test Failures',
        id: 'test-failures',
        matchers: {
          statuses: ['failed'],
        },
        groupBy: ['status'],
        groupByMessage: true,
      },
    ],
  },
  variables: {
    'Git Branch': git.branch,
    'Git Commit': git.commit,
    'Build Number': String(buildNumber),
    'Generated At': new Date().toISOString(),
  },
  plugins: {
    awesome: {
      options: {
        reportName,
        singleFile: true,
        reportLanguage: 'en',
        groupBy: ['epic', 'feature', 'story'],
      },
    },
  },
});
