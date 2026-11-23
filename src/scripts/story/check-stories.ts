import { casesNotBuilt, storyProblems } from './story-readiness.ts';

/**
 * npm run story:check - fails when a sheet in docs/test-cases has no tests yet (npm run story:new not run). "Share my work"
 * runs the same check, and so does GitHub on every share. Also lists the cases not built yet - for whoever builds them.
 */
const problems = storyProblems();
for (const { story, count } of casesNotBuilt()) {
  console.log(`${story}: ${count} case${count === 1 ? '' : 's'} not built yet - ask Claude to build ${count === 1 ? 'it' : 'them'}.`);
}
if (problems.length) {
  console.error(`Not ready to share:\n${problems.map((line) => `  - ${line}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Every sheet in docs/test-cases has its tests.');
}
