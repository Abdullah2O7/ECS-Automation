/**
 * Test cases written as Gherkin scenarios - the format of the Excel sheets:
 *
 *   @Priority=1
 *   Scenario: Verify that the News listing page is publicly accessible without authentication
 *   Given A guest user with no login session navigates to the News listing page
 *   When The page loads
 *   Then The system displays the News listing page successfully without requiring login
 *   #Arabic: ...
 *
 * `parseScenario` turns the text of one sheet cell, as pasted into a spec, into a `Scenario`. Pure: no files, no Playwright -
 * so it is unit tested (tests/unit/gherkin.test.ts).
 */
export type Scenario = {
  /** `PTL-07-01`: the story and the position in the sheet, as given by the spec. */
  readonly id: string;
  /** 1 = critical ... as written in `@Priority=n`. */
  readonly priority: number;
  readonly title: string;
  readonly given: readonly string[];
  readonly when: readonly string[];
  readonly then: readonly string[];
  readonly arabic?: string;
};

type Section = 'given' | 'when' | 'then';

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** What a test is called: its id, then the sheet's scenario text. */
export const scenarioTitle = (scenario: Pick<Scenario, 'id' | 'title'>): string => `${scenario.id} - ${scenario.title}`;

/**
 * Some sheet cells have a step glued to the end of the line before it, separated only by a run of spaces
 * ("Scenario: Verify x          Given y"). A keyword after 4 or more spaces starts its own line.
 */
const unglue = (text: string): string => text.replace(/[ \t]{4,}(Given|When|Then|And|But)\b/g, '\n$1');

/** One cell's text -> a scenario, or undefined when the cell is not a scenario (a heading, an empty cell). */
export const parseScenario = (text: string, id: string): Scenario | undefined => {
  let priority: number | undefined;
  let title: string | undefined;
  let arabic: string | undefined;
  const sections: Record<Section, string[]> = { given: [], when: [], then: [] };
  let current: Section | undefined;

  for (const raw of unglue(text).split(/\r?\n/)) {
    const line = raw.trim();
    const keyword = /^(Scenario|Given|When|Then|And|But)\b:?\s*(.*)$/i.exec(line);
    if (!line) {
      continue;
    }
    const priorityTag = /^@Priority\s*=\s*(\d+)/i.exec(line);
    if (priorityTag) {
      priority = Number(priorityTag[1]);
    } else if (/^#\s*Arabic(\s+description)?\s*:/i.test(line)) {
      arabic = squash(line.replace(/^#\s*Arabic(\s+description)?\s*:/i, ''));
    } else if (line.startsWith('#') || line.startsWith('@')) {
      continue; // another comment or tag: not used
    } else if (keyword) {
      const word = keyword[1].toLowerCase();
      const sentence = squash(keyword[2]);
      if (word === 'scenario') {
        title = sentence;
        current = undefined;
      } else if (word === 'and' || word === 'but') {
        if (!current) {
          throw new Error(`INVALID_SCENARIO:${id}: "${line}" comes before any Given/When/Then.`);
        }
        sections[current].push(sentence);
      } else {
        current = word as Section;
        sections[current].push(sentence);
      }
    }
  }

  if (title === undefined) {
    return undefined;
  }
  for (const section of ['given', 'when', 'then'] as const) {
    if (sections[section].length === 0) {
      throw new Error(`INVALID_SCENARIO:${id}: the scenario "${title}" has no ${section[0].toUpperCase()}${section.slice(1)} line.`);
    }
  }
  return { id, priority: priority ?? 2, title, given: sections.given, when: sections.when, then: sections.then, ...(arabic ? { arabic } : {}) };
};
