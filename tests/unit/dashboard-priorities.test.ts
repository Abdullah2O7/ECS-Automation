import { expect, test } from '@playwright/test';
import type { TestRecord } from '../../src/scripts/dashboard/results';
import { casesOfPriorities, parsePriorities, prioritiesOf, priorityScope } from '../../src/scripts/dashboard/priorities';

const record = (caseId: string, priority?: number, status: TestRecord['status'] = 'passed'): TestRecord => ({
  key: caseId, caseId, title: caseId, file: 'x.spec.ts', line: 1, project: 'p', status, durationMs: 0, screenshots: [],
  ...(priority === undefined ? {} : { scenario: { priority, given: '', when: '', then: '' } }),
});

const tests = [record('A-01', 1), record('A-02', 2), record('A-03', 3), record('A-04', 1, 'notapplicable'), record('A-05'), record('A-06', 2, 'failed')];

test.describe('Running the dashboard by priority', () => {
  test('a run of some priorities takes their cases, never the ones marked not applicable', () => {
    expect(casesOfPriorities(tests, [1])).toEqual(['A-01']);
    expect(casesOfPriorities(tests, [1, 2])).toEqual(['A-01', 'A-02', 'A-06']);
    expect(casesOfPriorities(tests, [3])).toEqual(['A-03']);
    expect(casesOfPriorities(tests, [4])).toEqual([]);
  });

  test('a case with no priority in its sheet is in no priority run', () => {
    expect(casesOfPriorities(tests, [1, 2, 3])).not.toContain('A-05');
  });

  test('the priorities of a page are listed P1 first, whatever their number', () => {
    expect(prioritiesOf(tests)).toEqual([1, 2, 3]);
    expect(prioritiesOf([record('B-01', 5), record('B-02', 4)])).toEqual([4, 5]);
  });

  test('only whole numbers from 1 up are taken from a request, once each', () => {
    expect(parsePriorities([2, 1, 2, 0, -1, 1.5, '3', null])).toEqual([1, 2]);
    expect(parsePriorities('1')).toEqual([]);
  });

  test('the run is named by its priorities', () => {
    expect(priorityScope([1])).toBe('P1 cases');
    expect(priorityScope([2, 1])).toBe('P1 and P2 cases');
    expect(priorityScope([3, 1, 2])).toBe('P1, P2 and P3 cases');
  });
});
