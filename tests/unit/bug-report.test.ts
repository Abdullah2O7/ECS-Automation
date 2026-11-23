import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { buildReport, type BugEntry, type BugReport } from '../../src/reporters/bug-report/report-document';
import { actualOf, kindOfFailure } from '../../src/utils/evidence/failure-kind';
import { reportFileName } from '../../src/reporters/bug-report/report-file';
import { asSetup } from '../../src/utils/core/setup-step';

// A 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const bug = (number: number): BugEntry => ({
  id: `BUG-0${number}`,
  caseId: `CMS-06-0${number}`,
  title: `Verify that something & <more> works ${number}`,
  priority: 1,
  given: ['A user is on the form'],
  when: ['The user saves'],
  then: ['The system shows the error'],
  arabic: 'التحقق من',
  steps: [
    { title: 'Given A user is on the form', failed: false, depth: 0 },
    { title: 'Click Save', failed: true, depth: 1 },
  ],
  expected: 'The system shows the error',
  actual: 'It is not on the page',
  technical: 'expect(locator).toBeVisible() failed',
  screenshot: PNG,
});

const report = (bugs: BugEntry[], blocked: BugReport['blocked'] = []): BugReport => ({
  story: 'CMS-06',
  pages: ['Manage news'],
  date: new Date('2026-10-15T12:00:00Z'),
  applicationUrl: 'https://example.test/umbraco/',
  browser: 'Google Chrome',
  total: 10,
  passed: 10 - bugs.length - blocked.length,
  bugs,
  blocked,
});

const documentXml = async (data: Buffer): Promise<string> => {
  const zip = await JSZip.loadAsync(data);
  return zip.file('word/document.xml')!.async('string');
};

test.describe('Bug report document', () => {
  test('every bug starts on a page of its own, and the blocked cases on a last page', async () => {
    const xml = await documentXml(await buildReport(report([bug(1), bug(2), bug(3)], [{ caseId: 'CMS-06-09', title: 'x', reason: 'timed out' }])));
    expect(xml.match(/<w:pageBreakBefore\/>/g)).toHaveLength(4);
    expect(xml.match(/BUG-0[123] - CMS-06-0[123]/g)).toHaveLength(3);
  });

  test('carries the screenshot, escapes the text and has no blocked page when nothing was blocked', async () => {
    const data = await buildReport(report([bug(1)]));
    const zip = await JSZip.loadAsync(data);
    expect(Object.keys(zip.files)).toContain('word/media/image1.png');
    const xml = await documentXml(data);
    expect(xml).toContain('something &amp; &lt;more&gt; works 1');
    expect(xml).not.toContain('Cases not completed');
    expect(xml).toContain('<w:rtl/>');
  });

  test('a run without bugs says so', async () => {
    expect(await documentXml(await buildReport(report([])))).toContain('No bugs were found in this run.');
  });
});

test.describe('Failure kind', () => {
  test('a failed check is a bug, a step that could not run is not', () => {
    expect(kindOfFailure('Error: the list should have a Status filter\n\nexpect(locator).toBeVisible() failed\n\nExpected: visible\nError: element(s) not found')).toBe('bug');
    expect(kindOfFailure('TimeoutError: locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator(...)')).toBe('blocked');
    expect(kindOfFailure('Error: LOGIN_DID_NOT_COMPLETE_AFTER_RETRY:cms: attempt 1 failed')).toBe('blocked');
    expect(kindOfFailure('Error: ACTION_NOT_AVAILABLE: the Actions menu has no entry matching /archive/i')).toBe('bug');
  });

  test('says in plain words what the system did instead', () => {
    expect(actualOf('Error: x\n\nexpect(locator).toBeVisible() failed\n\nLocator: a\nExpected: visible\nError: element(s) not found')).toBe('it is not on the page (nothing matching was found)');
    expect(actualOf('Error: title\n\nexpect(received).toBe(expected)\n\nExpected: 100\nReceived: 200')).toBe('expected 100, but the system shows 200');
  });
});

test.describe('report file and setup steps', () => {
  test('names the bug report after the user story', () => {
    expect(reportFileName('CMS-06')).toBe('CMS-06 bug report.docx');
  });

  test('a failed preparation step is "blocked", never a bug of the feature under test', async () => {
    const failure = await asSetup('choose a category', () => Promise.reject(new Error('expect(locator).toBeVisible() failed\nExpected: visible'))).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(kindOfFailure((failure as Error).message)).toBe('blocked');
  });
});
