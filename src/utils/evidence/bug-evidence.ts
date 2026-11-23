import type { Locator, Page, TestInfo } from '@playwright/test';
import { logger } from '../logger/logger';
import { contextFocus, failedFocus } from './failure-focus';
import { actualOf, expectationOf, kindOfFailure, withHintText, type FailureKind } from './failure-kind';

/**
 * The screenshot of a failed test case, made for a bug report: the screen as it was at the moment of the failure, with
 *   - a red frame around the error the system shows (a failed-save message, a validation message), or around the element
 *     that is wrong, or - when something expected is missing - a dashed frame where it should be;
 *   - a banner with what was expected (the sheet's Then) and what the system did instead.
 * It is attached to the test as `bug-evidence`; the bug report (src/reporters/bug-report) puts it on the bug's page.
 * Nothing here may break a test run: every failure to draw or capture is logged and ignored.
 */
export const EVIDENCE_ATTACHMENT = 'bug-evidence';
const KIND_ANNOTATION = 'Failure kind';
const ACTUAL_ANNOTATION = 'Actual result';

type Frame = { x: number; y: number; width: number; height: number; label: string; style: 'error' | 'wrong' | 'missing' };

/** What the system shows when something went wrong: its pop-up messages and the validation messages under the fields. */
const ERROR_SELECTORS = [
  'uui-toast-notification[color="danger"]',
  'uui-toast-notification[look="danger"]',
  '[role="alert"]',
  'umb-form-validation-message #messages',
  'uui-form-validation-message',
  '[aria-invalid="true"]',
  '.error, .invalid, [class*="error-message"]',
];

const MAX_FRAMES = 4;

/** The box of an element on the screen. With `scroll` the page is first scrolled so the element is in view; without it, an element out of view has no box. */
const boxOf = async (locator: Locator, scroll = true): Promise<Omit<Frame, 'label' | 'style'> | undefined> => {
  try {
    const first = locator.first();
    if ((await first.count()) === 0) {
      return undefined;
    }
    if (scroll) {
      // In the middle of the screen, so the element and what is around it are all in the picture
      await first.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => undefined);
    }
    const box = await first.boundingBox({ timeout: 2_000 });
    return box && box.width > 2 && box.height > 2 ? box : undefined;
  } catch {
    return undefined;
  }
};

const inView = (box: Omit<Frame, 'label' | 'style'>, page: Page): boolean => {
  const view = page.viewportSize();
  return !view || (box.y + box.height > 0 && box.y < view.height && box.x + box.width > 0 && box.x < view.width);
};

/**
 * The frames to draw, most useful first. The screen is scrolled to the element the failure is about (the field under test), and
 * only then is anything else measured, so every frame sits where it is drawn.
 *  - bug:     the element the check was about, and the errors that belong to it - or, if it is missing, where it should have been
 *             and every error the system does show.
 *  - blocked: the test could not get to its check. No error of the application is framed (it is not the problem): only the
 *             place where the test got stuck.
 */
const framesFor = async (page: Page, kind: FailureKind): Promise<Frame[]> => {
  const frames: Frame[] = [];
  const failed = failedFocus();
  const found = failed?.locator ? await boxOf(failed.locator) : undefined;
  if (failed) {
    failed.found = Boolean(found);
  }

  if (failed?.locator && found) {
    frames.push({ ...found, label: kind === 'blocked' ? `STUCK HERE: ${failed.what}`.slice(0, 90) : failed.what.length > 60 ? 'WRONG HERE' : `WRONG: ${failed.what}`, style: kind === 'blocked' ? 'missing' : 'wrong' });
  } else if (failed?.area) {
    const box = await boxOf(failed.area);
    if (box) {
      frames.push({ ...box, label: kind === 'blocked' ? `STUCK HERE: ${failed.what}`.slice(0, 90) : `EXPECTED HERE, NOT FOUND: ${failed.what}`.slice(0, 90), style: 'missing' });
    }
  }

  if (kind === 'bug') {
    const scope = failed?.locator && found ? failed.locator : page.locator('body');
    for (const selector of ERROR_SELECTORS) {
      for (const element of await scope.locator(selector).filter({ hasText: /\S/ }).all().catch(() => [])) {
        const box = await boxOf(element, false);
        if (box && inView(box, page) && frames.length < MAX_FRAMES) {
          frames.push({ ...box, label: 'ERROR SHOWN', style: 'error' });
        }
      }
    }
  }

  if (frames.length === 0) {
    const where = contextFocus();
    const box = where?.locator ? await boxOf(where.locator) : undefined;
    if (box) {
      frames.push({ ...box, label: `CHECKED HERE: ${where?.what ?? ''}`.slice(0, 90), style: 'wrong' });
    }
  }
  if (frames.length === 0) {
    const box = await boxOf(page.getByRole('main'), false);
    if (box) {
      frames.push({ ...box, label: 'SCREEN AT THE FAILURE', style: 'missing' });
    }
  }
  return frames;
};

const clip = (text: string, length: number): string => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** Draws the frames and the banner over the page, in the browser's top layer so even an open dialog does not hide them. */
const draw = (page: Page, frames: readonly Frame[], banner: { head: string; title: string; expected: string; actual: string }): Promise<void> =>
  page.evaluate(
    ({ frames: boxes, banner: text }) => {
      document.getElementById('__bug_evidence')?.remove();
      const root = document.createElement('div');
      root.id = '__bug_evidence';
      root.setAttribute('popover', 'manual');
      root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;';
      const colours = { error: '#e11d48', wrong: '#e11d48', missing: '#f97316' } as const;
      for (const box of boxes) {
        const colour = colours[box.style];
        const frame = document.createElement('div');
        frame.style.cssText = `position:fixed;left:${box.x - 4}px;top:${box.y - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;box-sizing:border-box;border:4px ${box.style === 'missing' ? 'dashed' : 'solid'} ${colour};border-radius:6px;box-shadow:0 0 0 2px rgba(255,255,255,.85);`;
        const tag = document.createElement('div');
        tag.textContent = box.label;
        const above = box.y > 34;
        tag.style.cssText = `position:absolute;left:-4px;${above ? 'bottom:100%;margin-bottom:2px' : 'top:100%;margin-top:2px'};background:${colour};color:#fff;font:700 12px/1 Segoe UI,Arial,sans-serif;padding:4px 7px;border-radius:4px;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;`;
        frame.append(tag);
        root.append(frame);
      }
      const lowest = Math.max(0, ...boxes.map((box) => box.y + box.height));
      const atTop = lowest > window.innerHeight - 170;
      const note = document.createElement('div');
      note.style.cssText = `position:fixed;left:12px;right:12px;${atTop ? 'top:12px' : 'bottom:12px'};background:rgba(127,29,29,.96);color:#fff;font:14px/1.45 Segoe UI,Arial,sans-serif;padding:10px 14px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.35);`;
      for (const [head, value] of [[text.head, text.title], ['Expected', text.expected], ['Actual', text.actual]] as const) {
        const line = document.createElement('div');
        const bold = document.createElement('b');
        bold.textContent = `${head}:  `;
        bold.style.color = '#fecaca';
        line.append(bold, document.createTextNode(value));
        note.append(line);
      }
      root.append(note);
      document.body.append(root);
      (root as HTMLElement & { showPopover?: () => void }).showPopover?.();
    },
    { frames, banner },
  );

/** Called when a test ends: for a failed one, frames the problem and attaches the screenshot. Never throws. */
export const captureBugEvidence = async (page: Page, testInfo: TestInfo): Promise<void> => {
  if (testInfo.status === testInfo.expectedStatus || testInfo.status === 'skipped' || page.isClosed()) {
    return;
  }
  try {
    const message = testInfo.error?.message ?? 'The test failed.';
    const then = testInfo.annotations.find((annotation) => annotation.type === 'Then')?.description?.split(' | ').join(' and ');
    const kind = kindOfFailure(message);
    const expected = expectationOf(message, then);
    const actual = withHintText(actualOf(message), message);
    testInfo.annotations.push({ type: KIND_ANNOTATION, description: kind }, { type: ACTUAL_ANNOTATION, description: actual });

    const frames = await framesFor(page, kind);
    await draw(page, frames, {
      head: kind === 'blocked' ? 'NOT COMPLETED' : 'BUG',
      title: clip(testInfo.title, 150),
      expected: clip(expected, 220),
      actual: clip(kind === 'blocked' ? `${actual} (not a confirmed bug)` : actual, 220),
    });
    const path = testInfo.outputPath('bug-evidence.png');
    await page.screenshot({ path, timeout: 10_000 });
    await testInfo.attach(EVIDENCE_ATTACHMENT, { path, contentType: 'image/png' });
  } catch (error) {
    logger.warn(`The failure screenshot could not be made: ${error instanceof Error ? error.message : String(error)}`);
  }
};
