import { expect, test } from '@playwright/test';
import { retrying } from '../../src/utils/core/retry';

test.describe('retrying a step', () => {
  test('a step that fails twice and then works is tried three times, and recovers in between', async () => {
    let tries = 0;
    let recoveries = 0;
    const result = await retrying('step', async () => {
      tries += 1;
      if (tries < 3) {
        throw new Error('not yet');
      }
      return 'done';
    }, { pause: 1, recover: async () => { recoveries += 1; } });
    expect(result).toBe('done');
    expect(tries).toBe(3);
    expect(recoveries).toBe(2);
  });

  test('a step that keeps failing reports its last failure after the allowed tries', async () => {
    let tries = 0;
    const failure = await retrying('step', async () => {
      tries += 1;
      throw new Error(`failure ${tries}`);
    }, { attempts: 2, pause: 1 }).catch((error: Error) => error);
    expect(tries).toBe(2);
    expect((failure as Error).message).toBe('failure 2');
  });
});
