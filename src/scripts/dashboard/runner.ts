import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { caseIdPattern, discoverTestPages, PAGES_FOLDER, setNotApplicable } from '../../config/test-pages.ts';
import { readReviews, setReview, type ExpectedResult, type Review } from '../../config/reviews.ts';
import { REPORT_FOLDER, reportFileName } from '../../reporters/bug-report/report-file.ts';
import { STOP_FILE_VARIABLE, STOPPED_BY_USER } from '../../utils/core/run-control.ts';
import { RunQueue, type BatchPosition, type QueuedRun } from './run-queue.ts';
import { applyNotApplicable, mergeRun, parsePlaywrightReport, reportErrors, stripAnsi, summarize, type Summary, type TestRecord } from './results.ts';
import { backOfficeAccount } from './account.ts';
import { notBuiltByPage } from '../story/story-readiness.ts';

/**
 * Runs Playwright for the dashboard and keeps what the dashboard shows: the tests of every page, their last results
 * and the history of runs. The state survives a restart (test-output/dashboard/state.json, gitignored with the rest of
 * test-output).
 */
const LIVE_PREFIX = '@@dashboard '; // same as in live-reporter.ts (that file must not be imported: it is loaded by Playwright)
const PLAYWRIGHT_CLI = path.resolve('node_modules/@playwright/test/cli.js');
const DASHBOARD_DIR = path.resolve('test-output/dashboard');
const STATE_FILE = path.join(DASHBOARD_DIR, 'state.json');
const MAX_HISTORY = 30;
const KEEP_RUN_FOLDERS = 10;
const MAX_LOG_LINES = 800;
/** After Stop, how long the running test may take to finish before the run is ended by force. */
const STOP_GRACE_MS = 120_000;

/** A page of the dashboard: a folder of tests/pages (see src/config/test-pages.ts). `project` is its Playwright project. */
export type DashboardPage = { id: string; title: string; group: string; story: string; project: string; path?: string; notApplicable?: Record<string, string>; reviews?: Record<string, Review> };

const loadPages = (root?: string): DashboardPage[] =>
  discoverTestPages(root).map((page) => ({ id: page.id, title: page.title, group: page.group, story: page.story, project: page.id, path: page.path, notApplicable: page.notApplicable, reviews: readReviews(path.join(root ?? path.resolve(PAGES_FOLDER), page.id)) }));

export type RunScope = { pageId: string; project: string; pageTitle: string; caseIds?: string[]; headless: boolean; scope?: string };

export type RunInfo = {
  id: string;
  pageId: string;
  pageTitle: string;
  project: string;
  /** Empty: the whole page. */
  caseIds: string[];
  /** What part of the page runs, when it was chosen by priority: "P1 cases". */
  scope?: string;
  headless: boolean;
  startedAt: number;
  finishedAt?: number;
  /** Tests finished so far / tests in this run. */
  done: number;
  total: number;
  exitCode?: number | null;
  stopped?: boolean;
  /** Stop was pressed once: the test running now is finishing and the rest are skipped; a second press ends it at once. */
  stopping?: boolean;
  /** Playwright could not run at all (config error, missing environment variable ...): the reason. */
  crashed?: string;
};

export type HistoryEntry = RunInfo & { summary: Summary };

export type PageView = DashboardPage & { summary: Summary; tests: TestRecord[]; lastRunAt?: number };

export type Snapshot = {
  pages: PageView[];
  totals: Summary;
  run: RunInfo | null;
  loading: boolean;
  listError?: string;
  history: HistoryEntry[];
  htmlReport: boolean;
  /** The Word bug report of each page (by page id) that has one from its last run. */
  bugReports: Record<string, BugReportInfo>;
  /** The reviewers' verdicts on results, by page id and case id (tests/pages/<page>/review.json). */
  reviews: Record<string, Record<string, Review>>;
  /** The runs waiting to start after the one in progress, in order. */
  queue: QueuedRun[];
  /** Where the run in progress is in its batch of queued runs. */
  batch: BatchPosition;
  /** Runs that were waiting (or running) when the dashboard was closed: offered to resume, never started by themselves. */
  pausedQueue: QueuedRun[];
  /** The user name of the back-office account the runs sign in with (this person's own, from .env); never the password. */
  account?: string;
  /** Cases not built yet ("Not automated yet"), by page id: a new story shared before its cases were written. */
  notBuilt: Record<string, number>;
};

export type BugReportInfo = { name: string; size: number; at: number };

type Saved = { tests: TestRecord[]; history: HistoryEntry[]; queue?: QueuedRun[] };

/** The Playwright arguments for a run of one project, optionally only some of its cases. */
export const playwrightArgs = (project: string, caseIds: readonly string[] = []): string[] => {
  const args = ['test', `--project=${project}`];
  const pattern = caseIdPattern(caseIds);
  if (pattern) {
    args.push(`--grep=${pattern}`);
  }
  return args;
};

/** Pages for a set of tests: the page folders, then one per project that has no folder (should not happen). */
export const pagesFor = (tests: readonly TestRecord[], history: readonly HistoryEntry[], pages: readonly DashboardPage[]): PageView[] => {
  const configured: DashboardPage[] = [...pages];
  const known = new Set(configured.map((page) => page.project));
  for (const project of new Set(tests.map((test) => test.project))) {
    if (!known.has(project)) {
      configured.push({ id: `project-${project}`, title: project, group: 'Other', story: '', project });
    }
  }
  return configured.map((page) => {
    const own = tests.filter((test) => test.project === page.project);
    const lastRunAt = history.find((entry) => entry.project === page.project && !entry.crashed)?.finishedAt;
    return { ...page, tests: own, summary: summarize(own), lastRunAt };
  });
};

/** Project -> case id -> reason, from the pages' not-applicable files. */
const reasonsOf = (pages: readonly DashboardPage[]): Record<string, Record<string, string>> =>
  Object.fromEntries(pages.map((page) => [page.project, page.notApplicable ?? {}]));

const killTree = (child: ChildProcess): void => {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    // child.kill() on Windows ends only the parent and leaves Playwright's workers and the browser behind
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  } else {
    child.kill('SIGTERM');
  }
};

export class Runner extends EventEmitter {
  private tests: TestRecord[] = [];
  private history: HistoryEntry[] = [];
  private current: RunInfo | null = null;
  private child: ChildProcess | null = null;
  private pages: DashboardPage[] = [];
  private refreshAfterRun = false;
  private loading = true;
  private listError: string | undefined;
  private readonly log: string[] = [];
  private stopFile = '';
  private forceTimer: NodeJS.Timeout | undefined;
  private readonly queue = new RunQueue();
  private pausedQueue: QueuedRun[] = [];
  /** Cases not built yet ("Not automated yet"), per page: they wait for someone who works with Claude. */
  private notBuilt: Record<string, number> = notBuiltByPage();

  constructor() {
    super();
    if (existsSync(STATE_FILE)) {
      try {
        const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<Saved>;
        this.tests = saved.tests ?? [];
        this.history = saved.history ?? [];
        this.pausedQueue = saved.queue ?? [];
      } catch {
        // A damaged state file only loses the last results
      }
    }
  }

  recentLog(): string[] {
    return this.log;
  }

  snapshot(): Snapshot {
    // A later run of the same page empties its results folder: pictures that are gone are not offered
    const tests = applyNotApplicable(
      this.tests.map((test) => (test.screenshots.every((file) => existsSync(file)) ? test : { ...test, screenshots: test.screenshots.filter((file) => existsSync(file)) })),
      reasonsOf(this.pages),
    );
    const pages = pagesFor(tests, this.history, this.pages);
    return {
      reviews: Object.fromEntries(this.pages.map((page) => [page.id, page.reviews ?? {}])),
      pages,
      totals: summarize(tests),
      run: this.current,
      loading: this.loading,
      listError: this.listError,
      history: this.history,
      htmlReport: existsSync(path.resolve('test-output/reports/Playwright-Report/index.html')),
      bugReports: this.bugReports(),
      queue: [...this.queue.items()],
      batch: this.queue.position(),
      pausedQueue: this.pausedQueue,
      account: backOfficeAccount(),
      notBuilt: this.notBuilt,
    };
  }

  /** Whether a run is in progress. */
  busy(): boolean {
    return this.current !== null && this.current.finishedAt === undefined;
  }

  /**
   * Runs pages one after another: the first starts now when nothing is running, the others wait in the queue and each
   * starts when the run before it has ended. A run that is already waiting (or running) is not added twice. Returns the
   * runs added to the queue - plus the one started, if any.
   */
  enqueue(runs: readonly QueuedRun[]): { started?: RunInfo; queued: QueuedRun[] } {
    const running = this.busy() && this.current ? { pageId: this.current.pageId, caseIds: this.current.caseIds } : undefined;
    const added = this.queue.add(runs, running);
    const started = running ? undefined : this.startNext();
    this.save();
    this.emit('change');
    return { started, queued: started ? added.slice(1) : added };
  }

  /** Runs the queue the dashboard had when it was closed (`resume`), or forgets it. */
  settlePausedQueue(resume: boolean): { started?: RunInfo; queued: QueuedRun[] } {
    const paused = this.pausedQueue;
    this.pausedQueue = [];
    this.save();
    if (!resume || paused.length === 0) {
      this.emit('change');
      return { queued: [] };
    }
    return this.enqueue(paused);
  }

  /** Takes a waiting run out of the queue, by its place in it. */
  unqueue(index: number): void {
    this.queue.remove(index);
    this.save();
    this.emit('change');
  }

  /** Starts the next run of the queue, if there is one. */
  private startNext(): RunInfo | undefined {
    const next = this.queue.next();
    return next ? this.start(next) : undefined;
  }

  /** The Word report file of a page: one per user story, written when a run ends. */
  bugReportFile(pageId: string): string | undefined {
    const page = this.pages.find((candidate) => candidate.id === pageId);
    return page?.story ? path.resolve(REPORT_FOLDER, reportFileName(page.story)) : undefined;
  }

  private bugReports(): Record<string, BugReportInfo> {
    const found: Record<string, BugReportInfo> = {};
    for (const page of this.pages) {
      const file = this.bugReportFile(page.id);
      if (file && existsSync(file)) {
        const info = statSync(file);
        found[page.id] = { name: path.basename(file), size: info.size, at: info.mtimeMs };
      }
    }
    return found;
  }

  /** Asks Playwright which tests exist and merges them with the last results. */
  async refreshList(): Promise<void> {
    if (this.current && !this.current.finishedAt) {
      this.refreshAfterRun = true; // a run is using the tests; look again when it ends
      return;
    }
    this.loading = true;
    this.listError = undefined;
    this.emit('change');
    try {
      this.pages = loadPages();
      this.notBuilt = notBuiltByPage();
    } catch (error) {
      this.listError = error instanceof Error ? error.message : String(error);
      this.loading = false;
      this.emit('change');
      return;
    }
    // INCLUDE_NOT_APPLICABLE: the listing keeps the test cases that a run skips, so they can be shown and made applicable again
    const { stdout, stderr } = await this.capture(['test', '--list', '--reporter=json'], { INCLUDE_NOT_APPLICABLE: '1' });
    try {
      const report: unknown = JSON.parse(stdout);
      const listed = parsePlaywrightReport(report, 'list');
      const errors = reportErrors(report);
      if (listed.length === 0 && errors.length > 0) {
        this.listError = errors.join('\n');
      } else {
        this.tests = mergeRun(listed, this.tests, []);
      }
    } catch {
      this.listError = stripAnsi(stderr || stdout).trim().slice(0, 2000) || 'Playwright did not list the tests.';
    }
    this.loading = false;
    this.save();
    this.emit('change');
  }

  /** Marks test cases of a page not applicable (`reason`) or applicable again (`reason` null); writes the page's not-applicable.json. */
  markNotApplicable(pageId: string, caseIds: readonly string[], reason: string | null): void {
    setNotApplicable(pageId, caseIds, reason);
    this.reloadPages();
  }

  /**
   * Records the reviewer's verdict on a case - the result it should give and why - or removes it (`expected` null). Claude
   * reads it and updates the test (see src/config/reviews.ts).
   */
  review(pageId: string, caseId: string, expected: ExpectedResult | null, note: string, result?: string): void {
    setReview(path.resolve(PAGES_FOLDER, path.basename(pageId)), caseId, expected ? { expected, note, ...(result ? { result } : {}) } : null);
    this.reloadPages();
  }

  /** Reads the pages' folders again (their not-applicable files, titles ...) without asking Playwright for the tests. */
  reloadPages(): void {
    try {
      this.pages = loadPages();
      this.listError = undefined;
    } catch (error) {
      this.listError = error instanceof Error ? error.message : String(error);
    }
    this.emit('change');
  }

  start(scope: RunScope): RunInfo {
    if (this.busy()) {
      throw new Error('A run is already in progress.');
    }
    const caseIds = scope.caseIds ?? [];
    const skipped = reasonsOf(this.pages)[scope.project] ?? {};
    // A test case marked not applicable is not run (the Playwright config leaves it out), so it is not part of the run
    const inScope = (test: TestRecord) => test.project === scope.project && !(test.caseId in skipped) && (caseIds.length === 0 || caseIds.includes(test.caseId));
    // A new run starts without the previous bug report of this user story: the file that exists afterwards is from this run
    const previousReport = this.bugReportFile(scope.pageId);
    if (previousReport) {
      rmSync(previousReport, { force: true });
    }
    const before = this.tests;
    const id = String(Date.now());
    const runDir = path.join(DASHBOARD_DIR, 'runs', id);
    mkdirSync(runDir, { recursive: true });

    const run: RunInfo = {
      id,
      pageId: scope.pageId,
      pageTitle: scope.pageTitle,
      project: scope.project,
      caseIds,
      ...(scope.scope && caseIds.length ? { scope: scope.scope } : {}),
      headless: scope.headless,
      startedAt: Date.now(),
      done: 0,
      total: before.filter(inScope).length,
    };
    this.current = run;
    this.stopFile = path.join(runDir, 'stop');
    this.log.length = 0;
    this.tests = before.map((test) => (inScope(test) ? { ...test, status: 'running' as const, error: undefined, reason: undefined, screenshots: [] } : test));
    this.emit('change');

    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...playwrightArgs(scope.project, caseIds)], {
      env: {
        ...process.env,
        DASHBOARD_RUN_DIR: runDir,
        [STOP_FILE_VARIABLE]: this.stopFile,
        DASHBOARD_OUTPUT_DIR: path.join(DASHBOARD_DIR, 'results', scope.project),
        HEADLESS: String(scope.headless),
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    const onText = (chunk: Buffer) => {
      for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
        if (raw.startsWith(LIVE_PREFIX)) {
          this.onLive(raw.slice(LIVE_PREFIX.length), run);
        } else if (raw.trim()) {
          this.addLog(stripAnsi(raw));
        }
      }
    };
    child.stdout.on('data', onText);
    child.stderr.on('data', onText);
    child.on('error', (error) => this.finish(run, before, runDir, null, error.message));
    child.on('close', (code) => this.finish(run, before, runDir, code));
    return run;
  }

  /**
   * Stop. The first press asks the run to finish politely: the test running now ends normally (its clean-up runs and
   * its screenshot is taken), the tests after it are skipped, and Playwright writes its reports and the bug report for
   * everything that was tested. A second press - or `force`, or waiting too long - ends the run at once, which loses
   * the reports (and the clean-up of the test that was running). Stop also empties the queue; `skipOnly` (Skip) stops
   * only this run, and the queue goes on with the next one.
   */
  stop(force = false, options: { skipOnly?: boolean } = {}): void {
    const run = this.current;
    const child = this.child;
    if (!child || !run || run.finishedAt) {
      return;
    }
    // Stop ends the whole batch; Skip ends only this run, and the next one in the queue starts after it
    if (!options.skipOnly) {
      this.queue.clear();
      this.save();
    }
    run.stopped = true;
    if (force || run.stopping) {
      killTree(child);
      return;
    }
    run.stopping = true;
    try {
      writeFileSync(this.stopFile, 'stop');
    } catch {
      killTree(child);
      return;
    }
    this.forceTimer = setTimeout(() => killTree(child), STOP_GRACE_MS);
    this.emit('change');
  }

  private addLog(line: string): void {
    this.log.push(line);
    if (this.log.length > MAX_LOG_LINES) {
      this.log.splice(0, this.log.length - MAX_LOG_LINES);
    }
    this.emit('log', line);
  }

  private onLive(json: string, run: RunInfo): void {
    try {
      const event = JSON.parse(json) as { project: string; title: string; status: 'passed' | 'failed' | 'blocked' | 'running'; reason?: string; error?: string };
      this.tests = this.tests.map((test) =>
        test.project === event.project && test.title === event.title
          ? { ...test, status: event.status, ...(event.reason ? { reason: event.reason } : {}), ...(event.error ? { error: stripAnsi(event.error) } : {}) }
          : test,
      );
      // A try that will be tried again is not done yet
      if (event.status !== 'running') {
        run.done += 1;
      }
      this.emit('change');
    } catch {
      // A garbled line only delays the update until the run ends
    }
  }

  private finish(run: RunInfo, before: TestRecord[], runDir: string, exitCode: number | null, spawnError?: string): void {
    if (run.finishedAt) {
      return; // 'error' and 'close' can both fire
    }
    clearTimeout(this.forceTimer);
    run.finishedAt = Date.now();
    run.exitCode = exitCode;
    this.child = null;

    const reportFile = path.join(runDir, 'report.json');
    let reported: TestRecord[] = [];
    if (existsSync(reportFile)) {
      try {
        const report: unknown = JSON.parse(readFileSync(reportFile, 'utf8'));
        // A test that was not started because of Stop keeps its earlier result
        reported = parsePlaywrightReport(report, 'run').filter((record) => !(record.status === 'blocked' && record.reason === STOPPED_BY_USER));
        const errors = reportErrors(report);
        if (reported.length === 0 && errors.length > 0) {
          run.crashed = errors.join('\n');
        }
      } catch {
        run.crashed = 'The Playwright report could not be read.';
      }
    } else if (!run.stopped) {
      run.crashed = spawnError ?? (this.log.slice(-12).join('\n') || 'Playwright ended without a report.');
    }

    // Tests the run did not reach (stopped, crashed) get their earlier result back
    this.tests = mergeRun(this.tests, before, reported).map((test) => {
      if (test.status !== 'running') {
        return test;
      }
      return before.find((old) => old.key === test.key) ?? { ...test, status: 'notrun' as const };
    });
    this.history = [{ ...run, summary: summarize(this.tests.filter((test) => test.project === run.project)) }, ...this.history].slice(0, MAX_HISTORY);
    this.save();
    this.pruneRunFolders();
    this.queue.runEnded();
    // The next page of the queue starts at once; the test list is looked at again when the queue is done
    if (!this.startNext()) {
      this.emit('change');
      if (this.refreshAfterRun) {
        this.refreshAfterRun = false;
        void this.refreshList();
      }
    }
  }

  /** Each run leaves a small report.json behind; only the latest few are kept. */
  private pruneRunFolders(): void {
    try {
      const runs = path.join(DASHBOARD_DIR, 'runs');
      for (const old of readdirSync(runs).sort().reverse().slice(KEEP_RUN_FOLDERS)) {
        rmSync(path.join(runs, old), { recursive: true, force: true });
      }
    } catch {
      // Housekeeping only
    }
  }

  private save(): void {
    try {
      mkdirSync(DASHBOARD_DIR, { recursive: true });
      // The run in progress and the queue are kept too: a dashboard closed in the middle offers to run them again
      const running = this.busy() && this.current && !this.current.stopped ? [{ pageId: this.current.pageId, pageTitle: this.current.pageTitle, project: this.current.project, caseIds: this.current.caseIds, headless: this.current.headless, ...(this.current.scope ? { scope: this.current.scope } : {}) }] : [];
      const queue = [...running, ...this.queue.items(), ...this.pausedQueue];
      const saved: Saved = { tests: this.tests.map((test) => (test.status === 'running' ? { ...test, status: 'notrun' as const } : test)), history: this.history, queue };
      writeFileSync(STATE_FILE, JSON.stringify(saved));
    } catch {
      // The dashboard works without remembering
    }
  }

  private capture(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...args], { env: { ...process.env, ...env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', (error) => resolve({ stdout, stderr: error.message }));
      child.on('close', () => resolve({ stdout, stderr }));
    });
  }
}
