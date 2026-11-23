/**
 * Date helpers for scenarios whose dates are relative to the run.
 *
 * Applications usually reject dates in the past, so scenarios specify dates as rules - "10 days after
 * the date on which the test case is executed", "3 months after the start date". The rules are what is
 * implemented here; a fixed date would stop working the day after it was written.
 *
 * `formatDate` / `parseDate` use DD/MM/YYYY - change them to the format your application displays.
 */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Today, with the time dropped so date arithmetic cannot be skewed by the hour of the run. */
export const today = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * Adds whole months, clamping the day to the end of the target month.
 *
 * Without the clamp, JavaScript rolls a non-existent date over into the next month - 30 November
 * plus three months becomes 2 March - which would silently put a date outside the range the
 * scenario intends.
 */
export const addMonths = (date: Date, months: number): Date => {
  const targetMonth = date.getMonth() + months;
  const lastDayOfTargetMonth = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDayOfTargetMonth));
};

/** Formats a date the way the application's date fields display it, e.g. `01/10/2026`. */
export const formatDate = (date: Date): string =>
  [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('/');

/**
 * `YYYY-MM-DD` of a local date, e.g. `2026-10-01` - as the database and the API's date fields take it. Not
 * `toISOString`, which would shift a local midnight into the previous day east of UTC.
 */
export const isoDate = (date: Date): string =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

/**
 * Reads a date the way the application displays it, the reverse of `formatDate`. The day and month may
 * come without their leading zero, as some grids show them (`5/10/2026`).
 * @param text - A date as `DD/MM/YYYY` or `D/M/YYYY`, e.g. `05/10/2026`
 * @returns The date at midnight local time
 * @throws If the text is not a day/month/year date
 */
export const parseDate = (text: string): Date => {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    throw new Error(`UNREADABLE_DATE:${text}: expected DD/MM/YYYY.`);
  }
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
};

/**
 * The accessible name of a day cell in a calendar picker (Fluent UI's, for one), e.g. `October 1, 2026`.
 *
 * Matching on this is what makes day selection exact: it pins the month and year as well, so a
 * click cannot land on a grey neighbouring-month cell, and `1` cannot collide with 10-19, 21 or 31
 * the way plain text matching does.
 */
export const calendarDayLabel = (date: Date): string =>
  `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

/** The accessible name of a month button in a calendar picker, e.g. `October 2026`. */
export const calendarMonthLabel = (date: Date): string =>
  `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

/**
 * Reads a date written with the month's name, the way the portal shows publish dates: `07 October 2026`.
 * @param text - Day, English month name and year, e.g. `7 October 2026`
 * @returns The date at midnight local time
 * @throws If the text is not in that form
 */
export const parseLongDate = (text: string): Date => {
  const match = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  const month = match ? MONTH_NAMES.findIndex((name) => name.toLowerCase() === match[2].toLowerCase()) : -1;
  if (!match || month < 0) {
    throw new Error(`UNREADABLE_DATE:${text}: expected D Month YYYY, e.g. 07 October 2026.`);
  }
  return new Date(Number(match[3]), month, Number(match[1]));
};

/**
 * Whether a date-time the server wrote is "now" (within `toleranceMs`). The back office writes local date-times without a time
 * zone ("2026-10-15 22:11:09"), and the server's zone is not known here, so the time is accepted at any whole-hour (or
 * half-hour) offset from this machine's clock between -14 h and +14 h.
 */
export const isAroundNow = (value: string | null | undefined, toleranceMs = 15 * 60_000, now = Date.now()): boolean => {
  if (!value) {
    return false;
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
  const asUtc = Date.parse(hasZone ? value : `${value.trim().replace(' ', 'T')}Z`);
  if (Number.isNaN(asUtc)) {
    return false;
  }
  if (hasZone) {
    return Math.abs(now - asUtc) <= toleranceMs;
  }
  for (let offset = -28; offset <= 28; offset += 1) {
    if (Math.abs(now - (asUtc - offset * 30 * 60_000)) <= toleranceMs) {
      return true;
    }
  }
  return false;
};
