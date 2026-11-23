import type { GuideLanguage } from './guide-model.ts';

/** Where the user guide is written; shared by the guide run and the dashboard (which offers the file for download). */
export const GUIDE_FOLDER = 'test-output/user-guide';

/** What the last guide run produced (written when it finishes). */
export const LATEST_GUIDE_FILE = 'latest.json';

export type GuideResult = { file: string; language: GuideLanguage; createdAt: number; chapters: number; figures: number };

export const guideFileName = (language: GuideLanguage, date: string): string => `ECS-Back-Office-User-Guide-${language === 'ar' ? 'AR' : 'EN'}-${date}.docx`;
