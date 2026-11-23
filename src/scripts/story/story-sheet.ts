import ExcelJS from 'exceljs';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The Excel test-case sheets of the user stories (docs/test-cases/<story> - <name>.xlsx).
 * Each test case is one cell holding the whole Gherkin scenario (@Priority, Scenario, Given, When, Then, #Arabic);
 * row order is case order, so the 6th scenario of "CMS-06 - ....xlsx" is CMS-06-06.
 * Read by the story scaffolder (src/scripts/story/new-story.ts) and the sheet <-> spec check (tests/unit/story-sheets.test.ts).
 */
export const SHEETS_FOLDER = 'docs/test-cases';

/** "CMS-06 - Manage News Articles.xlsx" -> "CMS-06" */
export const storyOfSheet = (file: string): string | undefined => /^([A-Z]+-\d+)(?![\dA-Z])/i.exec(path.basename(file))?.[1]?.toUpperCase();

/** The sheet of a story in a folder, or undefined when nobody has put it there. */
export const findStorySheet = (story: string, folder: string = path.resolve(SHEETS_FOLDER)): string | undefined => {
  if (!existsSync(folder)) {
    return undefined;
  }
  const name = readdirSync(folder).find((file) => file.toLowerCase().endsWith('.xlsx') && !file.startsWith('~$') && storyOfSheet(file) === story.toUpperCase());
  return name ? path.join(folder, name) : undefined;
};

/** The id of the n-th case (1-based) of a story: CMS-06, 6 -> CMS-06-06. */
export const caseIdOf = (story: string, position: number): string => `${story}-${String(position).padStart(2, '0')}`;

const textOf = (value: ExcelJS.CellValue): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  return '';
};

/** Every scenario cell of the sheet, in row order (cells without a "Scenario:" line - headings, notes - are left out). */
export const readStorySheet = async (file: string): Promise<string[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const cells: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = textOf(cell.value).replace(/\r\n/g, '\n').trim();
        if (/^\s*Scenario\s*:/im.test(text)) {
          cells.push(text);
        }
      });
    });
  }
  return cells;
};
