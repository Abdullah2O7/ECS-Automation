import { expect, test } from '@playwright/test';
import { isTestDataName, testDataCreatedAt, testDataName, TEST_DATA_PREFIX } from '../../src/domain/test-data-naming';

test.describe('Names of test data', () => {
  test('a generated name is recognised as test data', () => {
    expect(isTestDataName(testDataName('r1', 'article', 3))).toBe(true);
    expect(testDataName('r1', 'article', 3)).toBe(`${TEST_DATA_PREFIX}-r1-article-3`);
  });

  test('real content is never recognised, whatever it is called', () => {
    for (const name of ['Hawar Invites Fans to Summer Camp', 'news 1', 'الأخبار', 'test', 'auto', 'autotest-x', '', undefined, null]) {
      expect(isTestDataName(name)).toBe(false);
    }
  });

  test('the case of the name does not matter (a file name can be re-cased)', () => {
    expect(isTestDataName('AUTO-TEST-r1-main-1')).toBe(true);
    expect(isTestDataName('  Auto-Test-r1-main-1')).toBe(true);
  });

  test('the time a test named its data is read back from the name (for removing what an interrupted run left)', () => {
    const at = 1_792_088_559_681;
    const runId = `${at.toString(36)}${(4242).toString(36)}`;
    expect(testDataCreatedAt(testDataName(runId, 'gallery', 2))).toBe(at);
    expect(testDataCreatedAt('auto-test-probe-article')).toBeUndefined();
    expect(testDataCreatedAt('Hawar Invites Fans')).toBeUndefined();
  });
});
