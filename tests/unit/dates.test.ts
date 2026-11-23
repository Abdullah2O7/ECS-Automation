import { expect, test } from '@playwright/test';
import { addDays, addMonths, calendarDayLabel, calendarMonthLabel, formatDate, isAroundNow, isoDate, parseDate } from '../../src/utils/core/dates';

test('addMonths clamps to the end of a shorter month instead of rolling over', () => {
  expect(isoDate(addMonths(new Date(2026, 10, 30), 3))).toBe('2027-02-28');
  expect(isoDate(addMonths(new Date(2028, 0, 31), 1))).toBe('2028-02-29');
  expect(isoDate(addMonths(new Date(2026, 9, 15), 3))).toBe('2027-01-15');
});

test('addDays crosses month and year ends', () => {
  expect(isoDate(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
  expect(isoDate(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
});

test('formatDate and parseDate are inverse, and parseDate accepts D/M/YYYY', () => {
  const date = new Date(2026, 9, 5);
  expect(formatDate(date)).toBe('05/10/2026');
  expect(parseDate('05/10/2026').getTime()).toBe(date.getTime());
  expect(parseDate(' 5/10/2026 ').getTime()).toBe(date.getTime());
});

test('parseDate refuses text that is not day/month/year', () => {
  expect(() => parseDate('2026-10-05')).toThrow('UNREADABLE_DATE');
});

test('isoDate keeps the local day', () => {
  expect(isoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
});

test('calendar labels match the picker accessible names', () => {
  expect(calendarDayLabel(new Date(2026, 9, 1))).toBe('October 1, 2026');
  expect(calendarMonthLabel(new Date(2026, 9, 1))).toBe('October 2026');
});

test.describe('isAroundNow (a server date-time without a time zone)', () => {
  const now = Date.parse('2026-10-15T19:11:09Z');
  test('accepts the same moment written in any time zone, and an exact UTC time', () => {
    expect(isAroundNow('2026-10-15 22:11:09', undefined, now)).toBe(true); // Cairo (+3)
    expect(isAroundNow('2026-10-15 19:20:00', undefined, now)).toBe(true); // UTC, 9 minutes later
    expect(isAroundNow('2026-10-15T19:11:09Z', undefined, now)).toBe(true);
  });
  test('refuses another day, an old time with a zone, and nothing', () => {
    expect(isAroundNow('2026-10-13 22:11:09', undefined, now)).toBe(false);
    expect(isAroundNow('2026-10-15T15:00:00Z', undefined, now)).toBe(false);
    expect(isAroundNow(null, undefined, now)).toBe(false);
    expect(isAroundNow('not a date', undefined, now)).toBe(false);
  });
});
