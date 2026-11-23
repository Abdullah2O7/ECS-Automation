import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { casesNotBuilt, notBuiltByPage, sheetsWithoutTests, storyProblems } from '../../src/scripts/story/story-readiness';

/** A project folder with sheets in docs/test-cases and page folders with specs. */
const project = (files: Record<string, string>): string => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'stories-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
};

test.describe('A new story is shared with its tests', () => {
  test('every sheet with its tests: ready to share', () => {
    const root = project({
      'docs/test-cases/PTL-07 - List News.xlsx': 'x',
      'docs/test-cases/view about us.xlsx': 'x',
      'tests/pages/news/PTL-07-list-news.spec.ts': "test('PTL-07-01', async () => {});",
      'tests/pages/about/PTL-90-about.spec.ts': "test('PTL-90-01', async () => { test.fixme(true, 'Needs the CMS to fail'); });",
      'tests/pages/about/page.json': '{"sheet": "view about us.xlsx"}',
    });
    expect(storyProblems(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test('a sheet nobody started (npm run story:new not run) is named', () => {
    const root = project({ 'docs/test-cases/CMS-12 - Manage Events.xlsx': 'x', 'docs/test-cases/~$CMS-12 - Manage Events.xlsx': 'lock' });
    expect(sheetsWithoutTests(root).map((sheet) => path.basename(sheet))).toEqual(['CMS-12 - Manage Events.xlsx']);
    expect(storyProblems(root)).toEqual(['The sheet "CMS-12 - Manage Events.xlsx" has no tests yet: run npm run story:new in the project folder, then share again.']);
    rmSync(root, { recursive: true, force: true });
  });

  test('cases still "Not automated yet" do not stop a share - they are counted for whoever builds them', () => {
    const root = project({
      'docs/test-cases/CMS-12 - Manage Events.xlsx': 'x',
      'tests/pages/events/CMS-12-manage-events.spec.ts': "a(() => { test.fixme(true, 'Not automated yet'); });\nb(() => { test.fixme(true, 'Not automated yet'); });\nc(() => { test.fixme(true, 'A server error cannot be made'); });",
    });
    expect(casesNotBuilt(root)).toEqual([{ story: 'CMS-12', spec: 'tests/pages/events/CMS-12-manage-events.spec.ts', count: 2 }]);
    expect(storyProblems(root)).toEqual([]);
    expect(notBuiltByPage(root)).toEqual({ events: 2 });
    rmSync(root, { recursive: true, force: true });
  });
});
