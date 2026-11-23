import { test } from '../../fixtures/cms.fixture';
import { CmsModelApi } from '../../api/cms/cms-model.api';

/**
 * cms-cleanup (npx playwright test --config=playwright.tools.config.ts cms-cleanup) - removes the test data that interrupted runs left in the back office: pages and pictures named as
 * test data (auto-test-...) anywhere in the content tree, the media library and the Recycle Bins. Real content is never
 * touched: an item is removed only when every name it has is a test-data name.
 *
 *   CLEANUP_AGE_MIN=90     only what was made at least this many minutes ago (default 90: never a run that is going on)
 *   CLEANUP_LABEL=probe    only what carries this label (probe: what an interrupted cms:probe left)
 */
test('remove left-over test data', async ({ page }) => {
  const minutes = Number(process.env.CLEANUP_AGE_MIN ?? '90');
  const removed = await new CmsModelApi(page).removeLeftovers((Number.isFinite(minutes) ? minutes : 90) * 60_000, process.env.CLEANUP_LABEL || undefined);
  console.log(removed.length ? `[cms:cleanup] removed ${removed.length}: ${removed.join(', ')}` : '[cms:cleanup] nothing left over');
});
