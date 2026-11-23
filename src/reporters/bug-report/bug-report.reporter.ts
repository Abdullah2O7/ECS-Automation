import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { discoverTestPages, type TestPage } from '../../config/test-pages';
import { actualOf, expectationOf, kindOfFailure, plainText, withHintText } from '../../utils/evidence/failure-kind';
import { REPORT_FOLDER, reportFileName } from './report-file';
import { buildReport, type BlockedEntry, type BugEntry, type BugReport } from './report-document';

/**
 * At the end of a run, writes one Word file per user story that had a failed check: `<story> bug report.docx`, in
 * test-output/bug-reports. A summary page, then every bug on a page of its own (what was expected, what happened, the steps,
 * the screenshot with the problem framed), and a last page for the cases that could not reach their check - those are not
 * confirmed bugs. A story with no failure gets no file.
 *
 * Nothing here may fail the run: any problem writing the report is printed and ignored.
 */

type Outcome = { test: TestCase; result: TestResult };

const annotation = (test: TestCase, type: string): string | undefined => test.annotations.find((entry) => entry.type === type)?.description;
const sentences = (text: string | undefined): string[] => (text ? text.split(' | ').filter(Boolean) : []);

const collectSteps = (steps: readonly TestStep[], depth: number, into: BugEntry['steps']): void => {
  for (const step of steps) {
    if (step.category === 'test.step') {
      if (depth <= 1) {
        into.push({ title: step.title, failed: Boolean(step.error), depth });
      }
      collectSteps(step.steps, depth + 1, into);
    } else {
      collectSteps(step.steps, depth, into);
    }
  }
};

const shorten = (text: string, lines: number): string => plainText(text).split(/\r?\n/).slice(0, lines).join('\n').slice(0, 900);

const relative = (file: string | undefined): string | undefined => (file ? path.relative(process.cwd(), file) : undefined);

export default class BugReportReporter implements Reporter {
  private readonly outcomes = new Map<string, Outcome>();
  private pages: TestPage[] = [];
  private config?: FullConfig;

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig): void {
    this.config = config;
    try {
      this.pages = discoverTestPages();
    } catch {
      this.pages = [];
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.outcomes.set(test.id, { test, result }); // a retry replaces the attempt before it
  }

  async onEnd(): Promise<void> {
    try {
      const byStory = new Map<string, Outcome[]>();
      for (const outcome of this.outcomes.values()) {
        const page = this.pageOf(outcome.test);
        const story = page?.story || this.storyOf(outcome.test);
        if (story) {
          byStory.set(story, [...(byStory.get(story) ?? []), outcome]);
        }
      }
      mkdirSync(REPORT_FOLDER, { recursive: true });
      for (const [story, outcomes] of byStory) {
        const report = this.reportOf(story, outcomes);
        if (report.bugs.length + report.blocked.length === 0) {
          continue;
        }
        const file = path.resolve(REPORT_FOLDER, reportFileName(story));
        writeFileSync(file, await buildReport(report));
        process.stdout.write(`\nBug report: ${file}  (${report.bugs.length} bug(s)${report.blocked.length ? `, ${report.blocked.length} not completed` : ''})\n`);
      }
    } catch (error) {
      process.stdout.write(`\nThe bug report could not be written: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  private pageOf(test: TestCase): TestPage | undefined {
    const project = test.parent.project()?.name;
    return this.pages.find((page) => page.id === project);
  }

  /** The story from the case id at the start of the title (`CMS-06-16 - ...`), for a page whose folder names none. */
  private storyOf(test: TestCase): string | undefined {
    return /^([A-Z]+-\d+)-\d+\b/.exec(test.title)?.[1];
  }

  private reportOf(story: string, outcomes: readonly Outcome[]): BugReport {
    const ordered = [...outcomes].sort((a, b) => a.test.title.localeCompare(b.test.title, undefined, { numeric: true }));
    const bugs: BugEntry[] = [];
    const blocked: BlockedEntry[] = [];
    let passed = 0;
    let total = 0;
    for (const { test, result } of ordered) {
      if (result.status === 'skipped') {
        continue;
      }
      total += 1;
      if (result.status === 'passed' || test.expectedStatus === result.status) {
        passed += 1;
        continue;
      }
      const message = result.error?.message ?? 'The test failed.';
      const caseId = /^([A-Z]+-\d+-\d+)\b/.exec(test.title)?.[1] ?? test.title;
      const title = test.title.replace(/^[A-Z]+-\d+-\d+\s*-\s*/, '');
      const actual = withHintText(annotation(test, 'Actual result') ?? actualOf(message), message);
      const kind = annotation(test, 'Failure kind') ?? kindOfFailure(message);
      if (kind === 'blocked') {
        blocked.push({ caseId, title, reason: actual });
        continue;
      }
      const steps: BugEntry['steps'] = [];
      collectSteps(result.steps, 0, steps);
      const evidence =
        result.attachments.find((attachment) => attachment.name === 'bug-evidence' && attachment.path) ??
        result.attachments.find((attachment) => attachment.contentType === 'image/png' && attachment.path);
      let screenshot: Buffer | undefined;
      if (evidence?.path) {
        try {
          screenshot = readFileSync(evidence.path);
        } catch {
          screenshot = undefined;
        }
      }
      const then = sentences(annotation(test, 'Then'));
      bugs.push({
        id: `BUG-${String(bugs.length + 1).padStart(2, '0')}`,
        caseId,
        title,
        priority: Number(annotation(test, 'Priority') ?? 2),
        given: sentences(annotation(test, 'Given')),
        when: sentences(annotation(test, 'When')),
        then,
        arabic: annotation(test, 'Arabic'),
        steps,
        expected: expectationOf(message, then.join(' and ') || undefined),
        actual: actual.charAt(0).toUpperCase() + actual.slice(1),
        technical: shorten(message, 8),
        screenshot,
        video: relative(result.attachments.find((attachment) => attachment.name === 'video')?.path),
        trace: relative(result.attachments.find((attachment) => attachment.name === 'trace')?.path),
      });
    }
    const pages = [...new Set(ordered.map(({ test }) => this.pageOf(test)?.title ?? test.parent.project()?.name ?? '').filter(Boolean))];
    const first = ordered[0]?.test;
    const page = first ? this.pageOf(first) : undefined;
    const baseUrl = story.startsWith('CMS') ? process.env.CMS_BASE_URL : process.env.PORTAL_BASE_URL;
    const channel = (first?.parent.project()?.use as { channel?: string } | undefined)?.channel;
    return {
      story,
      pages,
      date: new Date(),
      applicationUrl: `${(baseUrl ?? '').replace(/\/$/, '')}${page?.path ?? ''}` || 'not configured',
      browser: channel === 'chrome' ? 'Google Chrome' : 'Chromium',
      total,
      passed,
      bugs,
      blocked,
    };
  }
}
