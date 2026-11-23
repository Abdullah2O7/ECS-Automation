import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../fixtures/cms.fixture';
import { requiredEnv } from '../../utils/core/env';
import { BackOfficeTour } from './back-office-tour';
import { guideText } from './guide-text';
import { writeWordGuide } from './word-guide';
import { GUIDE_FOLDER, guideFileName, LATEST_GUIDE_FILE, type GuideResult } from './guide-files';
import type { Chapter, GuideLanguage } from './guide-model';

/**
 * Creates the back-office user guide (npm run guide, or "Create user guide" on the dashboard): signs in with the CMS
 * account, walks the content tree and writes a Word file to test-output/user-guide. Read-only: nothing is saved.
 *
 *   GUIDE_LANGUAGE=ar|en   the guide's language (Arabic, right to left, by default)
 *   GUIDE_ONLY=News,Contact US   only these sections of the tree (English names) - for a quick try
 */
test('create the user guide', async ({ page, cmsApi }) => {
  const language: GuideLanguage = process.env.GUIDE_LANGUAGE === 'en' ? 'en' : 'ar';
  const only = (process.env.GUIDE_ONLY ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  const origin = new URL(requiredEnv('CMS_BASE_URL')).origin;
  const date = new Date().toISOString().slice(0, 10);
  const folder = path.resolve(GUIDE_FOLDER, `${date}-${language}`);
  const log = (message: string): void => console.log(`[guide] ${message}`);
  const tour = new BackOfficeTour(page, cmsApi, language, origin, folder, log);

  // A guide of only some sections (GUIDE_ONLY, for a quick try) leaves out the general chapters
  const chapters: Chapter[] = [];
  if (only.length === 0) {
    log('sign-in page');
    chapters.push(await tour.signInChapter());
    log('content section');
    chapters.push(await tour.contentChapter());
  }
  const sections = await tour.sectionChapters(only);
  chapters.push(...sections.chapters);
  if (sections.sample && only.length === 0) {
    log('save buttons');
    chapters.push(await tour.publishingChapter(sections.sample));
  }

  const text = guideText(language);
  const file = path.resolve(GUIDE_FOLDER, guideFileName(language, date));
  writeFileSync(file, await writeWordGuide({ language, title: text.title, subtitle: text.subtitle, version: '1.0', date, address: `${origin}/umbraco/`, logo: await tour.portalLogo(), chapters }));
  const result: GuideResult = { file, language, createdAt: Date.now(), chapters: chapters.length, figures: tour.figureCount };
  writeFileSync(path.resolve(GUIDE_FOLDER, LATEST_GUIDE_FILE), JSON.stringify(result, null, 2));
  log(`done: ${file}`);
});
