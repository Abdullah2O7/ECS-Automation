import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../fixtures/cms.fixture';
import { CmsModelApi } from '../../api/cms/cms-model.api';
import { modelMarkdown } from '../../domain/cms-model';
import { MODEL_OUTPUT, readContentModel } from './read-model';

/**
 * cms-model (npx playwright test --config=playwright.tools.config.ts cms-model) - writes the back office's content model to docs/cms-model.md (and test-output/cms-model/model.json):
 * every kind of page in the content tree, where its pages are, its tabs and fields, and the rules each field is configured
 * with. Read only: it signs in with the CMS account and changes nothing. Run it when a new user story starts, or after the
 * back office changed.
 */
test('content model', async ({ page }) => {
  const log = (line: string): void => console.log(`[cms:model] ${line}`);
  const { model } = await readContentModel(new CmsModelApi(page), log);
  mkdirSync(path.resolve(MODEL_OUTPUT), { recursive: true });
  writeFileSync(path.resolve(MODEL_OUTPUT, 'model.json'), JSON.stringify(model, null, 2));
  writeFileSync(path.resolve('docs/cms-model.md'), modelMarkdown(model));
  log(`docs/cms-model.md written: ${model.types.length} kinds of page, ${model.types.reduce((sum, type) => sum + type.fields.length, 0)} fields`);
});
