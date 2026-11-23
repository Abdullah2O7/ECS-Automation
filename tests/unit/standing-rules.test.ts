import { expect, test } from '@playwright/test';
import { mentionsStatusCode, standingNotApplicable } from '../../src/domain/standing-rules';

test.describe('Standing rules for cases that cannot be tested', () => {
  test('a case that needs a server error is not applicable', () => {
    expect(standingNotApplicable('When Administrator attempts to save changes but server encounters an internal error')).toMatch(/server to fail/);
    expect(standingNotApplicable('Then the system shows a 500 error page')).toMatch(/server to fail/);
    expect(standingNotApplicable('When the user saves and the system encounters an unexpected server-side error')).toMatch(/server to fail/);
    expect(standingNotApplicable('When the administrator enters an address longer than 500 characters')).toBeUndefined();
  });

  test('a case that asks for an HTTP status code is pointed out, not marked', () => {
    expect(standingNotApplicable('Then the system returns HTTP status code 422 and displays the error message')).toBeUndefined();
    expect(mentionsStatusCode('Then the system returns HTTP status code 422 and displays the error message')).toBe(true);
    expect(mentionsStatusCode('Then the response code is 400')).toBe(true);
    expect(mentionsStatusCode('Then the address of 500 characters is saved')).toBe(false);
  });

  test('a case that needs the network to fail is not applicable', () => {
    expect(standingNotApplicable('When the network connection is lost during upload')).toMatch(/network to fail/);
    expect(standingNotApplicable('When a network failure happens while saving')).toMatch(/network to fail/);
  });

  test('ordinary cases are left alone', () => {
    for (const text of ['When the user uploads 5 gallery images and saves', 'Then the error message "Required field Title is missing" is displayed', 'When the president name has 101 characters', 'Then 500KB is the minimum size']) {
      expect(standingNotApplicable(text)).toBeUndefined();
    }
  });
});
