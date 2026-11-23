import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { caseIdPattern, discoverTestPages, setNotApplicable } from '../../src/config/test-pages';

/** Builds a tests/pages-like folder: { 'news/PTL-07-x.spec.ts': '', 'news/page.json': '{...}' } */
const withPages = (files: Record<string, string>, check: (root: string) => void): void => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test.describe('Page discovery (tests/pages)', () => {
  test('a folder with a spec becomes a page, with title and story worked out from its names', () => {
    withPages({ 'news-list/PTL-07-list.spec.ts': '' }, (root) => {
      expect(discoverTestPages(root)).toEqual([{ id: 'news-list', title: 'News list', group: 'Pages', story: 'PTL-07', path: undefined, workers: 1, after: undefined, notApplicable: {} }]);
    });
  });

  test('page.json sets how the page is shown and run', () => {
    const meta = JSON.stringify({ title: 'News', group: 'Public portal', story: 'PTL-07', path: '/en/news/', workers: 3 });
    withPages({ 'news/a.spec.ts': '', 'news/page.json': meta }, (root) => {
      expect(discoverTestPages(root)[0]).toMatchObject({ id: 'news', title: 'News', group: 'Public portal', story: 'PTL-07', path: '/en/news/', workers: 3 });
    });
  });

  test('specs in sub-folders count; a folder without specs is not a page; pages come in name order', () => {
    withPages({ 'zeta/deep/x.spec.ts': '', 'alpha/y.spec.ts': '', 'empty/readme.md': '' }, (root) => {
      expect(discoverTestPages(root).map((page) => page.id)).toEqual(['alpha', 'zeta']);
    });
  });

  test('a missing folder means no pages', () => {
    expect(discoverTestPages(path.join(os.tmpdir(), 'does-not-exist-pages'))).toEqual([]);
  });

  test('a spec outside a page folder is refused, saying where to put it', () => {
    withPages({ 'loose.spec.ts': '' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('MISPLACED_SPEC');
    });
  });

  test('a broken page.json fails loudly and names the page', () => {
    withPages({ 'news/a.spec.ts': '', 'news/page.json': '{ not json' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('INVALID_PAGE_JSON:news');
    });
    withPages({ 'news/a.spec.ts': '', 'news/page.json': '{"workers": 0}' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('"workers" must be a whole number');
    });
  });

  test('`after` must name another page', () => {
    withPages({ 'b/a.spec.ts': '', 'b/page.json': '{"after":"ghost"}' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('"after" names "ghost"');
    });
    withPages({ 'a/x.spec.ts': '', 'b/y.spec.ts': '', 'b/page.json': '{"after":"a"}' }, (root) => {
      expect(discoverTestPages(root).find((page) => page.id === 'b')?.after).toBe('a');
    });
  });
});

test.describe('Not applicable test cases (tests/pages/<page>/not-applicable.json)', () => {
  test('the file lists the skipped cases with their reasons', () => {
    withPages({ 'news/a.spec.ts': '', 'news/not-applicable.json': '{"PTL-08-11": "The breadcrumb is the way back"}' }, (root) => {
      expect(discoverTestPages(root)[0].notApplicable).toEqual({ 'PTL-08-11': 'The breadcrumb is the way back' });
    });
  });

  test('a page without the file has none, and a broken file fails loudly and names the page', () => {
    withPages({ 'news/a.spec.ts': '' }, (root) => expect(discoverTestPages(root)[0].notApplicable).toEqual({}));
    withPages({ 'news/a.spec.ts': '', 'news/not-applicable.json': '{ not json' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('INVALID_NOT_APPLICABLE:news');
    });
    withPages({ 'news/a.spec.ts': '', 'news/not-applicable.json': '{"A-1": 5}' }, (root) => {
      expect(() => discoverTestPages(root)).toThrow('must look like');
    });
  });

  test('marking and restoring writes the file, keeps it sorted and removes it when empty', () => {
    withPages({ 'news/a.spec.ts': '' }, (root) => {
      const file = path.join(root, 'news', 'not-applicable.json');
      expect(setNotApplicable('news', ['PTL-08-11', 'PTL-08-2'], '  no link  ', root)).toEqual({ 'PTL-08-2': 'no link', 'PTL-08-11': 'no link' });
      expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['PTL-08-2', 'PTL-08-11']);
      expect(discoverTestPages(root)[0].notApplicable).toEqual({ 'PTL-08-2': 'no link', 'PTL-08-11': 'no link' });
      expect(setNotApplicable('news', ['PTL-08-2'], null, root)).toEqual({ 'PTL-08-11': 'no link' });
      expect(setNotApplicable('news', ['PTL-08-11'], null, root)).toEqual({});
      expect(existsSync(file)).toBe(false);
    });
  });

  test('an empty reason gets a default, and a bad page or no cases is refused', () => {
    withPages({ 'news/a.spec.ts': '' }, (root) => {
      expect(setNotApplicable('news', ['A-1'], '  ', root)).toEqual({ 'A-1': 'Not applicable' });
      expect(() => setNotApplicable('ghost', ['A-1'], 'x', root)).toThrow('UNKNOWN_PAGE');
      expect(() => setNotApplicable('../news', ['A-1'], 'x', root)).toThrow('UNKNOWN_PAGE');
      expect(() => setNotApplicable('news', [' '], 'x', root)).toThrow('NO_TEST_CASES');
    });
  });

  test('caseIdPattern matches whole case ids only, and nothing when the list is empty', () => {
    expect(caseIdPattern([])).toBeUndefined();
    const pattern = new RegExp(caseIdPattern(['PTL-07-1', 'TC01']) ?? '');
    expect(pattern.test('news pages/news/x.spec.ts PTL-07 List PTL-07-1 - Open')).toBe(true);
    expect(pattern.test('news pages/news/x.spec.ts PTL-07 List PTL-07-16 - Other')).toBe(false);
    expect(pattern.test('sign-in pages/sign-in/TC01-portal.spec.ts Portal TC02 - Other')).toBe(false);
  });
});
