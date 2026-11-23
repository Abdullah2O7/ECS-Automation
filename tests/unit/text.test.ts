import { expect, test } from '@playwright/test';
import { escapeRegExp, htmlToText, normalizeText } from '../../src/utils/core/text';

test('normalizeText strips icon-font glyphs and collapses whitespace', () => {
  expect(normalizeText('\nActive')).toBe('Active');
  expect(normalizeText('  Two   words \n')).toBe('Two words');
  expect(normalizeText('Clubs')).toBe('Clubs');
});

test('escapeRegExp makes a value match literally', () => {
  const name = 'report (1).pdf';
  expect(new RegExp(escapeRegExp(name)).test('report (1).pdf')).toBe(true);
  expect(new RegExp(escapeRegExp(name)).test('report 1Xpdf')).toBe(false);
});

test.describe('Rich text as a browser shows it', () => {
  test('an inline tag adds no space; a paragraph or a line break does', () => {
    expect(htmlToText('<p>in <strong>Mansoura</strong>, where</p><p>Next</p>')).toBe('in Mansoura, where Next');
    expect(htmlToText('<p>A<br>B</p>')).toBe('A B');
    expect(htmlToText('<p><a href="x">link</a>.</p>')).toBe('link.');
  });
});
