import { expect, test } from '@playwright/test';
import { environmentProblem, previousTry, rememberEnvironmentProblem, rememberTry } from '../../src/utils/runtime/run-memory';

test.describe('Run memory (shared by the workers of one run)', () => {
  test.beforeEach(() => {
    process.env.PW_RUN_ID = `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  test('an environment problem found by one case is known to the rest of the run, per portal', () => {
    expect(environmentProblem('cms')).toBeUndefined();
    rememberEnvironmentProblem('cms', 'the back office did not answer');
    expect(environmentProblem('cms')).toBe('the back office did not answer');
    expect(environmentProblem('portal')).toBeUndefined();
  });

  test("how a case's try failed is kept for its next try, and a new run starts clean", () => {
    rememberTry('abc 1', { kind: 'bug', message: 'expect(x).toBe(y)', evidence: '/out/shot.png' });
    expect(previousTry('abc 1')).toEqual({ kind: 'bug', message: 'expect(x).toBe(y)', evidence: '/out/shot.png' });
    process.env.PW_RUN_ID = `unit-other-${Date.now()}`;
    expect(previousTry('abc 1')).toBeUndefined();
  });
});
