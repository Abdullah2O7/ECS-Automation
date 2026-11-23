import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The reviewer's verdict on a case, given on the dashboard (the "Your verdict" list next to each case) and kept in
 * tests/pages/<page>/review.json: the result the case SHOULD give - passed, failed (a real bug) or blocked - and why
 * ("the maximum was changed to 200"). Not applicable is not a verdict: it goes to not-applicable.json at once.
 *
 * Claude reads these files before working on a page and before handing over a run: it changes the test, its data or its
 * hint so the case gives that result, runs the case, and writes what it changed under `done`. A new verdict on the same
 * case replaces the old one (and its `done`).
 *
 *   { "CMS-90-12": { "expected": "passed", "note": "the maximum is now 200", "at": "2026-10-17T16:00:00.000Z",
 *                    "result": "failed: Error: ...", "done": { "at": "...", "note": "the limit in about-page.data.ts is 200" } } }
 */
export const REVIEW_FILE = 'review.json';

/** What a case should give. */
export type ExpectedResult = 'passed' | 'failed' | 'blocked';
export const EXPECTED_RESULTS: readonly ExpectedResult[] = ['passed', 'failed', 'blocked'];

export type Review = {
  expected: ExpectedResult;
  /** Why - what changed, what the case should check instead. */
  note: string;
  at: string;
  /** What the case gave when the verdict was given. */
  result?: string;
  /** What Claude changed for it (written by Claude). */
  done?: { at: string; note: string };
};

const isReview = (value: unknown): value is Review => {
  const review = value as Review;
  return typeof value === 'object' && value !== null && EXPECTED_RESULTS.includes(review.expected) && typeof review.note === 'string' && typeof review.at === 'string';
};

/** The reviews of a page folder; a missing or unreadable file means none (reviews never stop a run). */
export const readReviews = (folder: string): Record<string, Review> => {
  const file = path.join(folder, REVIEW_FILE);
  if (!existsSync(file)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed).filter(([, review]) => isReview(review))) as Record<string, Review>;
  } catch {
    return {};
  }
};

/** Records (or with `review` null removes) a case's verdict in its page's review.json; returns the page's reviews. */
export const setReview = (
  folder: string,
  caseId: string,
  review: { expected: ExpectedResult; note: string; result?: string } | null,
  now: Date = new Date(),
): Record<string, Review> => {
  if (!existsSync(folder)) {
    throw new Error(`UNKNOWN_PAGE: ${path.basename(folder)}`);
  }
  const id = caseId.trim();
  if (!id) {
    throw new Error('NO_TEST_CASE: say which test case');
  }
  if (review && !EXPECTED_RESULTS.includes(review.expected)) {
    throw new Error(`INVALID_VERDICT: ${String(review.expected)} - a case should be passed, failed or blocked`);
  }
  if (review && !review.note.trim()) {
    throw new Error('NO_REASON: say why the case should give this result');
  }
  const current = readReviews(folder);
  if (review === null) {
    delete current[id];
  } else {
    current[id] = { expected: review.expected, note: review.note.trim().slice(0, 1000), at: now.toISOString(), ...(review.result ? { result: review.result.slice(0, 600) } : {}) };
  }
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  const file = path.join(folder, REVIEW_FILE);
  if (Object.keys(sorted).length === 0) {
    rmSync(file, { force: true });
  } else {
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return sorted;
};
