/**
 * The back office's content model as the tests need it: every kind of page (document type) with its fields, the rules the
 * back office is configured with, and - from the probe - what the server really refuses and says. Pure: the data is read
 * from the management API by src/scripts/cms-tools; here it is only shaped and written as Markdown.
 */

/** One field of a kind of page. */
export type FieldModel = {
  alias: string;
  /** The label the form shows. */
  name: string;
  /** The tab and the group the field is drawn in (null: the form has none). */
  tab: string | null;
  group: string | null;
  /** Umbraco's editor (`Umbraco.TextBox`) and a plain name for it ("Text box"). */
  editor: string;
  editorName: string;
  required: boolean;
  requiredMessage?: string;
  pattern?: string;
  patternMessage?: string;
  /** Whether each language has its own value. */
  perLanguage: boolean;
  /** The configuration rules, in words ("at most 300 characters", "1 picture at most"). */
  rules: string[];
  /** The raw data type configuration, for anything the rules do not say. */
  config: Record<string, unknown>;
};

/** One kind of page (document type). */
export type TypeModel = {
  id: string;
  alias: string;
  name: string;
  /** Where its pages are in the content tree ("Home > About Club > History"); the first few. */
  usedAt: string[];
  pageCount: number;
  /** What can be created under it. */
  allowedChildren: string[];
  fields: FieldModel[];
};

export type ContentModel = { generatedAt: string; host: string; types: TypeModel[] };

/** One thing the probe tried, and what the back office did. */
export type ProbeResult = {
  type: string;
  field: string;
  tried: string;
  outcome: 'refused' | 'accepted' | 'could not try';
  /** What the back office said (its message), or why the probe could not try. */
  says: string;
};

export type ProbeReport = { generatedAt: string; host: string; fields: ProbeResult[]; pictures: ProbeResult[] };

const EDITOR_NAMES: Readonly<Record<string, string>> = {
  'Umbraco.TextBox': 'Text box',
  'Umbraco.TextArea': 'Text area',
  'Umbraco.RichText': 'Rich text',
  'Umbraco.TinyMCE': 'Rich text',
  'Umbraco.MediaPicker3': 'Media picker',
  'Umbraco.MultiNodeTreePicker': 'Content picker (several)',
  'Umbraco.ContentPicker': 'Content picker',
  'Umbraco.TrueFalse': 'Yes / No switch',
  'Umbraco.BlockList': 'Block list',
  'Umbraco.BlockGrid': 'Block grid',
  'Umbraco.DateTime': 'Date and time',
  'Umbraco.Integer': 'Whole number',
  'Umbraco.Decimal': 'Number',
  'Umbraco.EmailAddress': 'Email',
  'Umbraco.DropDown.Flexible': 'Drop-down',
  'Umbraco.CheckBoxList': 'Check boxes',
  'Umbraco.RadioButtonList': 'Radio buttons',
  'Umbraco.MultipleTextstring': 'List of texts',
  'Umbraco.MultiUrlPicker': 'Links',
  'Umbraco.Tags': 'Tags',
  'Umbraco.ColorPicker': 'Colour',
  'Umbraco.UploadField': 'File upload',
  'Umbraco.ImageCropper': 'Image',
  'Umbraco.Label': 'Label (read only)',
};

/** A plain name for an editor; a custom editor configured as a switch (it has On / Off labels) is called one. */
export const editorName = (editor: string, config: Record<string, unknown> = {}): string =>
  EDITOR_NAMES[editor] ?? ('labelOn' in config ? 'Yes / No switch (custom)' : editor.replace(/^Umbraco\./, ''));

/** The length a pattern like `^.{1,100}$` allows, when it is one. */
export const lengthOfPattern = (pattern: string | undefined): { min: number; max?: number } | undefined => {
  const match = /^\^?\.\{(\d+),(\d*)\}\$?$/.exec(pattern?.trim() ?? '');
  return match ? { min: Number(match[1]), ...(match[2] ? { max: Number(match[2]) } : {}) } : undefined;
};

/** The length a server message names ("... exceeds the maximum allowed length of 100 characters"). */
export const lengthInMessage = (message: string): number | undefined => {
  const match = /(?:maximum (?:allowed )?length of|must not exceed|at most)\s+(\d+)\s*(?:characters|chars)/i.exec(message);
  return match ? Number(match[1]) : undefined;
};

/** Configuration values as Umbraco sends them (`[{ alias, value }]`) turned into an object. */
export const configOf = (values: readonly { alias: string; value: unknown }[] | undefined): Record<string, unknown> =>
  Object.fromEntries((values ?? []).filter((entry) => !/^umbMigration/i.test(entry.alias)).map((entry) => [entry.alias, entry.value]));

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The rules a field's configuration sets, in words. `names` turns ids in the configuration (allowed media types, block
 * element types) into names.
 */
export const rulesOf = (field: { editor: string; required: boolean; requiredMessage?: string; pattern?: string; patternMessage?: string }, config: Record<string, unknown>, names: (id: string) => string = (id) => id): string[] => {
  const rules: string[] = [];
  if (field.required) {
    rules.push(`required${field.requiredMessage ? ` ("${field.requiredMessage}")` : ''}`);
  }
  const length = lengthOfPattern(field.pattern);
  if (length) {
    rules.push(`${length.max !== undefined ? `${length.min}-${length.max}` : `at least ${length.min}`} characters by pattern${field.patternMessage ? ` ("${field.patternMessage}")` : ''}`);
  } else if (field.pattern) {
    rules.push(`must match ${field.pattern}${field.patternMessage ? ` ("${field.patternMessage}")` : ''}`);
  }
  if (typeof config.maxChars === 'number' && config.maxChars > 0) {
    rules.push(`at most ${config.maxChars} characters (the box stops typing there)`);
  }
  const limit = config.validationLimit as { min?: number | null; max?: number | null } | undefined;
  const items = field.editor === 'Umbraco.MediaPicker3' ? 'picture' : 'item';
  if (limit && (limit.min || limit.max)) {
    rules.push(limit.min && limit.max ? `${limit.min}-${plural(limit.max, items)}` : limit.max ? `${plural(limit.max, items)} at most` : `at least ${plural(limit.min ?? 0, items)}`);
  }
  if (field.editor === 'Umbraco.MediaPicker3') {
    if (config.multiple === false && !(limit && limit.max)) {
      rules.push('one picture');
    }
    if (typeof config.filter === 'string' && config.filter) {
      rules.push(`only ${config.filter.split(',').map((id) => names(id.trim())).join(' / ')}`);
    }
  }
  if (field.editor === 'Umbraco.BlockList' && Array.isArray(config.blocks)) {
    const kinds = (config.blocks as { contentElementTypeKey?: string }[]).map((block) => names(block.contentElementTypeKey ?? '?'));
    rules.push(`blocks: ${kinds.join(', ')}`);
  }
  if (field.editor === 'Umbraco.TrueFalse' || 'labelOn' in config) {
    rules.push(`${config.default === true ? 'on' : 'off'} by default${config.labelOn ? ` (${String(config.labelOn)} / ${String(config.labelOff ?? '')})` : ''}`);
  }
  if (typeof config.showIfChecked === 'string' && config.showIfChecked) {
    rules.push(`when on, shows ${config.showIfChecked.split(',').map((alias) => alias.trim()).join(', ')}`);
  }
  if (typeof config.min === 'number' || typeof config.max === 'number') {
    rules.push(typeof config.min === 'number' && typeof config.max === 'number' ? `from ${config.min} to ${config.max}` : typeof config.min === 'number' ? `at least ${config.min}` : `at most ${String(config.max)}`);
  }
  if (typeof config.format === 'string' && config.format) {
    rules.push(`format ${config.format}`);
  }
  if ((field.editor === 'Umbraco.RichText' || field.editor === 'Umbraco.TinyMCE') && typeof config.maxImageSize === 'number') {
    rules.push(`pictures in the text up to ${config.maxImageSize} px`);
  }
  if (Array.isArray(config.items) && config.items.length > 0 && config.items.length <= 12) {
    rules.push(`choices: ${(config.items as unknown[]).map((item) => (typeof item === 'string' ? item : String((item as { value?: unknown }).value ?? ''))).join(', ')}`);
  }
  return rules;
};

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The content model as a Markdown page (docs/cms-model.md). */
export const modelMarkdown = (model: ContentModel): string => {
  const lines = [
    '# Back-office content model',
    '',
    `Written by the cms-model tool on ${model.generatedAt.slice(0, 16).replace('T', ' ')} from ${model.host} - read only, do not edit by hand.`,
    'Every kind of page in the content tree, with its fields and the rules the back office is configured with. What the',
    'server really refuses (its own checks and messages) is in [cms-rules.md](cms-rules.md) (the cms-probe tool).',
    '',
    `Kinds of page: ${model.types.map((type) => `[${type.name}](#${anchorOf(type.name)})`).join(' · ')}`,
    '',
  ];
  for (const type of model.types) {
    lines.push(`## ${type.name}`, '');
    lines.push(`\`${type.alias}\` (${type.id}) - ${type.pageCount === 0 ? 'no page of this kind yet' : `${plural(type.pageCount, 'page')}: ${type.usedAt.join('; ')}${type.pageCount > type.usedAt.length ? '; ...' : ''}`}`);
    if (type.allowedChildren.length > 0) {
      lines.push('', `Can be created under it: ${type.allowedChildren.join(', ')}`);
    }
    lines.push('');
    if (type.fields.length === 0) {
      lines.push('No fields (only its name).', '');
      continue;
    }
    lines.push('| Tab / group | Field | Alias | Editor | Per language | Rules |', '|---|---|---|---|---|---|');
    for (const field of type.fields) {
      const where = [field.tab, field.group].filter(Boolean).join(' / ') || '-';
      lines.push(`| ${cell(where)} | ${cell(field.name)} | \`${field.alias}\` | ${cell(field.editorName)} | ${field.perLanguage ? 'yes' : 'no'} | ${cell(field.rules.join('; ') || '-')} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
};

/** What the probe found, as a Markdown page (docs/cms-rules.md). */
export const rulesMarkdown = (report: ProbeReport): string => {
  const table = (results: readonly ProbeResult[]): string[] => [
    '| Kind of page | Field | Tried | Result | The back office says |',
    '|---|---|---|---|---|',
    ...results.map((result) => `| ${cell(result.type)} | ${cell(result.field)} | ${cell(result.tried)} | ${result.outcome === 'refused' ? '**refused**' : result.outcome} | ${cell(result.says || '-')} |`),
  ];
  return `${[
    '# What the back office really refuses',
    '',
    `Written by the cms-probe tool on ${report.generatedAt.slice(0, 16).replace('T', ' ')} from ${report.host} - do not edit by hand.`,
    'The probe made a draft copy of a page of each kind (named auto-test-...), tried each value on it, wrote down what the',
    'back office answered, and removed the copy and the pictures it uploaded. These are the messages and limits to expect in',
    'the test cases - the configured rules are in [cms-model.md](cms-model.md).',
    '',
    '## Fields',
    '',
    ...(report.fields.length ? table(report.fields) : ['Nothing was probed.']),
    '',
    '## Pictures (uploaded to the media library)',
    '',
    'The test pictures are real 1x1 pictures grown to the size with comment blocks, so they compress very well: the server',
    'shrinks a picture before it checks its size, and a photo of the same size may still be too large after shrinking.',
    '',
    ...(report.pictures.length ? table(report.pictures) : ['Not probed.']),
  ].join('\n')}\n`;
};

const anchorOf = (heading: string): string =>
  heading.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
