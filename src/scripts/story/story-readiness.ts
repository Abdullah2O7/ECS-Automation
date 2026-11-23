import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { SHEETS_FOLDER, storyOfSheet } from './story-sheet.ts';

/**
 * Whether the user stories are ready to share with the team. A new sheet is shared with its page: whoever adds a sheet to
 * docs/test-cases also runs npm run story:new, so the story is on the dashboard for everyone - "Share my work" and the
 * GitHub checks refuse a sheet without its tests. Its cases may still be "Not automated yet": not everyone works with
 * Claude, so a teammate who does builds them later (the dashboard counts them on the page).
 */

/** What npm run story:new puts in a case until its test is written. */
export const NOT_AUTOMATED = 'Not automated yet';
const NOT_BUILT_CASE = new RegExp(`test\\.fixme\\(\\s*true\\s*,\\s*'${NOT_AUTOMATED}'\\s*\\)`, 'g');

const pagesOf = (root: string): string => path.join(root, 'tests', 'pages');
const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).map((name) => path.join(dir, name)).filter((entry) => statSync(entry).isDirectory()) : []);
const sheetsIn = (root: string): string[] => {
  const folder = path.join(root, SHEETS_FOLDER);
  return existsSync(folder) ? readdirSync(folder).filter((file) => file.toLowerCase().endsWith('.xlsx') && !file.startsWith('~$')) : [];
};

/** Story ids that already have tests (a spec named "<STORY>-..." in any page folder). */
export const storiesWithTests = (root: string = process.cwd()): Set<string> =>
  new Set(folders(pagesOf(root)).flatMap((dir) => readdirSync(dir).filter((file) => file.endsWith('.spec.ts')).map((file) => storyOfSheet(file)).filter((story): story is string => Boolean(story))));

/** The sheet files the pages name in their page.json ("sheet"), for sheets whose name has no story id - lower case. */
const sheetsWithTests = (root: string = process.cwd()): Set<string> => {
  const found = new Set<string>();
  for (const dir of folders(pagesOf(root))) {
    try {
      const sheet = (JSON.parse(readFileSync(path.join(dir, 'page.json'), 'utf8')) as { sheet?: unknown }).sheet;
      if (typeof sheet === 'string') {
        found.add(sheet.toLowerCase());
      }
    } catch {
      // no page.json, or not one of ours: nothing named
    }
  }
  return found;
};

/** The sheets in docs/test-cases whose story has no tests yet (full paths) - with a story id in the name or without one. */
export const sheetsWithoutTests = (root: string = process.cwd()): string[] => {
  const done = storiesWithTests(root);
  const named = sheetsWithTests(root);
  return sheetsIn(root)
    .filter((file) => {
      // A page names its sheet in page.json when the story's id is not the sheet's (a stand-in, or a name read differently)
      const story = storyOfSheet(file);
      return !named.has(file.toLowerCase()) && (!story || !done.has(story));
    })
    .map((file) => path.join(root, SHEETS_FOLDER, file));
};

export type NotBuilt = { story: string; spec: string; count: number };

/** The specs with cases still "Not automated yet": the story was started but its cases are not written. */
export const casesNotBuilt = (root: string = process.cwd()): NotBuilt[] =>
  folders(pagesOf(root)).flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.spec.ts'))
      .map((file) => ({ story: storyOfSheet(file) ?? file, spec: path.relative(root, path.join(dir, file)).split(path.sep).join('/'), count: (readFileSync(path.join(dir, file), 'utf8').match(NOT_BUILT_CASE) ?? []).length }))
      .filter((spec) => spec.count > 0),
  );

/** What stops a share, in plain words (one line each): sheets without their tests. Empty when every sheet has them. */
export const storyProblems = (root: string = process.cwd()): string[] =>
  sheetsWithoutTests(root).map((sheet) => `The sheet "${path.basename(sheet)}" has no tests yet: run npm run story:new in the project folder, then share again.`);

/** The cases not built yet, per page folder (tests/pages/<folder>): what the dashboard shows as waiting for Claude. */
export const notBuiltByPage = (root: string = process.cwd()): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const { spec, count } of casesNotBuilt(root)) {
    const folder = spec.split('/')[2];
    counts[folder] = (counts[folder] ?? 0) + count;
  }
  return counts;
};
