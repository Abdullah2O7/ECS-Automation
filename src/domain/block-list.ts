/**
 * Umbraco block lists (a page's "banners", "facility cards"...) as the back office's management API returns them:
 * `{ layout: { 'Umbraco.BlockList': [{ contentKey }] }, contentData: [{ key, values: [{ alias, culture, value }] }] }`.
 * The layout gives the order the editor set; a value is either the same in every language (culture null) or per language.
 */

type BlockValue = { alias: string; culture: string | null; value: unknown };
type BlockContent = { key: string; values?: BlockValue[] };
type RawBlockList = { layout?: Record<string, { contentKey: string }[] | undefined>; contentData?: BlockContent[] };

/** One block, its fields read in one language (a field without a value in that language falls back to the shared one). */
export type Block = Record<string, unknown>;

/** The blocks of a block list in the order the editor set, each field in the given language. */
export const blocksOf = (raw: unknown, culture: string): Block[] => {
  const list = (raw ?? {}) as RawBlockList;
  const contents = new Map((list.contentData ?? []).map((content) => [content.key, content]));
  const order = Object.values(list.layout ?? {}).flatMap((entries) => entries ?? []).map((entry) => entry.contentKey);
  return order
    .map((key) => contents.get(key))
    .filter((content): content is BlockContent => content !== undefined)
    .map((content) => {
      const block: Block = {};
      for (const value of content.values ?? []) {
        if (value.culture === culture || (value.culture === null && !(value.alias in block))) {
          block[value.alias] = value.value;
        }
      }
      return block;
    });
};

/** The blocks switched on ("Is Active": a block without the field counts as active). */
export const activeBlocks = (blocks: readonly Block[]): Block[] => blocks.filter((block) => block.isActive !== false);

/** A text field of a block, trimmed ('' when empty or missing). */
export const blockText = (block: Block, alias: string): string => (typeof block[alias] === 'string' ? (block[alias] as string).trim() : '');
