/**
 * The user guide as data: the back-office tour (back-office-tour.ts) fills it, the Word writer (word-guide.ts) prints it.
 * Pure types - no browser, no file system.
 */

export type GuideLanguage = 'ar' | 'en';

/** A piece of text; `bold` marks a label of the screen (kept as the screen shows it). */
export type Run = { text: string; bold?: boolean };

/** A screenshot with its numbered badges already drawn on it. */
export type Figure = { kind: 'figure'; file: string; width: number; height: number; caption: string };
/** One numbered action ("Click Save and publish"); numbered within its procedure, matching the badges. */
export type Step = { kind: 'step'; runs: Run[] };
/** A note under the steps (required fields, defaults, what a button does). */
export type Note = { kind: 'note'; runs: Run[] };
/** Plain text between the steps. */
export type Paragraph = { kind: 'para'; runs: Run[] };

export type Block = Figure | Step | Note | Paragraph;

/** One task of a chapter ("Edit the Contact page", "Create a news item"). */
export type Procedure = { title: string; blocks: Block[] };

/** One chapter: a section of the back office (a node of the content tree), or Signing in / Publishing. */
export type Chapter = { title: string; intro: Run[][]; procedures: Procedure[] };

export type Guide = {
  language: GuideLanguage;
  title: string;
  subtitle: string;
  version: string;
  date: string;
  /** The back office address the guide was made from. */
  address: string;
  /** The club's logo (a file), when the portal has one. */
  logo?: string;
  chapters: Chapter[];
};

/** A label of the screen, in bold. */
export const b = (text: string): Run => ({ text, bold: true });

/** Joins plain text and bold labels into runs: line('Click ', b('Save'), '.'). */
export const line = (...parts: (string | Run)[]): Run[] => parts.filter((part) => part !== '').map((part) => (typeof part === 'string' ? { text: part } : part));
