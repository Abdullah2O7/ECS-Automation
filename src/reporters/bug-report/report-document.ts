import { DocxBuilder, paragraph, table, type Cell } from './docx-writer';

/** One bug of the report: a test case whose check of the application failed. */
export type BugEntry = {
  /** BUG-01, BUG-02 ... in the order of the cases. */
  id: string;
  caseId: string;
  /** The scenario sentence ("Verify that ..."). */
  title: string;
  priority: number;
  given: string[];
  when: string[];
  then: string[];
  arabic?: string;
  /** The steps the test performed, as the report shows them; the one that failed is marked. */
  steps: { title: string; failed: boolean; depth: number }[];
  expected: string;
  actual: string;
  /** The error text, shortened, for whoever fixes it. */
  technical: string;
  /** The screenshot with the problem framed (PNG). */
  screenshot?: Buffer;
  /** Where the video and the trace of the case are, relative to the project folder. */
  video?: string;
  trace?: string;
};

/** A case that could not reach its check: listed apart because it is not a confirmed bug. */
export type BlockedEntry = { caseId: string; title: string; reason: string };

export type BugReport = {
  story: string;
  /** The pages (screens) of the story that ran. */
  pages: string[];
  date: Date;
  applicationUrl: string;
  browser: string;
  total: number;
  passed: number;
  bugs: BugEntry[];
  blocked: BlockedEntry[];
};

const SEVERITY: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' };
export const severityOf = (priority: number): string => SEVERITY[priority] ?? 'Medium';

const LABEL_WIDTH = 2400;
const VALUE_WIDTH = 7500;
const RED = '7F1D1D';

const labelCell = (text: string): Cell => ({ content: paragraph(text, {}, { bold: true }), width: LABEL_WIDTH, shade: 'F3F4F6' });
const valueCell = (lines: readonly string[] | string, rtl = false): Cell => ({
  content: (typeof lines === 'string' ? [lines] : lines).map((line) => paragraph(line, { rtl, spaceAfter: 40 })).join(''),
  width: VALUE_WIDTH,
});
const row = (label: string, value: readonly string[] | string, rtl = false): Cell[] => [labelCell(label), valueCell(value, rtl)];

/** The run's date and time on the machine that ran it. */
const pad = (value: number): string => String(value).padStart(2, '0');
const when = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The report of one user story: a summary page, one page per bug, and a closing page of the cases that were blocked. */
export const buildReport = async (report: BugReport): Promise<Buffer> => {
  const doc = new DocxBuilder();
  const failed = report.bugs.length + report.blocked.length;

  // ---- summary
  doc.add(paragraph(`${report.story} bug report`, { style: 'Title' }));
  doc.add(paragraph(report.pages.join(', '), {}, { color: '6B7280', size: 13 }));
  doc.add(
    table([
      row('User story', report.story),
      row('Screens tested', report.pages.join(', ')),
      row('Application', report.applicationUrl),
      row('Browser', report.browser),
      row('Run date', when(report.date)),
      row('Test cases run', `${report.total}  (passed ${report.passed}, failed ${failed})`),
      row('Bugs found', `${report.bugs.length}`),
      row('Not completed (not confirmed bugs)', `${report.blocked.length} - listed on the last page`),
    ]),
  );
  if (report.bugs.length > 0) {
    doc.add(paragraph('Bugs', { style: 'Heading2' }));
    const header: Cell[] = [
      { content: paragraph('Bug', {}, { bold: true }), width: 1100, shade: 'F3F4F6' },
      { content: paragraph('Test case', {}, { bold: true }), width: 1400, shade: 'F3F4F6' },
      { content: paragraph('Severity', {}, { bold: true }), width: 1100, shade: 'F3F4F6' },
      { content: paragraph('What is wrong', {}, { bold: true }), width: 6300, shade: 'F3F4F6' },
    ];
    doc.add(
      table([
        header,
        ...report.bugs.map((bug): Cell[] => [
          { content: paragraph(bug.id), width: 1100 },
          { content: paragraph(bug.caseId), width: 1400 },
          { content: paragraph(severityOf(bug.priority)), width: 1100 },
          { content: paragraph(bug.title), width: 6300 },
        ]),
      ]),
    );
  } else {
    doc.add(paragraph('No bugs were found in this run.', {}, { bold: true, color: '166534' }));
  }

  // ---- one page per bug
  for (const bug of report.bugs) {
    doc.add(paragraph(`${bug.id} - ${bug.caseId}`, { style: 'Heading1', pageBreakBefore: true }));
    doc.add(paragraph(bug.title, {}, { bold: true, size: 13 }));
    doc.add(
      table([
        row('Bug / test case', `${bug.id}   ·   ${bug.caseId}   ·   ${report.story}`),
        row('Severity', `${severityOf(bug.priority)}  (test case priority ${bug.priority})`),
        row('Environment', `${report.applicationUrl}   ·   ${report.browser}   ·   ${when(report.date)}`),
        row('Preconditions (Given)', bug.given),
        row('Action (When)', bug.when),
        row('Expected result (Then)', bug.then.length > 0 ? bug.then : bug.expected),
        row('Actual result', bug.actual),
        ...(bug.arabic ? [row('Arabic', bug.arabic, true)] : []),
      ]),
    );
    if (bug.steps.length > 0) {
      doc.add(paragraph('Steps to reproduce', { style: 'Heading3' }));
      bug.steps.forEach((step, index) => {
        doc.add(
          paragraph(
            [
              { text: `${index + 1}.  `, style: { bold: true } },
              { text: step.title, style: step.failed ? { bold: true, color: 'B91C1C' } : {} },
              ...(step.failed ? [{ text: '    <- failed here', style: { bold: true, color: 'B91C1C' } }] : []),
            ],
            { indent: 240 + step.depth * 360, spaceAfter: 20 },
          ),
        );
      });
    }
    if (bug.screenshot) {
      doc.add(paragraph('Screenshot - the problem is framed in red', { style: 'Heading3', keepNext: true }));
      doc.add(doc.image(bug.screenshot, 14.5, `${bug.id} screenshot`));
    }
    doc.add(paragraph('Technical detail', { style: 'Heading3' }));
    doc.add(paragraph(bug.technical, {}, { font: 'Consolas', size: 8, color: '374151' }));
    if (bug.video || bug.trace) {
      doc.add(paragraph([bug.video ? `Video: ${bug.video}` : '', bug.trace ? `Trace: ${bug.trace}` : ''].filter(Boolean).join('\n'), {}, { size: 9, color: '6B7280' }));
    }
  }

  // ---- cases that did not reach their check
  if (report.blocked.length > 0) {
    doc.add(paragraph('Cases not completed - not confirmed bugs', { style: 'Heading1', pageBreakBefore: true }));
    doc.add(paragraph('The test could not get as far as the check (a control it had to use was not found, the sign-in failed, a step timed out). These need a look - they may be a test problem or a bug - and are not counted above.', {}, { color: RED }));
    doc.add(
      table([
        [
          { content: paragraph('Test case', {}, { bold: true }), width: 1400, shade: 'F3F4F6' },
          { content: paragraph('Scenario', {}, { bold: true }), width: 4300, shade: 'F3F4F6' },
          { content: paragraph('What happened', {}, { bold: true }), width: 4200, shade: 'F3F4F6' },
        ],
        ...report.blocked.map((entry): Cell[] => [
          { content: paragraph(entry.caseId), width: 1400 },
          { content: paragraph(entry.title), width: 4300 },
          { content: paragraph(entry.reason), width: 4200 },
        ]),
      ]),
    );
  }

  return doc.toBuffer();
};
