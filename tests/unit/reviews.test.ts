import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReviews, REVIEW_FILE, setReview } from '../../src/config/reviews';

const withFolder = (check: (folder: string) => void): void => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'reviews-'));
  try {
    check(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

test.describe('Your verdicts on cases (tests/pages/<page>/review.json)', () => {
  test('a verdict with its reason is kept per case, sorted, and can be taken back', () => {
    withFolder((folder) => {
      const at = new Date('2026-10-17T16:00:00.000Z');
      setReview(folder, 'CMS-90-12', { expected: 'passed', note: ' the maximum is now 200 ', result: 'failed: Error: ...' }, at);
      setReview(folder, 'CMS-90-05', { expected: 'failed', note: 'a real bug, reported' }, at);
      expect(Object.keys(readReviews(folder))).toEqual(['CMS-90-05', 'CMS-90-12']);
      expect(readReviews(folder)['CMS-90-12']).toEqual({ expected: 'passed', note: 'the maximum is now 200', at: '2026-10-17T16:00:00.000Z', result: 'failed: Error: ...' });
      setReview(folder, 'CMS-90-05', null);
      setReview(folder, 'CMS-90-12', null);
      expect(existsSync(path.join(folder, REVIEW_FILE))).toBe(false);
    });
  });

  test('a verdict needs a reason and one of the three results', () => {
    withFolder((folder) => {
      expect(() => setReview(folder, 'X-01', { expected: 'passed', note: '  ' })).toThrow(/NO_REASON/);
      expect(() => setReview(folder, 'X-01', { expected: 'maybe' as never, note: 'why' })).toThrow(/INVALID_VERDICT/);
    });
  });

  test('a new verdict replaces the old one and what Claude did for it', () => {
    withFolder((folder) => {
      writeFileSync(path.join(folder, REVIEW_FILE), JSON.stringify({ 'X-01': { expected: 'passed', note: 'old', at: 'then', done: { at: 'later', note: 'changed the limit' } } }));
      expect(readReviews(folder)['X-01'].done?.note).toBe('changed the limit');
      setReview(folder, 'X-01', { expected: 'failed', note: 'new' });
      expect(readReviews(folder)['X-01'].done).toBeUndefined();
    });
  });

  test('a broken or hand-edited file never stops anything: bad entries are left out', () => {
    withFolder((folder) => {
      writeFileSync(path.join(folder, REVIEW_FILE), '{ not json');
      expect(readReviews(folder)).toEqual({});
      writeFileSync(path.join(folder, REVIEW_FILE), JSON.stringify({ 'X-01': { expected: 'maybe', note: '', at: '' }, 'X-02': { expected: 'blocked', note: 'needs a mailbox', at: 'now' } }));
      expect(Object.keys(readReviews(folder))).toEqual(['X-02']);
      expect(JSON.parse(readFileSync(path.join(folder, REVIEW_FILE), 'utf8'))['X-01']).toBeDefined();
    });
  });
});
