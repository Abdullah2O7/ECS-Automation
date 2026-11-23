import * as allure from 'allure-js-commons';
import { Severity } from 'allure-js-commons';
import { test, type TestDetails } from '@playwright/test';
import { parseScenario, scenarioTitle } from './gherkin';

/**
 * Test cases written the way the Excel sheet has them. The spec holds the scenario text pasted from the sheet's cell, and
 * the code under it does what each Given / When / Then says:
 *
 *   test(...scenario('PTL-07-01', `
 *     @Priority=1
 *     Scenario: Verify that the News listing page is publicly accessible without authentication
 *     Given A guest user with no login session navigates to the News listing page
 *     When The page loads
 *     Then The system displays the News listing page successfully without requiring login
 *     #Arabic: ...
 *   `), async ({ newsListPage }) => {
 *     await given(() => newsListPage.open());          // report step: "Given A guest user ... navigates to the News page"
 *     await when();                                    // nothing to do, still shown: "When The page loads"
 *     await then(() => newsListPage.expectPublic());   // report step: "Then The system displays ..."
 *   });
 *
 * - `scenario(id, text)` gives the test its title `<id> - <Scenario line>`, the tag `@P<priority>` and the scenario as
 *   annotations (shown in the Playwright report and on the dashboard).
 * - `given` / `when` / `then` run their body (optional) as a report step named by the sheet's sentence, and hand back what
 *   the body returns. They read the sentence from the running test's annotations, so they need no id.
 */
export type StepRunner = <T = void>(body?: () => Promise<T>) => Promise<T>;

export const scenario = (id: string, text: string): [title: string, details: TestDetails] => {
  const parsed = parseScenario(text, id);
  if (!parsed) {
    throw new Error(`INVALID_SCENARIO:${id}: the text has no "Scenario:" line - paste the sheet's cell as it is.`);
  }
  return [
    scenarioTitle(parsed),
    {
      tag: [`@P${parsed.priority}`],
      annotation: [
        { type: 'Priority', description: String(parsed.priority) },
        { type: 'Given', description: parsed.given.join(' | ') },
        { type: 'When', description: parsed.when.join(' | ') },
        { type: 'Then', description: parsed.then.join(' | ') },
        ...(parsed.arabic ? [{ type: 'Arabic', description: parsed.arabic }] : []),
      ],
    },
  ];
};

const annotationOf = (type: string): string => {
  const found = test.info().annotations.find((annotation) => annotation.type === type)?.description;
  if (found === undefined) {
    throw new Error(`NOT_A_SCENARIO_TEST: "${test.info().title}" was not declared with test(...scenario('<id>', \`<sheet cell>\`), ...), so it has no ${type} sentence.`);
  }
  return found;
};

const stepRunner = (keyword: 'Given' | 'When' | 'Then'): StepRunner => {
  // The body is optional and its result is handed back: StepRunner's generic signature cannot be written as one arrow function
  return (async (body?: () => Promise<unknown>) => {
    const [first, ...rest] = annotationOf(keyword).split(' | ');
    const name = [`${keyword} ${first}`, ...rest.map((sentence) => `And ${sentence}`)].join(' ');
    return test.step(name, async () => body?.());
  }) as StepRunner;
};

export const given = stepRunner('Given');
export const when = stepRunner('When');
export const then = stepRunner('Then');

/** The running scenario's priority, as written in the sheet (`@Priority=1`). */
const priorityOf = (): number => Number(annotationOf('Priority'));

/** Report labels of the running scenario: Allure epic and feature, and a severity from the sheet's priority (1 = critical). */
export const labelScenario = async (epic: string, feature: string): Promise<void> => {
  await allure.epic(epic);
  await allure.feature(feature);
  await allure.severity(priorityOf() === 1 ? Severity.CRITICAL : Severity.NORMAL);
};
