import { expect, test } from '@playwright/test';
import { parseScenario, scenarioTitle } from '../../src/utils/core/gherkin';

const sheetCell = `@Priority=1
Scenario: Verify that the News listing page is publicly accessible without authentication
Given A guest user with no login session navigates to the News listing page
When The page loads
Then The system displays the News listing page successfully without requiring login
#Arabic: التحقق من أن صفحة قائمة الأخبار متاحة للعموم`;

test.describe('Gherkin scenarios (the Excel sheets, pasted into specs)', () => {
  test('a sheet cell becomes a scenario with priority, title, steps and the Arabic line', () => {
    expect(parseScenario(sheetCell, 'PTL-07-01')).toEqual({
      id: 'PTL-07-01',
      priority: 1,
      title: 'Verify that the News listing page is publicly accessible without authentication',
      given: ['A guest user with no login session navigates to the News listing page'],
      when: ['The page loads'],
      then: ['The system displays the News listing page successfully without requiring login'],
      arabic: 'التحقق من أن صفحة قائمة الأخبار متاحة للعموم',
    });
  });

  test('And / But lines join the step before them; stray spaces and CRLF line ends are tolerated', () => {
    const scenario = parseScenario('@Priority = 2\r\nScenario:  Verify  that   x\r\n Given a\r\n And  b\r\nWhen c\r\nThen d\r\n But e', 'X-01');
    expect(scenario).toMatchObject({ priority: 2, title: 'Verify that x', given: ['a', 'b'], when: ['c'], then: ['d', 'e'] });
    expect(scenario?.arabic).toBeUndefined();
  });

  test('a step glued to the end of the line before it (a run of spaces between) is read as its own line', () => {
    const scenario = parseScenario('@Priority=1\nScenario: Verify that x          Given a\nWhen b\nThen c', 'X-02');
    expect(scenario).toMatchObject({ title: 'Verify that x', given: ['a'], when: ['b'], then: ['c'] });
  });

  test('a cell without a Scenario line is not a scenario; priority defaults to 2', () => {
    expect(parseScenario('Test Cases', 'X-01')).toBeUndefined();
    expect(parseScenario('Scenario: s\nGiven a\nWhen b\nThen c', 'X-01')?.priority).toBe(2);
  });

  test('a scenario with a missing step, or an And before any step, is refused and names the scenario', () => {
    expect(() => parseScenario('Scenario: no then\nGiven a\nWhen b', 'X-07')).toThrow('INVALID_SCENARIO:X-07: the scenario "no then" has no Then line');
    expect(() => parseScenario('Scenario: s\nAnd a\nGiven b\nWhen c\nThen d', 'X-08')).toThrow('INVALID_SCENARIO:X-08');
  });

  test('a test is titled with its id and the Scenario line', () => {
    expect(scenarioTitle({ id: 'PTL-07-01', title: 'Verify that x' })).toBe('PTL-07-01 - Verify that x');
  });
});
