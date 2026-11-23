import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseScenario } from '../../utils/core/gherkin.ts';
import { mentionsStatusCode, standingNotApplicable } from '../../domain/standing-rules.ts';
import { NOT_APPLICABLE_FILE } from '../../config/test-pages.ts';
import { caseIdOf, findStorySheet, readStorySheet, SHEETS_FOLDER, storyOfSheet } from './story-sheet.ts';
import { NOT_AUTOMATED, sheetsWithoutTests, storiesWithTests } from './story-readiness.ts';

/**
 * Starts the tests of a new user story from its Excel sheet, so no test case is missed or retyped.
 *
 *   1. Put the sheets in docs/test-cases/ (each name starts with the story id: "PTL-09 - Events.xlsx").
 *   2. npm run story:new
 *
 * Every new sheet in docs/test-cases (one whose story has no tests yet) is added. To add only one:
 *   npm run story:new -- PTL-09
 * Optional: --page <folder> --title "<title>" --group "<group>" --path "<url path>" --back-office (CMS-* stories are back office anyway).
 *
 * Writes tests/pages/<page>/page.json and tests/pages/<page>/<STORY>-<name>.spec.ts with every scenario of the sheet pasted
 * as it is, in the sheet's order. Each case starts as `test.fixme('Not automated yet')`; the dashboard shows it as blocked
 * until its code is written. Then prints the case list, the starting point of the case plan (docs/NEW_USER_STORY.md).
 * Never overwrites: a page folder that already has a spec for the story is left alone.
 */

type Options = { sheet: string; story: string; page: string; title?: string; group?: string; path?: string; backOffice: boolean };

/** Not a failure: there is simply no new sheet to add. */
class NothingToDo extends Error {}

/** The sheets in docs/test-cases whose story has no tests yet - with a story id in the name or without one. */
const newSheets = (): string[] => sheetsWithoutTests();

/** A sheet is about the back office when its story is CMS-… or its name says "Manage …"; otherwise it is the public portal. */
const isBackOffice = (sheet: string, story: string): boolean => story.startsWith('CMS') || /\bmanage\b/i.test(nameOf(sheet));

/**
 * The story id of a sheet: the one its name starts with, or - for a sheet named without one ("view about us.xlsx") - a
 * stand-in from 90 up (PTL-90, CMS-90 ...) that no other story uses. Renaming the sheet with its real id later is fine.
 */
const storyFor = (sheet: string, taken: Set<string>): { story: string; assigned: boolean } => {
  const own = storyOfSheet(sheet);
  if (own) {
    return { story: own, assigned: false };
  }
  const prefix = isBackOffice(sheet, '') ? 'CMS' : 'PTL';
  for (let number = 90; number < 1000; number += 1) {
    const story = `${prefix}-${number}`;
    if (!taken.has(story)) {
      taken.add(story);
      return { story, assigned: true };
    }
  }
  throw new Error(`NO_STORY_ID: ${path.basename(sheet)} - give the sheet a name that starts with its story id`);
};

/** Which sheets: a path or a story id ("PTL-09") names one; nothing given means every new sheet in docs/test-cases. */
const pickSheets = (given: string | undefined): string[] => {
  if (given?.toLowerCase().endsWith('.xlsx')) {
    return [path.resolve(given)];
  }
  if (given) {
    const sheet = findStorySheet(given);
    if (!sheet) {
      throw new Error(`MISSING_FILE: no sheet for ${given} in ${SHEETS_FOLDER}/ - put "${given.toUpperCase()} - <name>.xlsx" there first`);
    }
    return [sheet];
  }
  const candidates = newSheets();
  if (candidates.length === 0) {
    const done = [...storiesWithTests()].sort().join(', ');
    throw new NothingToDo(`Nothing new to add: every sheet in ${SHEETS_FOLDER}/ already has its tests (${done || 'none yet'}).\n  For a new story, put its Excel file there (its name starts with the story id, e.g. "PTL-09 - Events.xlsx") and run npm run story:new again.`);
  }
  return candidates;
};

/** One Options per sheet to add. --page / --title / --group / --path apply when a single sheet is named. */
const parseArgs = (args: readonly string[]): Options[] => {
  const value = (flag: string): string | undefined => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const flagValues = new Set(['--page', '--title', '--group', '--path'].map(value));
  const positional = args.find((arg, index) => !arg.startsWith('--') && !flagValues.has(arg) && !(index > 0 && args[index - 1].startsWith('--') && args[index - 1] !== '--back-office'));
  const sheets = pickSheets(positional);
  const single = sheets.length === 1;
  const sheetsFolder = path.resolve(SHEETS_FOLDER);
  const taken = new Set([...storiesWithTests(), ...(existsSync(sheetsFolder) ? readdirSync(sheetsFolder).map((file) => storyOfSheet(file)).filter((id): id is string => Boolean(id)) : [])]);
  return sheets.map((sheet) => {
    const { story } = storyFor(sheet, taken);
    const backOffice = args.includes('--back-office') || isBackOffice(sheet, story);
    const page = (single ? value('--page') : undefined) ?? `${backOffice && !slugOf(sheet).startsWith('cms') ? 'cms-' : ''}${slugOf(sheet)}`;
    if (!/^[a-z0-9-]+$/.test(page)) {
      throw new Error(`INVALID_ARGUMENT: --page "${page}" - use lower case words joined by "-", e.g. news-events`);
    }
    return { sheet, story, page, title: single ? value('--title') : undefined, group: single ? value('--group') : undefined, path: single ? value('--path') : undefined, backOffice };
  });
};

/** "PTL-09 - View Events.xlsx" -> "view-events" */
const slugOf = (sheet: string): string =>
  nameOf(sheet).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cases';

/**
 * "CMS-07 - Manage News Categories V3.xlsx" -> "Manage News Categories", "view about us.xlsx" -> "View About Us": the story id,
 * a version mark ("V3") and "TCs" / "TC 1" / "test cases" at the end left out; a name written all in lower case gets capitals.
 */
const nameOf = (sheet: string): string => {
  let name = path.basename(sheet, '.xlsx').replace(/^[A-Z]+-\d+\s*-?\s*/i, '').trim();
  for (let before = ''; before !== name; ) {
    before = name;
    name = name.replace(/[\s_-]*\(?\b(v(ersion)?\s*\d+|tcs?(\s*\d+)?|test\s*cases?(\s*\d+)?)\)?\s*$/i, '').trim();
  }
  name = name || path.basename(sheet, '.xlsx');
  return name === name.toLowerCase() ? name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()) : name;
};

const indent = (text: string, spaces: number): string =>
  text.split('\n').map((line) => `${' '.repeat(spaces)}${line.trim()}`).filter((line) => line.trim()).join('\n');

const specOf = (story: string, sheetName: string, cells: readonly string[], backOffice: boolean, notApplicable: Readonly<Record<string, string>>): string => {
  const fixture = backOffice ? 'cms.fixture' : 'portal.fixture';
  const cases = cells.map((cell, index) => {
    const id = caseIdOf(story, index + 1);
    if (/[`]|\$\{/.test(cell)) {
      throw new Error(`INVALID_SCENARIO:${id}: the cell holds a backtick or "\${" - edit it by hand in the spec.`);
    }
    return `  test(...scenario('${id}', \`
${indent(cell, 4)}
  \`), async () => {
    test.fixme(true, '${(notApplicable[id] ?? NOT_AUTOMATED).replace(/'/g, "\\'")}');
  });`;
  });
  return `import { test } from '../../../src/fixtures/${fixture}';
import { scenario } from '../../../src/utils/core/scenario-test';

//========================================================================
// ${sheetName}
// The test cases of "${sheetName}.xlsx", in the sheet's order. Each case is written as the sheet has it: the scenario text
// is pasted from the sheet's cell (@Priority, Scenario, Given, When, Then, #Arabic) and the code below it does what each
// Given / When / Then says. tests/unit/story-sheets.test.ts keeps this text equal to the sheet.
//========================================================================================

test.describe('${story} ${nameOf(`${sheetName}.xlsx`).replace(/'/g, "\\'")}', () => {

${cases.join('\n\n')}
});
`;
};

/** Adds one story; returns the lines of its success message. */
const addStory = async (options: Options): Promise<string[]> => {
  const sheet = options.sheet;
  if (!existsSync(sheet)) {
    throw new Error(`MISSING_FILE: ${sheet}`);
  }
  const story = options.story;
  const assigned = storyOfSheet(sheet) !== story;
  const cells = await readStorySheet(sheet);
  const scenarios = cells.map((cell, index) => parseScenario(cell, caseIdOf(story, index + 1)));
  if (scenarios.length === 0) {
    throw new Error(`INVALID_SCENARIO: no "Scenario:" cell found in ${path.basename(sheet)}`);
  }

  const folder = path.resolve('tests/pages', options.page);
  mkdirSync(folder, { recursive: true });
  const existing = readdirSync(folder).find((file) => file.startsWith(`${story}-`) && file.endsWith('.spec.ts'));
  if (existing) {
    throw new Error(`ALREADY_EXISTS: tests/pages/${options.page}/${existing} - nothing written`);
  }
  const sheetName = path.basename(sheet, '.xlsx');
  const specFile = path.join(folder, `${story}-${slugOf(sheet)}.spec.ts`);
  // Cases the standing rules say cannot be tested (a server error, an HTTP code) start as not applicable, with the reason
  const notApplicable: Record<string, string> = {};
  scenarios.forEach((scenario, index) => {
    const reason = scenario ? standingNotApplicable([...scenario.when, ...scenario.then].join(' ')) : undefined;
    if (reason) {
      notApplicable[caseIdOf(story, index + 1)] = reason;
    }
  });
  writeFileSync(specFile, specOf(story, sheetName, cells, options.backOffice, notApplicable));
  const naFile = path.join(folder, NOT_APPLICABLE_FILE);
  if (Object.keys(notApplicable).length > 0 && !existsSync(naFile)) {
    writeFileSync(naFile, `${JSON.stringify(notApplicable, null, 2)}\n`);
  }

  const pageJson = path.join(folder, 'page.json');
  if (!existsSync(pageJson)) {
    const meta = {
      title: options.title ?? nameOf(sheet),
      group: options.group ?? (options.backOffice ? 'Back office' : 'Public portal'),
      story,
      ...(assigned ? { sheet: path.basename(sheet) } : {}),
      ...(options.path ? { path: options.path } : {}),
      workers: options.backOffice ? 2 : 3,
    };
    writeFileSync(pageJson, `${JSON.stringify(meta, null, 2)}\n`);
  }

  const pageTitle = (JSON.parse(readFileSync(pageJson, 'utf8')) as { title?: string }).title ?? nameOf(sheet);
  const byPriority = [1, 2, 3].map((priority) => [priority, scenarios.filter((scenario) => scenario?.priority === priority).length] as const).filter(([, n]) => n > 0);
  const lines = [`[story:new] Case list of ${story}:`];
  scenarios.forEach((scenario, index) => {
    lines.push(`  ${caseIdOf(story, index + 1)}  P${scenario?.priority ?? '?'}  ${scenario?.title ?? '(no scenario)'}`);
  });
  lines.push('');
  lines.push(`SUCCESS: ${scenarios.length} test cases of ${story} were added.`);
  if (assigned) {
    lines.push(`  Story id:   the sheet's name has no story id, so it is ${story} (${options.backOffice ? 'back office: its name says Manage' : 'public portal'}). Renaming the sheet with its real id is fine.`);
  }
  lines.push(`  Sheet:      ${path.relative(process.cwd(), sheet)}`);
  lines.push(`  Tests:      ${path.relative(process.cwd(), specFile)}`);
  lines.push(`  Priorities: ${byPriority.map(([priority, n]) => `P${priority} ${n}`).join(', ')}`);
  lines.push(`  Dashboard:  "${pageTitle}" under ${options.group ?? (options.backOffice ? 'Back office' : 'Public portal')} (press Reload tests if the dashboard is open).`);
  lines.push('  Each case shows "Not automated yet" until its test is written.');
  if (Object.keys(notApplicable).length > 0) {
    lines.push(`  Not applicable by the standing rules (${NOT_APPLICABLE_FILE}): ${Object.entries(notApplicable).map(([id, reason]) => `${id} (${reason.split(' - ')[0]})`).join(', ')}`);
  }
  const statusCodes = scenarios.map((scenario, index) => (scenario && !notApplicable[caseIdOf(story, index + 1)] && mentionsStatusCode([...scenario.when, ...scenario.then].join(' ')) ? caseIdOf(story, index + 1) : '')).filter(Boolean);
  if (statusCodes.length > 0) {
    lines.push(`  Ask for an HTTP status code (decide each: not applicable when the code is all they check): ${statusCodes.join(', ')}`);
  }
  return lines;
};

const main = async (): Promise<void> => {
  const all = parseArgs(process.argv.slice(2));
  const added: string[] = [];
  const failed: string[] = [];
  for (const options of all) {
    const story = storyOfSheet(options.sheet) ?? path.basename(options.sheet);
    try {
      console.log((await addStory(options)).join('\n'));
      console.log('');
      added.push(options.story);
    } catch (error) {
      failed.push(`${story}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (all.length > 1) {
    console.log(`SUCCESS: ${added.length} of ${all.length} stories added${added.length ? ` (${added.join(', ')})` : ''}.`);
  }
  if (failed.length) {
    console.error(`[story:new] Not added:\n${failed.map((line) => `  ${line}`).join('\n')}`);
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  if (error instanceof NothingToDo) {
    console.log(`[story:new] ${error.message}`);
    return;
  }
  console.error(`[story:new] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
