/**
 * Turns a Playwright JSON report (`--reporter=json`) into the plain records the dashboard shows. Pure: no files, no
 * processes - so it is unit tested (tests/unit/dashboard-results.test.ts).
 *
 * Statuses:
 * - passed   the test ran and every check held (a flaky test that passed on retry counts as passed)
 * - failed   an assertion failed, the test timed out or crashed
 * - blocked  the test did not get as far as its check: test.skip / test.fixme (the reason is the one given there),
 *            Playwright skipped it because the test case it depends on failed, or a step before the check could not be
 *            done in any of its tries (the back office did not answer, signing in failed, a step did not take)
 * - running  a run is executing it right now
 * - notrun   no result yet (never run)
 * - notapplicable  someone marked the test case "not applicable" (tests/pages/<page>/not-applicable.json): it is skipped on purpose
 */
import { actualOf, kindOfFailure } from '../../utils/evidence/failure-kind.ts';
export type TestStatus = 'passed' | 'failed' | 'blocked' | 'running' | 'notrun' | 'notapplicable';

/** The Gherkin scenario of a test (from the annotations written by scenario(), see src/utils/core/scenario-test.ts): what the sheet says. */
export type ScenarioInfo = { priority?: number; given: string; when: string; then: string; arabic?: string };

export type TestRecord = {
  /** Stable across runs: project, file and title. */
  key: string;
  /** The case id at the start of the title (`PTL-07-16`), or the whole title when it has none. */
  caseId: string;
  title: string;
  file: string;
  line: number;
  project: string;
  status: TestStatus;
  durationMs: number;
  /** Why a blocked test did not run. */
  reason?: string;
  /** The first failure, without colors. */
  error?: string;
  /** Screenshots of the run, as absolute paths on this machine. */
  screenshots: string[];
  /** The sheet's scenario, when the test was declared from one. */
  scenario?: ScenarioInfo;
  /** The result of the case's run before its latest one (passed, failed or blocked), to show what changed. */
  previous?: TestStatus;
};

export type Summary = { passed: number; failed: number; blocked: number; running: number; notRun: number; notApplicable: number; total: number };

/** `list`: the output of `playwright test --list` (nothing ran). `run`: the output of a run. */
export type ReportMode = 'list' | 'run';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Removes terminal color codes from a message. */
export const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

/** `PTL-07-16 - Selecting ...` -> `PTL-07-16`; a title with no such id is returned as it is. */
export const caseIdOf = (title: string): string => /^([A-Z]+-?\d+(?:-\d+)?)\b/.exec(title)?.[1] ?? title;

export const summarize = (tests: readonly TestRecord[]): Summary => {
  const count = (status: TestStatus) => tests.filter((test) => test.status === status).length;
  return {
    passed: count('passed'),
    failed: count('failed'),
    blocked: count('blocked'),
    running: count('running'),
    notRun: count('notrun'),
    notApplicable: count('notapplicable'),
    total: tests.length,
  };
};

/**
 * The tests as the dashboard shows them: a test case marked not applicable (`reasons[project][caseId]`) gets that status and
 * reason; what it last did stays in the stored record, so it comes back when the case is made applicable again.
 */
export const applyNotApplicable = (tests: readonly TestRecord[], reasons: Readonly<Record<string, Readonly<Record<string, string>>>>): TestRecord[] =>
  tests.map((test) => {
    const reason = reasons[test.project]?.[test.caseId];
    return reason === undefined ? test : { ...test, status: 'notapplicable' as const, reason, error: undefined, screenshots: [] };
  });

const reasonOf = (annotations: unknown[]): string | undefined => {
  for (const annotation of annotations) {
    if (isRecord(annotation) && (annotation.type === 'fixme' || annotation.type === 'skip') && asString(annotation.description)) {
      return asString(annotation.description);
    }
  }
  return undefined;
};

const scenarioOf = (annotations: unknown[]): ScenarioInfo | undefined => {
  const text = (type: string): string | undefined => {
    const found = annotations.filter(isRecord).find((annotation) => annotation.type === type);
    return found ? asString(found.description) : undefined;
  };
  const given = text('Given');
  const when = text('When');
  const then = text('Then');
  if (given === undefined || when === undefined || then === undefined) {
    return undefined;
  }
  const priority = Number(text('Priority'));
  return { ...(Number.isInteger(priority) && priority > 0 ? { priority } : {}), given, when, then, ...(text('Arabic') ? { arabic: text('Arabic') } : {}) };
};

const NOT_REACHED = 'Playwright did not run it: the test case it depends on did not pass, or the run was stopped before it.';

const recordOf = (spec: Json, test: Json, mode: ReportMode): TestRecord => {
  const title = asString(spec.title);
  const file = asString(spec.file);
  const project = asString(test.projectName);
  const results = asArray(test.results).filter(isRecord);
  const last = results.at(-1);
  const scenario = scenarioOf(asArray(test.annotations));
  const base = {
    key: `${project}|${file}|${title}`,
    caseId: caseIdOf(title),
    title,
    file,
    line: asNumber(spec.line),
    project,
    screenshots: [] as string[],
    ...(scenario ? { scenario } : {}),
  };

  if (!last) {
    return mode === 'list' ? { ...base, status: 'notrun', durationMs: 0 } : { ...base, status: 'blocked', durationMs: 0, reason: reasonOf(asArray(test.annotations)) ?? NOT_REACHED };
  }
  const durationMs = results.reduce((total, result) => total + asNumber(result.duration), 0);
  const screenshots = asArray(last.attachments)
    .filter(isRecord)
    .filter((attachment) => asString(attachment.contentType).startsWith('image/') && asString(attachment.path))
    .map((attachment) => asString(attachment.path));

  switch (asString(test.status)) {
    case 'skipped':
      return { ...base, status: 'blocked', durationMs, reason: reasonOf(asArray(test.annotations)) ?? 'Skipped without a reason', screenshots };
    case 'unexpected': {
      const firstError = [last.error, ...asArray(last.errors)].find(isRecord);
      const error = stripAnsi(firstError ? asString(firstError.message) : 'The test failed');
      // A case that could not get as far as its check (after its tries) is blocked, with what happened - not a bug
      if (kindOfFailure(error) === 'blocked') {
        const tries = results.length;
        return { ...base, status: 'blocked', durationMs, reason: `${actualOf(error)} (after ${tries} ${tries === 1 ? 'try' : 'tries'})`, error, screenshots };
      }
      return { ...base, status: 'failed', durationMs, error, screenshots };
    }
    default:
      return { ...base, status: 'passed', durationMs, screenshots };
  }
};

const collect = (suite: Json, into: TestRecord[], mode: ReportMode): void => {
  for (const spec of asArray(suite.specs).filter(isRecord)) {
    for (const test of asArray(spec.tests).filter(isRecord)) {
      into.push(recordOf(spec, test, mode));
    }
  }
  for (const child of asArray(suite.suites).filter(isRecord)) {
    collect(child, into, mode);
  }
};

/** Every test of a Playwright JSON report. */
export const parsePlaywrightReport = (report: unknown, mode: ReportMode): TestRecord[] => {
  if (!isRecord(report)) {
    throw new Error('UNREADABLE_REPORT: the Playwright report is not a JSON object.');
  }
  const tests: TestRecord[] = [];
  for (const suite of asArray(report.suites).filter(isRecord)) {
    collect(suite, tests, mode);
  }
  return tests;
};

/** Errors outside any test (a spec that does not load, a failing global setup) - the first line of each. */
export const reportErrors = (report: unknown): string[] =>
  isRecord(report) ? asArray(report.errors).filter(isRecord).map((error) => stripAnsi(asString(error.message))).filter(Boolean) : [];

/**
 * The tests after a run that may have covered only some of them: a test the run reported replaces its earlier record,
 * the others keep what they had. A test that vanished from `known` (renamed, removed) is dropped.
 */
export const mergeRun = (known: readonly TestRecord[], previous: readonly TestRecord[], reported: readonly TestRecord[]): TestRecord[] => {
  const latest = new Map<string, TestRecord>();
  for (const record of previous) {
    latest.set(record.key, record);
  }
  const RESULTS: readonly TestStatus[] = ['passed', 'failed', 'blocked'];
  for (const record of reported) {
    const before = latest.get(record.key);
    // What the case gave before this run: its last real result (a case that was not run keeps the one before that)
    const previous = before ? (RESULTS.includes(before.status) ? before.status : before.previous) : undefined;
    latest.set(record.key, previous ? { ...record, previous } : record);
  }
  return known.map((record) => {
    const result = latest.get(record.key);
    // The listing is the truth about where a test is; the result is the truth about how it went
    return result ? { ...result, file: record.file, line: record.line, title: record.title, scenario: record.scenario } : record;
  });
};
