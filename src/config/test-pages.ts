import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The pages under test, found from the folders of tests/pages - nothing is registered by hand.
 *
 *   tests/pages/<page>/*.spec.ts   the test cases of one page (a folder = a Playwright project = a dashboard page)
 *   tests/pages/<page>/page.json   optional: how the page is shown and run
 *
 * page.json (every key optional):
 *   title    what the dashboard shows              default: the folder name as words ("news-list" -> "News list")
 *   group    the dashboard's sidebar group          default: "Pages"
 *   story    the user story / test sheet            default: the id at the start of a spec file name ("PTL-07-...")
 *   path     where the page lives in the app        default: none
 *   workers  tests of this page run side by side    default: 1 (raise it only when the tests do not depend on each other)
 *   after    another page's folder to run first, and to skip this page when that one fails
 *
 * not-applicable.json (optional, written by the dashboard's "Mark not applicable"): the test cases of this page that are
 * skipped, with the reason - {"PTL-08-11": "The breadcrumb is the way back"}. Delete a line (or use "Make applicable
 * again" on the dashboard) to run the case again.
 *
 * Used by playwright.config.ts and by the dashboard, so they cannot disagree. Plain Node: no Playwright, no project imports.
 */
export type TestPage = {
  /** The folder name; also the Playwright project name (`npx playwright test --project=<id>`). */
  id: string;
  title: string;
  group: string;
  story: string;
  path?: string;
  /** The story's sheet in docs/test-cases, when its file name does not start with the story id ("view about us.xlsx"). */
  sheet?: string;
  workers: number;
  after?: string;
  /** Test cases that are skipped: case id -> why. */
  notApplicable: Record<string, string>;
};

export const PAGES_FOLDER = 'tests/pages';
export const NOT_APPLICABLE_FILE = 'not-applicable.json';
const SPEC = /\.spec\.ts$/;

type Metadata = Partial<Pick<TestPage, 'title' | 'group' | 'story' | 'path' | 'after' | 'sheet'>> & { workers?: number };

const words = (folder: string): string => {
  const text = folder.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const hasSpec = (folder: string): boolean =>
  readdirSync(folder, { withFileTypes: true }).some((entry) => (entry.isDirectory() ? hasSpec(path.join(folder, entry.name)) : SPEC.test(entry.name)));

const firstStoryId = (folder: string): string => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const id = /^([A-Z]+-?\d+)\b/.exec(entry.name)?.[1];
    if (entry.isFile() && SPEC.test(entry.name) && id) {
      return id;
    }
  }
  return '';
};

const readMetadata = (folder: string, id: string): Metadata => {
  const file = path.join(folder, 'page.json');
  if (!existsSync(file)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`INVALID_PAGE_JSON:${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`INVALID_PAGE_JSON:${id}: page.json must be an object like {"title": "News list"}.`);
  }
  const data = parsed as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const value = data[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`INVALID_PAGE_JSON:${id}: "${key}" must be a non-empty text.`);
    }
    return value.trim();
  };
  const workers = data.workers;
  if (workers !== undefined && (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 1)) {
    throw new Error(`INVALID_PAGE_JSON:${id}: "workers" must be a whole number of 1 or more.`);
  }
  return { title: text('title'), group: text('group'), story: text('story'), path: text('path'), after: text('after'), sheet: text('sheet'), workers };
};

const readNotApplicable = (folder: string, id: string): Record<string, string> => {
  const file = path.join(folder, NOT_APPLICABLE_FILE);
  if (!existsSync(file)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`INVALID_NOT_APPLICABLE:${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.values(parsed).some((reason) => typeof reason !== 'string')) {
    throw new Error(`INVALID_NOT_APPLICABLE:${id}: ${NOT_APPLICABLE_FILE} must look like {"PTL-08-11": "the reason"}.`);
  }
  return parsed as Record<string, string>;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A regular expression (as text) matching the tests with these case ids - for Playwright's `--grep` / `grepInvert`.
 * Playwright matches it against project, file, suite and test title joined by spaces, so the id must stand between
 * spaces: `PTL-07-1` does not match `PTL-07-16`, and `TC01` does not match the file `TC01-portal-sessions.spec.ts`.
 */
export const caseIdPattern = (ids: readonly string[]): string | undefined =>
  ids.length === 0 ? undefined : `(?<![^\\s])(?:${ids.map(escapeRegExp).join('|')})(?![^\\s])`;

/**
 * Marks test cases of a page not applicable (`reason` is the text shown for them), or applicable again (`reason` null).
 * Writes tests/pages/<page>/not-applicable.json and returns its new content; the file is removed when it becomes empty.
 */
export const setNotApplicable = (pageId: string, caseIds: readonly string[], reason: string | null, root: string = path.resolve(PAGES_FOLDER)): Record<string, string> => {
  const folder = path.join(root, pageId);
  if (path.basename(pageId) !== pageId || !existsSync(folder)) {
    throw new Error(`UNKNOWN_PAGE:${pageId}: there is no such folder in ${PAGES_FOLDER}.`);
  }
  const ids = caseIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('NO_TEST_CASES: select at least one test case.');
  }
  const current = readNotApplicable(folder, pageId);
  for (const id of ids) {
    if (reason === null) {
      delete current[id];
    } else {
      current[id] = reason.trim() || 'Not applicable';
    }
  }
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  const file = path.join(folder, NOT_APPLICABLE_FILE);
  if (Object.keys(sorted).length === 0) {
    rmSync(file, { force: true });
  } else {
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
  return sorted;
};

/** Every folder of `root` that holds a spec file, in name order. A spec directly in `root` is refused: it would never run. */
export const discoverTestPages = (root: string = path.resolve(PAGES_FOLDER)): TestPage[] => {
  if (!existsSync(root)) {
    return [];
  }
  const entries = readdirSync(root, { withFileTypes: true });
  const loose = entries.find((entry) => entry.isFile() && SPEC.test(entry.name));
  if (loose) {
    throw new Error(`MISPLACED_SPEC:${PAGES_FOLDER}/${loose.name}: put it in a folder named after its page, e.g. ${PAGES_FOLDER}/news/${loose.name}`);
  }
  const pages = entries
    .filter((entry) => entry.isDirectory() && hasSpec(path.join(root, entry.name)))
    .map((entry): TestPage => {
      const folder = path.join(root, entry.name);
      const meta = readMetadata(folder, entry.name);
      return {
        id: entry.name,
        title: meta.title ?? words(entry.name),
        group: meta.group ?? 'Pages',
        story: meta.story ?? firstStoryId(folder),
        path: meta.path,
        ...(meta.sheet ? { sheet: meta.sheet } : {}),
        workers: meta.workers ?? 1,
        after: meta.after,
        notApplicable: readNotApplicable(folder, entry.name),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    if (page.after && !ids.has(page.after)) {
      throw new Error(`INVALID_PAGE_JSON:${page.id}: "after" names "${page.after}", which is not a page folder (${[...ids].join(', ')}).`);
    }
  }
  return pages;
};
