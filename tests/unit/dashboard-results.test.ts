import { expect, test } from '@playwright/test';
import { playwrightArgs, pagesFor, type DashboardPage } from '../../src/scripts/dashboard/runner';
import { applyNotApplicable, caseIdOf, mergeRun, parsePlaywrightReport, reportErrors, stripAnsi, summarize, type TestRecord } from '../../src/scripts/dashboard/results';

// A trimmed Playwright JSON report: one passed, one failed, one skipped with a reason, one fixme, one never run
const spec = (title: string, test: object) => ({ title, file: 'pages/news/PTL-07-list.spec.ts', line: 10, tests: [{ projectName: 'news', ...test }] });
const passed = { status: 'expected', annotations: [], results: [{ status: 'passed', duration: 1200, attachments: [{ contentType: 'image/png', path: '/out/shot.png' }, { contentType: 'video/webm', path: '/out/v.webm' }] }] };
const failed = { status: 'unexpected', annotations: [], results: [{ status: 'failed', duration: 800, attachments: [], error: { message: '\u001b[31mError: expect(received).toBe(expected)\u001b[39m\n\nExpected: 6' } }] };
const skipped = { status: 'skipped', annotations: [{ type: 'skip', description: 'Needs 7 articles' }], results: [{ status: 'skipped', duration: 5, attachments: [] }] };
const fixme = { status: 'skipped', annotations: [{ type: 'fixme', description: 'Needs a Draft article' }], results: [{ status: 'skipped', duration: 3, attachments: [] }] };
const gherkin = [{ type: 'Priority', description: '1' }, { type: 'Given', description: 'a | b' }, { type: 'When', description: 'c' }, { type: 'Then', description: 'd' }, { type: 'Arabic', description: 'ع' }];
const noResult = { status: 'skipped', annotations: [], results: [] };

const report = {
  suites: [{ title: 'file', specs: [], suites: [{ title: 'PTL-07', specs: [spec('PTL-07-01 - Open', passed), spec('PTL-07-02 - Cards', failed), spec('PTL-07-18 - Paging', skipped), spec('PTL-07-13 - Drafts', fixme), spec('PTL-07-30 - Late', noResult)] }] }],
  errors: [],
};

test.describe('Dashboard results', () => {
  test('reads passed, failed and blocked tests with their reasons', () => {
    const tests = parsePlaywrightReport(report, 'run');
    expect(tests.map((t) => [t.caseId, t.status])).toEqual([['PTL-07-01', 'passed'], ['PTL-07-02', 'failed'], ['PTL-07-18', 'blocked'], ['PTL-07-13', 'blocked'], ['PTL-07-30', 'blocked']]);
    expect(tests[2]?.reason).toBe('Needs 7 articles');
    expect(tests[3]?.reason).toBe('Needs a Draft article');
    expect(tests[4]?.reason).toContain('did not run');
  });

  test('a case that could not get as far as its check, after its tries, is blocked with what happened', () => {
    const setup = { status: 'unexpected', annotations: [], results: [1, 2, 3].map(() => ({ status: 'failed', duration: 100, attachments: [], error: { message: 'Error: SETUP_FAILED: could not sign in to the CMS before the check. ecs.example did not answer' } })) };
    const [blocked] = parsePlaywrightReport({ suites: [{ specs: [spec('CMS-07-02 - Open', setup)], suites: [] }] }, 'run');
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.reason).toBe('the test could not sign in to the CMS (a step before the check), so the check itself was not reached: ecs.example did not answer (after 3 tries)');
    expect(blocked?.durationMs).toBe(300);
  });

  test('a test declared from a sheet scenario carries it, with its priority', () => {
    const [tests] = [parsePlaywrightReport({ suites: [{ specs: [spec('PTL-07-01 - Open', { ...passed, annotations: gherkin })], suites: [] }] }, 'run')];
    expect(tests[0]?.scenario).toEqual({ priority: 1, given: 'a | b', when: 'c', then: 'd', arabic: 'ع' });
    expect(parsePlaywrightReport(report, 'run')[0]?.scenario).toBeUndefined();
  });

  test('keeps only screenshots, and the error without color codes', () => {
    const [first, second] = parsePlaywrightReport(report, 'run');
    expect(first?.screenshots).toEqual(['/out/shot.png']);
    expect(second?.error).toBe('Error: expect(received).toBe(expected)\n\nExpected: 6');
  });

  test('a listing (nothing ran) reads every test as not run', () => {
    const listed = parsePlaywrightReport({ suites: [{ specs: [spec('PTL-07-01 - Open', noResult)], suites: [] }] }, 'list');
    expect(listed.map((t) => t.status)).toEqual(['notrun']);
  });

  test('summarize counts each status', () => {
    expect(summarize(parsePlaywrightReport(report, 'run'))).toEqual({ passed: 1, failed: 1, blocked: 3, running: 0, notRun: 0, notApplicable: 0, total: 5 });
  });

  test('case ids: PTL-07-16 from a title, the title itself when there is none', () => {
    expect(caseIdOf('PTL-07-16 - Selecting a category')).toBe('PTL-07-16');
    expect(caseIdOf('TC01 - Sign in')).toBe('TC01');
    expect(caseIdOf('Opens the page')).toBe('Opens the page');
  });

  test('an unreadable report and report-level errors are reported, not swallowed', () => {
    expect(() => parsePlaywrightReport('nope', 'run')).toThrow('UNREADABLE_REPORT');
    expect(reportErrors({ errors: [{ message: '\u001b[31mMISSING_ENVIRONMENT_CONFIGURATION:CMS_BASE_URL\u001b[39m' }] })).toEqual(['MISSING_ENVIRONMENT_CONFIGURATION:CMS_BASE_URL']);
    expect(stripAnsi('\u001b[1mbold\u001b[22m')).toBe('bold');
  });

  test('a partial run replaces only the tests it reported', () => {
    const record = (caseId: string, status: TestRecord['status']): TestRecord => ({ key: caseId, caseId, title: caseId, file: 'f', line: 1, project: 'p', status, durationMs: 0, screenshots: [] });
    const known = [record('A', 'notrun'), record('B', 'notrun'), record('C', 'notrun')];
    const previous = [record('A', 'failed'), record('B', 'passed'), record('GONE', 'passed')];
    const merged = mergeRun(known, previous, [record('A', 'passed')]);
    expect(merged.map((t) => [t.caseId, t.status])).toEqual([['A', 'passed'], ['B', 'passed'], ['C', 'notrun']]);
  });
});

test.describe('Dashboard run arguments and pages', () => {
  test('a whole page runs its project only', () => {
    expect(playwrightArgs('news')).toEqual(['test', '--project=news']);
  });

  test('chosen cases are matched exactly, so PTL-07-1 does not also run PTL-07-16', () => {
    const [, , grep] = playwrightArgs('news', ['PTL-07-1', 'PTL-07-16']);
    const pattern = new RegExp(grep?.replace('--grep=', '') ?? '');
    expect(pattern.test('PTL-07-1 - Open')).toBe(true);
    expect(pattern.test('PTL-07-16 - Select')).toBe(true);
    expect(pattern.test('PTL-07-12 - Other')).toBe(false);
  });

  test('a case id is not found inside a file name, so TC01 does not pull in everything of TC01-portal-sessions.spec.ts', () => {
    const [, , grep] = playwrightArgs('sign-in', ['TC01']);
    const pattern = new RegExp(grep?.replace('--grep=', '') ?? '');
    expect(pattern.test('sign-in pages/sign-in/TC01-portal-sessions.spec.ts Portal TC02 - Other')).toBe(false);
    expect(pattern.test('sign-in pages/sign-in/TC01-portal-sessions.spec.ts Portal TC01 - Sign in')).toBe(true);
  });

  test('a project that has no page folder still gets a page', () => {
    const listed: DashboardPage[] = [{ id: 'news', title: 'News', group: 'Pages', story: '', project: 'news' }];
    const tests: TestRecord[] = [{ key: 'k', caseId: 'X', title: 'X', file: 'f', line: 1, project: 'Brand-new-project', status: 'passed', durationMs: 0, screenshots: [] }];
    const pages = pagesFor(tests, [], listed);
    expect(pages.map((p) => p.project)).toEqual(['news', 'Brand-new-project']);
    expect(pages.at(-1)?.summary.passed).toBe(1);
  });
});

test.describe('Not applicable test cases on the dashboard', () => {
  const record = (caseId: string, status: TestRecord['status'], extra: Partial<TestRecord> = {}): TestRecord => ({
    key: `news|f|${caseId}`, caseId, title: `${caseId} - x`, file: 'f', line: 1, project: 'news', status, durationMs: 5, screenshots: ['/out/a.png'], ...extra,
  });

  test('a case marked not applicable shows that status and reason, whatever it last did; the others are untouched', () => {
    const tests = [record('PTL-08-11', 'failed', { error: 'boom' }), record('PTL-08-12', 'passed'), { ...record('PTL-08-11', 'passed'), project: 'other', key: 'other|f|PTL-08-11' }];
    const shown = applyNotApplicable(tests, { news: { 'PTL-08-11': 'The breadcrumb is the way back' } });
    expect(shown.map((test) => test.status)).toEqual(['notapplicable', 'passed', 'passed']);
    expect(shown[0]).toMatchObject({ reason: 'The breadcrumb is the way back', error: undefined, screenshots: [] });
    expect(tests[0].status).toBe('failed'); // the stored result is not changed: it comes back when the case is made applicable again
  });

  test('the summary counts them apart from every other status', () => {
    const shown = applyNotApplicable([record('A-1', 'passed'), record('A-2', 'failed')], { news: { 'A-2': 'n/a' } });
    expect(summarize(shown)).toEqual({ passed: 1, failed: 0, blocked: 0, running: 0, notRun: 0, notApplicable: 1, total: 2 });
  });
});

test.describe('What changed since the run before', () => {
  const record = (status: TestRecord['status'], extra: Partial<TestRecord> = {}): TestRecord => ({ key: 'k', caseId: 'A-01', title: 'A-01 - a case', file: 'a.spec.ts', line: 1, project: 'p', status, durationMs: 0, screenshots: [], ...extra });

  test('a new result remembers the result before it', () => {
    const [merged] = mergeRun([record('running')], [record('passed')], [record('failed')]);
    expect(merged.status).toBe('failed');
    expect(merged.previous).toBe('passed');
  });

  test('a case that was not run in between keeps the result before that', () => {
    const [merged] = mergeRun([record('running')], [record('notrun', { previous: 'failed' })], [record('passed')]);
    expect(merged.previous).toBe('failed');
  });

  test('a case run for the first time has nothing before it', () => {
    const [merged] = mergeRun([record('running')], [], [record('passed')]);
    expect(merged.previous).toBeUndefined();
  });
});
