/**
 * Shared text helpers for reading values out of the application under test.
 *
 * Many applications decorate content with icon fonts, and an icon font renders as a real character in the
 * Private Use Area of Unicode. It carries no meaning and is invisible to a human reader, but it is
 * part of the element's text - so the Status cell of a grid reads `"\nActive"`, and `trim()`
 * does not touch it because it is not whitespace.
 *
 * Values read from the UI are therefore normalised before being compared with test data.
 */

/**
 * Strips icon-font glyphs and collapses whitespace, so a rendered value can be compared with the
 * value a scenario specifies.
 *
 * `"\nActive"` becomes `"Active"`; `"Clubs"` is unchanged.
 */
export const normalizeText = (text: string): string =>
  text
    // Unicode Private Use Area: where icon fonts put their glyphs.
    .replace(/[-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Escapes a value so it can be matched literally inside a regular expression - a file name, a
 * dropdown option - where `.`, `(` and `+` would otherwise be read as pattern syntax.
 */
export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Named entities worth decoding in a summary; anything else is left as written. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
};

/**
 * The readable text of an HTML fragment, as a person would read it: tags dropped, entities decoded, whitespace
 * collapsed. For comparing a rich-text value from the API with what the screen shows.
 */
/** The tags a browser draws inside a line of text: they add no space of their own ("<strong>Mansoura</strong>, where"). */
const INLINE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var)(?:\s[^>]*)?>/gi;

export const htmlToText = (html: string): string =>
  normalizeText(
    html
      // An inline tag (<strong>, <a> ...) runs into the text around it, as a browser shows it; any other tag breaks the text
      .replace(INLINE_TAG, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (entity, hex?: string, decimal?: string, name?: string) => {
        if (hex) {
          return String.fromCodePoint(parseInt(hex, 16));
        }
        if (decimal) {
          return String.fromCodePoint(Number(decimal));
        }
        return NAMED_ENTITIES[(name ?? '').toLowerCase()] ?? entity;
      }),
  );

/**
 * Whether `shown` is `full`, or the beginning of it cut short - with or without a trailing ellipsis (`...` or `…`).
 * Both are compared as normalised text.
 */
export const isTruncationOf = (shown: string, full: string): boolean => {
  const start = normalizeText(shown).replace(/(?:\.{3}|…)$/, '').trim();
  return start.length > 0 && normalizeText(full).startsWith(start);
};
