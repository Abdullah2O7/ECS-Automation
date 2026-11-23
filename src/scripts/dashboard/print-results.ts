import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverTestPages, PAGES_FOLDER } from '../../config/test-pages.ts';
import { readReviews } from '../../config/reviews.ts';
import { applyNotApplicable, summarize, type TestRecord } from './results.ts';
import type { HistoryEntry } from './runner.ts';

/**
 * Prints the dashboard's latest results of a page, as text: what each case gave, what changed since the run before, the
 * hint or error, and the reviewer's verdict. For reading a run without opening the dashboard - Claude reads the runs made
 * on the dashboard this way.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/scripts/dashboard/print-results.ts [<page or story>] [--failed]
 *   no page: every page, one line each; a page (its folder or its story id: CMS-90): every case; --failed: only the
 *   cases that failed or were blocked
 */
const STATE_FILE = path.resolve('test-output/dashboard/state.json');

const firstLine = (text: string | undefined): string => (text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
const hintOf = (error: string | undefined): string => /^\s*Hint: (.+)$/m.exec(error ?? '')?.[1] ?? '';
const ago = (time: number | undefined): string => (time ? `${new Date(time).toLocaleString()}` : 'never');

const main = (): void => {
  if (!existsSync(STATE_FILE)) {
    console.log('[results] No results yet: run a page on the dashboard first (npm run dashboard).');
    return;
  }
  const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { tests?: TestRecord[]; history?: HistoryEntry[] };
  const history = saved.history ?? [];
  const pages = discoverTestPages();
  const tests = applyNotApplicable(saved.tests ?? [], Object.fromEntries(pages.map((page) => [page.id, page.notApplicable])));
  const args = process.argv.slice(2);
  const onlyProblems = args.includes('--failed');
  const wanted = args.find((arg) => !arg.startsWith('--'));

  if (!wanted) {
    for (const page of pages) {
      const own = tests.filter((test) => test.project === page.id);
      const s = summarize(own);
      const last = history.find((entry) => entry.project === page.id && !entry.crashed)?.finishedAt;
      console.log(`${page.id.padEnd(34)} ${String(s.passed).padStart(3)} passed ${String(s.failed).padStart(3)} failed ${String(s.blocked).padStart(3)} blocked ${String(s.notRun).padStart(3)} not run  (last run ${ago(last)})`);
    }
    return;
  }
  const page = pages.find((candidate) => candidate.id === wanted || candidate.story.toLowerCase() === wanted.toLowerCase());
  if (!page) {
    console.log(`[results] No page "${wanted}". Pages: ${pages.map((candidate) => `${candidate.id} (${candidate.story})`).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const reviews = readReviews(path.resolve(PAGES_FOLDER, page.id));
  const own = tests.filter((test) => test.project === page.id);
  const s = summarize(own);
  const last = history.find((entry) => entry.project === page.id);
  console.log(`${page.title} (${page.story}) - ${s.passed} passed, ${s.failed} failed, ${s.blocked} blocked, ${s.notRun} not run, ${s.notApplicable} not applicable`);
  console.log(`Last run: ${ago(last?.finishedAt)}${last ? ` (${last.caseIds.length ? `${last.caseIds.length} cases` : 'all cases'}${last.crashed ? ', could not run' : last.stopped ? ', stopped' : ''})` : ''}`);
  for (const test of own) {
    const notApplicable = test.status === 'notapplicable' ? test.reason : undefined;
    const status = test.status;
    if (onlyProblems && status !== 'failed' && status !== 'blocked') {
      continue;
    }
    const change = test.previous && test.previous !== test.status && ['passed', 'failed', 'blocked'].includes(test.status) ? ` (was ${test.previous})` : '';
    const detail = notApplicable ?? test.reason ?? (hintOf(test.error) ? `Hint: ${hintOf(test.error)}` : firstLine(test.error));
    const review = reviews[test.caseId];
    console.log(`  ${test.caseId.padEnd(11)} ${status.padEnd(13)}${change.padEnd(14)} ${test.durationMs ? `${Math.round(test.durationMs / 1000)}s`.padStart(5) : '     '}  ${detail.slice(0, 220)}`);
    if (review) {
      console.log(`  ${''.padEnd(11)} YOUR VERDICT: should be ${review.expected} - ${review.note}${review.done ? ` (done: ${review.done.note})` : ' (waiting for Claude)'}`);
    }
  }
};

main();
