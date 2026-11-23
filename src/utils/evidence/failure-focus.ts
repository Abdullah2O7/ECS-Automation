import type { Locator } from '@playwright/test';

/**
 * Where the screenshot of a failed test case draws its frame. The assertions and actions note the element they were
 * working on when they failed (`noteFailure`); a page object may also say which part of the screen it was reading
 * (`noteContext`), for checks that compare a value rather than an element.
 *
 * Module state is fine here: a worker runs one test at a time, and the evidence fixture clears it before each one.
 */
export type FocusPoint = {
  /** The element the check or action was working on. */
  locator?: Locator;
  /** Where that element should have been, when it is missing (its form, its toolbar). */
  area?: Locator;
  /** What was being done, in words ("the Status filter"). */
  what: string;
  /** Set when the screenshot is made: whether the element was on the page (so it is framed) or missing (so its place is). */
  found?: boolean;
};

let failure: FocusPoint | undefined;
let context: FocusPoint | undefined;

export const clearFocus = (): void => {
  failure = undefined;
  context = undefined;
};

const noteFailure = (point: FocusPoint): void => {
  failure = point;
};

export const noteContext = (point: FocusPoint): void => {
  context = point;
};

export const failedFocus = (): FocusPoint | undefined => failure;
export const contextFocus = (): FocusPoint | undefined => context;

/** Runs a check or action; when it throws, notes what it was working on and lets the error through. */
export const focusOnFailure = async <T>(point: FocusPoint, body: () => Promise<T>): Promise<T> => {
  try {
    return await body();
  } catch (error) {
    noteFailure(point);
    throw error;
  }
};
