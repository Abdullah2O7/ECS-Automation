import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../fixtures/cms.fixture';
import { CmsModelApi, type Attempt, type TreePage } from '../../api/cms/cms-model.api';
import type { CmsDocument, CmsValue } from '../../api/cms/cms.api';
import { lengthInMessage, lengthOfPattern, rulesMarkdown, type FieldModel, type ProbeReport, type ProbeResult, type TypeModel } from '../../domain/cms-model';
import { KILOBYTE, MEGABYTE, type TestFileKind } from '../../utils/core/test-files';
import { readContentModel } from './read-model';

/**
 * cms-probe (npx playwright test --config=playwright.tools.config.ts cms-probe) - finds out what the back office really refuses, and what it says, before the test cases are written:
 * for each kind of page it makes a draft copy of one of its pages (named auto-test-..., never published), tries the
 * standard wrong values on each field - empty when required, one character over the limit, a value that does not match
 * the field's pattern, one item too many - and uploads test pictures of the sizes and formats the sheets ask about.
 * What the server answered goes to docs/cms-rules.md (and docs/cms-rules.json, which a later probe of some kinds adds to). The copies and the pictures are removed at the end, and nothing
 * else is changed.
 *
 *   PROBE="AboutUS,President & Founder"   only these kinds of page (their names or aliases, as in docs/cms-model.md);
 *                                         Home is probed only when named here
 *   PROBE_PICTURES=0                      without the picture uploads
 */
const TEXT_EDITORS = new Set(['Umbraco.TextBox', 'Umbraco.TextArea', 'Umbraco.EmailAddress']);
const RICH_TEXT_EDITORS = new Set(['Umbraco.RichText', 'Umbraco.TinyMCE']);
/** A rich text longer than any limit seen so far, to make the server name its own. */
const LONG_RICH_TEXT = 20_001;
/** A text for a field with no limit configured. */
const LONG_TEXT = 1_001;

/** The test pictures: the formats and sizes the sheets ask about. */
const PICTURES: { kind: TestFileKind; size: number; label: string }[] = [
  { kind: 'jpeg', size: 100 * KILOBYTE, label: 'JPEG, 100 KB' },
  { kind: 'png', size: 600 * KILOBYTE, label: 'PNG, 600 KB' },
  { kind: 'jpeg', size: 3 * MEGABYTE, label: 'JPEG, 3 MB' },
  { kind: 'gif', size: 100 * KILOBYTE, label: 'GIF, 100 KB' },
  { kind: 'gif', size: 600 * KILOBYTE, label: 'GIF, 600 KB' },
  { kind: 'bmp', size: 600 * KILOBYTE, label: 'BMP, 600 KB' },
];

const text = (length: number): string => 'ECS probe text  '.repeat(Math.ceil(length / 17)).slice(0, length);

/** The wrong values to try on a field (what was tried, and the value). */
const triesFor = (field: FieldModel, base: CmsDocument, culture: string | null): { tried: string; value: unknown }[] => {
  const tries: { tried: string; value: unknown }[] = [];
  const config = field.config;
  if (TEXT_EDITORS.has(field.editor)) {
    if (field.required) {
      tries.push({ tried: 'empty', value: '' });
    }
    const limit = textLimitOf(field) ?? configuredLimit(field);
    tries.push(limit ? { tried: `${limit + 1} characters (one over ${limit})`, value: text(limit + 1) } : { tried: `${LONG_TEXT} characters (no limit configured)`, value: text(LONG_TEXT) });
    if (field.pattern && !lengthOfPattern(field.pattern) && field.pattern !== '.+') {
      tries.push({ tried: 'a value that does not match its pattern', value: 'auto test value' });
    }
  } else if (RICH_TEXT_EDITORS.has(field.editor)) {
    if (field.required) {
      tries.push({ tried: 'empty', value: null });
    }
    tries.push({ tried: `${LONG_RICH_TEXT} characters of text`, value: { markup: `<p>${text(LONG_RICH_TEXT)}</p>`, blocks: null } });
  } else if (field.editor === 'Umbraco.MediaPicker3') {
    if (field.required) {
      tries.push({ tried: 'no picture', value: [] });
    }
    const max = (config.validationLimit as { max?: number | null } | undefined)?.max;
    const current = base.values?.find((entry) => entry.alias === field.alias && entry.culture === culture)?.value;
    if (max && Array.isArray(current) && current.length > 0) {
      const one = current[0] as Record<string, unknown>;
      tries.push({ tried: `${max + 1} pictures (one over ${max})`, value: Array.from({ length: max + 1 }, () => ({ ...one, key: crypto.randomUUID() })) });
    }
  } else if (field.required) {
    tries.push({ tried: 'empty', value: null });
  }
  return tries;
};

/** The box's own limit (maxChars), for a field whose pattern keeps it out of textLimitOf. */
const configuredLimit = (field: FieldModel): number | undefined =>
  typeof field.config.maxChars === 'number' && field.config.maxChars > 0 ? field.config.maxChars : undefined;

/** The configured length limit of a text field: its pattern's or its box's, the smaller. */
const textLimitOf = (field: FieldModel): number | undefined => {
  // A field with a pattern of its own (an email, a URL) refuses a plain text anyway: its length cannot be found this way
  if (!TEXT_EDITORS.has(field.editor) || (field.pattern && !lengthOfPattern(field.pattern) && field.pattern !== '.+')) {
    return undefined;
  }
  const limits = [lengthOfPattern(field.pattern)?.max, typeof field.config.maxChars === 'number' && field.config.maxChars > 0 ? field.config.maxChars : undefined].filter((limit): limit is number => limit !== undefined);
  return limits.length ? Math.min(...limits) : undefined;
};

/**
 * Whether the server refuses texts shorter than the configured `limit`: the longest text it keeps (found by halving) and
 * what it says about one character more. `undefined` when it keeps a text of the full configured length.
 */
const serverLimit = async (limit: number, attempt: (length: number) => Promise<Attempt>): Promise<{ longest: number; says: string } | undefined> => {
  const atLimit = await attempt(limit);
  if (!atLimit.refused) {
    return undefined;
  }
  // The server usually names its limit ("... maximum allowed length of 100 characters"): one more try confirms it
  const named = lengthInMessage(atLimit.says);
  if (named !== undefined && named < limit) {
    const over = await attempt(named + 1);
    const at = await attempt(named);
    if (over.refused && !at.refused) {
      return { longest: named, says: over.says };
    }
  }
  let kept = 0;
  let refused = limit;
  let says = atLimit.says;
  while (refused - kept > 1) {
    const middle = Math.floor((kept + refused) / 2);
    const answer = await attempt(middle);
    if (answer.refused) {
      refused = middle;
      says = answer.says;
    } else {
      kept = middle;
    }
  }
  return { longest: kept, says };
};

/**
 * The kinds of page to probe: the ones PROBE names, or every kind that has pages and fields - except a page at the root of
 * the tree (Home), whose copy would be a second site root: it is probed only when PROBE names it.
 */
const chosenKinds = (types: readonly TypeModel[], pages: readonly TreePage[]): TypeModel[] => {
  const wanted = (process.env.PROBE ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  const atRoot = (type: TypeModel): boolean => pages.some((page) => page.documentType === type.id && page.parentId === null);
  return types.filter((type) => type.pageCount > 0 && type.fields.length > 0 && (wanted.length === 0 ? !atRoot(type) : wanted.includes(type.name.trim().toLowerCase()) || wanted.includes(type.alias.toLowerCase())));
};

test('probe the back office', async ({ page, testData }) => {
  const log = (line: string): void => console.log(`[cms:probe] ${line}`);
  const api = new CmsModelApi(page);
  const { model, pages } = await readContentModel(api, () => undefined);
  const kinds = chosenKinds(model.types, pages);
  log(`kinds of page to probe: ${kinds.map((type) => type.name.trim()).join(', ') || 'none'}`);
  const fields: ProbeResult[] = [];
  const pictures: ProbeResult[] = [];
  try {
    // Copies an earlier, interrupted probe left behind (older than 90 minutes) are removed first
    const parents = [...new Set(kinds.map((type) => pages.find((candidate) => candidate.documentType === type.id)?.parentId).filter((id): id is string => Boolean(id)))];
    await api.sweepLeftovers(parents, 90 * 60_000).catch(() => []);

    for (const type of kinds) {
      const source = pages.find((candidate) => candidate.documentType === type.id);
      if (!source) {
        continue;
      }
      const name = type.name.trim();
      // A copy keeps the page's texts; when the back office wants them unique (a category name), they are made unique
      let copy = await api.copyPage(source.id, source.parentId, testData.name('probe')).catch((error: unknown) => ({ refused: true, says: String(error) }));
      if ('refused' in copy) {
        fields.push({ type: name, field: '(the whole page)', tried: 'a copy with the same texts as an existing page', outcome: 'refused', says: copy.says });
        const original = await api.document(source.id);
        const unique = (original.values ?? [])
          .filter((entry) => typeof entry.value === 'string' && TEXT_EDITORS.has(type.fields.find((field) => field.alias === entry.alias)?.editor ?? ''))
          .filter((entry) => { const field = type.fields.find((candidate) => candidate.alias === entry.alias); return !field?.pattern || Boolean(lengthOfPattern(field.pattern)); })
          .map((entry) => ({ ...entry, value: testData.name('probe') }));
        copy = await api.copyPage(source.id, source.parentId, testData.name('probe'), unique).catch((error: unknown) => ({ refused: true, says: String(error) }));
      }
      if ('refused' in copy) {
        fields.push({ type: name, field: '-', tried: 'a copy to try values on', outcome: 'could not try', says: copy.says });
        continue;
      }
      const base: CmsDocument = await api.document(copy.id);
      const cultures = base.variants.map((variant) => variant.culture).filter((culture): culture is string => Boolean(culture));
      const culture = cultures.includes('en-US') ? 'en-US' : (cultures[0] ?? null);
      for (const field of type.fields) {
        const language = field.perLanguage ? culture : null;
        const label = `${field.name} (${field.alias})`;
        const attempt = async (value: unknown): Promise<Attempt & { failed?: boolean }> =>
          api.tryValue(base, { alias: field.alias, culture: language, value } satisfies CmsValue).catch((error: unknown) => ({ refused: false, says: `could not try: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, failed: true }));
        log(`${name} / ${field.alias}`);
        for (const tried of triesFor(field, base, language)) {
          const answer = await attempt(tried.value);
          fields.push({ type: name, field: label, tried: tried.tried, outcome: answer.failed ? 'could not try' : answer.refused ? 'refused' : 'accepted', says: answer.says });
        }
        // The server can have a limit of its own, below the configured one (the form's check stops the longer texts first)
        const limit = textLimitOf(field);
        if (limit) {
          const own = await serverLimit(limit, async (length) => attempt(text(length)));
          if (own) {
            fields.push({ type: name, field: label, tried: `${own.longest + 1} characters (the longest kept is ${own.longest})`, outcome: 'refused', says: own.says });
          }
        }
      }
      log(`${name}: ${fields.filter((result) => result.type === name).length} values tried`);
    }

    if (process.env.PROBE_PICTURES !== '0') {
      const imageType = model.types.flatMap((type) => type.fields).map((field) => field.config.filter).find((filter): filter is string => typeof filter === 'string' && filter.length > 0)?.split(',')[0];
      if (imageType) {
        for (const picture of PICTURES) {
          const answer = await api.uploadPicture(testData.file(picture.kind, 'probe', picture.size), imageType).catch((error: unknown) => ({ refused: false, says: `could not try: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, failed: true }));
          pictures.push({ type: 'Media library', field: 'Image', tried: picture.label, outcome: 'failed' in answer ? 'could not try' : answer.refused ? 'refused' : 'accepted', says: answer.says });
        }
        log(`${pictures.length} pictures tried`);
      }
    }
  } finally {
    const left = await api.cleanUp();
    for (const problem of left) {
      log(`NOT REMOVED: ${problem}`);
    }
  }

  // A probe of some kinds keeps what an earlier probe found about the others
  const file = path.resolve('docs/cms-rules.json');
  const earlier: ProbeReport | undefined = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProbeReport) : undefined;
  const probed = new Set(kinds.map((type) => type.name.trim()));
  const report: ProbeReport = {
    generatedAt: new Date().toISOString(),
    host: model.host,
    fields: [...(earlier?.fields ?? []).filter((result) => !probed.has(result.type)), ...fields],
    pictures: pictures.length ? pictures : (earlier?.pictures ?? []),
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2));
  writeFileSync(path.resolve('docs/cms-rules.md'), rulesMarkdown(report));
  log(`docs/cms-rules.md written: ${fields.length} field values and ${pictures.length} pictures tried`);
});
