import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { looksLikeXlsx, saveSheet, uploadName, UploadError } from '../../src/scripts/story/story-upload';

const XLSX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

test.describe('Adding a user story from the dashboard', () => {
  test('a sheet named with its story id keeps its name', () => {
    expect(uploadName('PTL-94 - Events.xlsx')).toEqual({ name: 'PTL-94 - Events.xlsx', story: 'PTL-94' });
    expect(uploadName('C:\\fakepath\\CR-02_-_Offers.xlsx')).toEqual({ name: 'CR-02_-_Offers.xlsx', story: 'CR-02' });
  });

  test('a sheet without a story id needs one, and is saved under "<id> - <name>"', () => {
    expect(() => uploadName('Events.xlsx')).toThrow(UploadError);
    try {
      uploadName('Events.xlsx');
    } catch (error) {
      expect((error as UploadError).needsId).toBe(true);
    }
    expect(uploadName('Events.xlsx', ' ptl-95 ')).toEqual({ name: 'PTL-95 - Events.xlsx', story: 'PTL-95' });
    expect(() => uploadName('Events.xlsx', 'events')).toThrow(/not a story id/);
  });

  test('only Excel files are taken, and characters Windows refuses are dropped', () => {
    expect(() => uploadName('PTL-94 - Events.docx')).toThrow(/\.xlsx/);
    expect(uploadName('PTL-94 - Events: "new"?.xlsx').name).toBe('PTL-94 - Events new.xlsx');
    expect(looksLikeXlsx(XLSX)).toBe(true);
    expect(looksLikeXlsx(new TextEncoder().encode('hello there'))).toBe(false);
  });

  test('a story already in the project is refused; a new one is saved in docs/test-cases', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'story-upload-'));
    try {
      mkdirSync(path.join(root, 'docs', 'test-cases'), { recursive: true });
      mkdirSync(path.join(root, 'tests', 'pages'), { recursive: true });
      const saved = saveSheet(root, 'PTL-94 - Events.xlsx', XLSX);
      expect(saved.story).toBe('PTL-94');
      expect(readdirSync(path.join(root, 'docs', 'test-cases'))).toEqual(['PTL-94 - Events.xlsx']);
      expect(() => saveSheet(root, 'PTL-94 - Events v2.xlsx', XLSX)).toThrow(/already in the project/);
      expect(() => saveSheet(root, 'PTL-96 - Other.xlsx', new TextEncoder().encode('not excel'))).toThrow(/not an Excel sheet/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
