import { expect, test } from '@playwright/test';
import { configOf, editorName, lengthInMessage, lengthOfPattern, modelMarkdown, rulesMarkdown, rulesOf } from '../../src/domain/cms-model';

test.describe('The back-office content model', () => {
  test('a length pattern and a server message give their limits', () => {
    expect(lengthOfPattern('^.{1,100}$')).toEqual({ min: 1, max: 100 });
    expect(lengthOfPattern('.+')).toBeUndefined();
    expect(lengthInMessage('Error: Title (en-US) exceeds the maximum allowed length of 100 characters. Current length: 101 characters.')).toBe(100);
    expect(lengthInMessage('Must not exceed 50 characters.')).toBe(50);
    expect(lengthInMessage('Required')).toBeUndefined();
  });

  test('a field configuration reads as rules in words', () => {
    const config = configOf([{ alias: 'maxChars', value: 300 }, { alias: 'umbMigrationV14', value: 'x' }]);
    expect(config).toEqual({ maxChars: 300 });
    expect(rulesOf({ editor: 'Umbraco.TextBox', required: true, requiredMessage: 'Required', pattern: '^.{1,100}$', patternMessage: 'Must not exceed 100 characters.' }, config)).toEqual([
      'required ("Required")',
      '1-100 characters by pattern ("Must not exceed 100 characters.")',
      'at most 300 characters (the box stops typing there)',
    ]);
    expect(rulesOf({ editor: 'Umbraco.MediaPicker3', required: false }, { filter: 'img-id', validationLimit: { max: 10 } }, () => 'Image')).toEqual(['10 pictures at most', 'only Image']);
    expect(rulesOf({ editor: 'Umbraco.Plain.String', required: false }, { labelOn: 'Yes', labelOff: 'No', showIfChecked: 'startDate,endDate' })).toEqual(['off by default (Yes / No)', 'when on, shows startDate, endDate']);
    expect(editorName('Umbraco.Plain.String', { labelOn: 'Yes' })).toBe('Yes / No switch (custom)');
  });

  test('the model and the probe findings are written as tables', () => {
    const page = modelMarkdown({ generatedAt: '2026-10-17T01:00:00Z', host: 'cms.example', types: [{ id: 'id', alias: 'aboutUs', name: 'AboutUS', usedAt: ['Home > About Club > History'], pageCount: 1, allowedChildren: [], fields: [{ alias: 'title', name: 'Title', tab: null, group: 'Content', editor: 'Umbraco.TextBox', editorName: 'Text box', required: true, perLanguage: true, rules: ['required'], config: {} }] }] });
    expect(page).toContain('| Content | Title | `title` | Text box | yes | required |');
    const rules = rulesMarkdown({ generatedAt: '2026-10-17T01:00:00Z', host: 'cms.example', fields: [{ type: 'AboutUS', field: 'Title (title)', tried: 'empty', outcome: 'refused', says: 'Required' }], pictures: [] });
    expect(rules).toContain('| AboutUS | Title (title) | empty | **refused** | Required |');
  });
});
