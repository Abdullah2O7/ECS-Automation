import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverTestPages, PAGES_FOLDER } from '../../src/config/test-pages';
import { parseScenario } from '../../src/utils/core/gherkin';
import { caseIdOf, findStorySheet, readStorySheet, SHEETS_FOLDER, storyOfSheet } from '../../src/scripts/story/story-sheet';

/**
 * Every spec says exactly what its Excel sheet says: the same cases, in the same order, with the same priority, Given,
 * When and Then. A case that was dropped, renumbered, or whose expected result was edited in the spec fails here -
 * before a run reports a result against the wrong expectation.
 * A story whose sheet is not in docs/test-cases is skipped with a note (put the sheet there to have it checked).
 */

// A case id in quotes followed by its pasted sheet text, as written in the specs: scenario('PTL-07-01', `...`) or, for cases
// that share one test body, a table row ['PTL-07-03', 'title', `...`].
const PASTED_CASE = /'([A-Z]+-\d+-\d+)'\s*,(?:\s*'[^'`]*'\s*,)*\s*`([\s\S]*?)`/g;

/** The scenarios pasted into the specs of a page folder, in file order. */
const scenariosInSpecs = (folder: string): { id: string; text: string }[] =>
  readdirSync(folder)
    .filter((file) => file.endsWith('.spec.ts'))
    .sort()
    .flatMap((file) => [...readFileSync(path.join(folder, file), 'utf8').matchAll(PASTED_CASE)].map(([, id, text]) => ({ id, text })));

test.describe('Specs match their story sheets (docs/test-cases)', () => {
  test('a sheet file name gives its story id', () => {
    expect(storyOfSheet('CMS-06 - Manage News Articles.xlsx')).toBe('CMS-06');
    expect(storyOfSheet('docs/test-cases/PTL-07 - List News Articles.xlsx')).toBe('PTL-07');
    expect(storyOfSheet('CR-01_-_View_Ad_Banners_on_Portal_V2.xlsx')).toBe('CR-01');
    expect(storyOfSheet('PTL-12.xlsx')).toBe('PTL-12');
    expect(storyOfSheet('PTL-1234abc.xlsx')).toBeUndefined();
    expect(storyOfSheet('notes.xlsx')).toBeUndefined();
    expect(caseIdOf('PTL-07', 3)).toBe('PTL-07-03');
  });

  for (const page of discoverTestPages()) {
    test(`${page.story} (${page.id}): every case of the sheet is in the spec, word for word`, async () => {
      // A sheet named without its story id is named in page.json ("sheet")
      const sheet = page.sheet ? path.resolve(SHEETS_FOLDER, page.sheet) : findStorySheet(page.story);
      test.skip(!sheet, `the sheet of ${page.story} is not in docs/test-cases - copy it there so its spec is checked`);
      if (!sheet) {
        return;
      }
      const fromSheet = (await readStorySheet(sheet)).map((cell, index) => parseScenario(cell, caseIdOf(page.story, index + 1)));
      const fromSpec = scenariosInSpecs(path.resolve(PAGES_FOLDER, page.id)).filter(({ id }) => id.startsWith(`${page.story}-`));

      expect(fromSpec.map(({ id }) => id), 'the spec has the sheet\'s case ids, in order').toEqual(fromSheet.map((_, index) => caseIdOf(page.story, index + 1)));
      for (const [index, { id, text }] of fromSpec.entries()) {
        expect(parseScenario(text, id), `${id} is pasted as the sheet has it`).toEqual(fromSheet[index]);
      }
    });
  }
});
