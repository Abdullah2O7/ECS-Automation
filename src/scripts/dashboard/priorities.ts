import type { TestRecord } from './results.ts';

/**
 * Running a page by priority: the sheet gives each case a priority (P1, P2, P3, ...), and a run can be limited to some of
 * them - on one page, or on every page ticked in the side bar.
 */

const priorityOf = (test: TestRecord): number | undefined => test.scenario?.priority;

/** The priorities chosen in a request: whole numbers from 1 up, each once, P1 first. Anything else is left out. */
export const parsePriorities = (value: unknown): number[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((p): p is number => typeof p === 'number' && Number.isInteger(p) && p > 0))].sort((a, b) => a - b)
    : [];

/** The priorities the cases have, P1 first. */
export const prioritiesOf = (tests: readonly TestRecord[]): number[] =>
  [...new Set(tests.map(priorityOf).filter((p): p is number => p !== undefined))].sort((a, b) => a - b);

/** The cases of the chosen priorities that a run would execute: the ones marked not applicable are not run. */
export const casesOfPriorities = (tests: readonly TestRecord[], priorities: readonly number[]): string[] =>
  tests.filter((test) => test.status !== 'notapplicable' && priorities.includes(priorityOf(test) ?? 0)).map((test) => test.caseId);

/** How a run limited to some priorities is named: "P1 cases", "P1 and P2 cases", "P1, P2 and P3 cases". */
export const priorityScope = (priorities: readonly number[]): string => {
  const names = [...priorities].sort((a, b) => a - b).map((p) => `P${p}`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return `${list} cases`;
};
