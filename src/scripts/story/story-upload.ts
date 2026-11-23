import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { findStorySheet, SHEETS_FOLDER, storyOfSheet } from './story-sheet.ts';
import { storiesWithTests } from './story-readiness.ts';

/**
 * Adding a user story from the dashboard ("Add user story"), for people who do not use a terminal: the Excel sheet they
 * pick is saved in docs/test-cases under a name that starts with its story id, then `npm run story:new` starts its tests -
 * exactly what the README's manual steps do.
 */

/** The largest sheet accepted (a test-case sheet is a few dozen KB). */
export const MAX_SHEET_BYTES = 10 * 1024 * 1024;

/** A problem the person can act on, said in plain words; `needsId` when the sheet's name has no story id. */
export class UploadError extends Error {
  readonly needsId: boolean;

  constructor(message: string, needsId = false) {
    super(message);
    this.needsId = needsId;
  }
}

/** A story id as the team writes it: letters, a dash and a number (PTL-94, CMS-12, CR-02). */
const STORY_ID = /^[A-Z]+-\d+$/;

/**
 * The name a picked sheet is saved under, and its story: the file's own name when it starts with a story id, otherwise
 * "<id> - <name>" with the id the person typed. Characters Windows does not allow in a file name are dropped.
 */
export const uploadName = (original: string, givenId?: string): { name: string; story: string } => {
  const base = (original.split(/[\\/]/).pop() ?? '').replace(/[<>:"|?*\u0000-\u001f]/g, '').trim();
  if (!/\.xlsx$/i.test(base) || base.length <= '.xlsx'.length) {
    throw new UploadError('Choose the Excel file of the user story (.xlsx).');
  }
  const own = storyOfSheet(base);
  if (own) {
    return { name: base, story: own };
  }
  const id = (givenId ?? '').trim().toUpperCase();
  if (!id) {
    throw new UploadError(`"${base}" does not start with its story id. Type the story's id (for example PTL-94) and add it again.`, true);
  }
  if (!STORY_ID.test(id)) {
    throw new UploadError(`"${id}" is not a story id: it is letters, a dash and a number (for example PTL-94).`, true);
  }
  return { name: `${id} - ${base}`, story: id };
};

/** Whether the bytes are an Excel file (.xlsx is a zip archive: it starts with "PK"). */
export const looksLikeXlsx = (bytes: Uint8Array): boolean => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

/** Saves the sheet in docs/test-cases; refuses a story that already has a sheet or tests. Returns the saved file. */
export const saveSheet = (root: string, original: string, bytes: Uint8Array, givenId?: string): { file: string; story: string } => {
  if (bytes.length === 0 || bytes.length > MAX_SHEET_BYTES || !looksLikeXlsx(bytes)) {
    throw new UploadError('That file is not an Excel sheet (.xlsx) - or it is empty, or larger than 10 MB.');
  }
  const { name, story } = uploadName(original, givenId);
  const folder = path.join(root, SHEETS_FOLDER);
  if (findStorySheet(story, folder) || storiesWithTests(root).has(story)) {
    throw new UploadError(`${story} is already in the project. A new version of a story's sheet is updated by Claude: ask Claude to update ${story} with the new sheet.`);
  }
  const file = path.join(folder, name);
  if (existsSync(file)) {
    throw new UploadError(`A sheet named "${name}" is already in docs/test-cases.`);
  }
  writeFileSync(file, bytes);
  return { file, story };
};

/**
 * Starts the tests of a saved sheet (`npm run story:new` for that sheet) and returns what it printed. When it fails, the
 * sheet is removed again, so the project is left as it was.
 */
export const startStory = (root: string, file: string): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join('src', 'scripts', 'story', 'new-story.ts'), file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    const done = (ok: boolean): void => {
      if (!ok) {
        rmSync(file, { force: true });
      }
      resolve({ ok, output: output.trim() });
    };
    child.on('error', (error) => {
      output += error.message;
      done(false);
    });
    child.on('close', (code) => done(code === 0));
  });
