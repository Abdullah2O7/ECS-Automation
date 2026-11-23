import { configOf, editorName, rulesOf, type ContentModel, type FieldModel, type TypeModel } from '../../domain/cms-model';
import type { CmsModelApi, RawDataType, RawDocumentType, TreePage } from '../../api/cms/cms-model.api';

/** Where the tools write what they find, besides docs/ (gitignored, for scripts). */
export const MODEL_OUTPUT = 'test-output/cms-model';

/** How many places of a kind of page the model names. */
const PLACES_SHOWN = 3;

export type ReadModel = { model: ContentModel; pages: TreePage[]; dataTypes: Map<string, RawDataType> };

/**
 * Reads the content model through the management API: every page of the content tree, the kind of each, and for each kind
 * its fields - with the fields of its compositions, its tabs and groups, and the configuration of each field's data type.
 * The kinds that can be created somewhere but have no page yet are included too. Read only.
 */
export const readContentModel = async (api: CmsModelApi, log: (line: string) => void): Promise<ReadModel> => {
  const pages = await api.contentTree();
  log(`${pages.length} pages in the content tree`);
  const raw = new Map<string, RawDocumentType>();
  const typeOf = async (id: string): Promise<RawDocumentType> => {
    let type = raw.get(id);
    if (!type) {
      type = await api.documentTypeRaw(id);
      raw.set(id, type);
    }
    return type;
  };

  // The kinds used in the tree, then the kinds that can be created under them
  const kinds: string[] = [...new Set(pages.map((page) => page.documentType))];
  const allowed = new Map<string, string[]>();
  for (let index = 0; index < kinds.length; index += 1) {
    const children = await api.allowedChildTypes(kinds[index]);
    allowed.set(kinds[index], children.map((child) => child.name));
    for (const child of children) {
      if (!kinds.includes(child.id)) {
        kinds.push(child.id);
      }
    }
  }

  const dataTypes = new Map<string, RawDataType>();
  const names = new Map<string, string>();
  const nameOf = (id: string): string => names.get(id) ?? id;
  const types: TypeModel[] = [];
  for (const id of kinds) {
    const type = await typeOf(id);
    // The fields and containers of the type and of every type it is composed of
    const parts: RawDocumentType[] = [];
    const collect = async (part: RawDocumentType, seen: Set<string>): Promise<void> => {
      parts.push(part);
      for (const composition of part.compositions ?? []) {
        if (!seen.has(composition.documentType.id)) {
          seen.add(composition.documentType.id);
          await collect(await typeOf(composition.documentType.id), seen);
        }
      }
    };
    await collect(type, new Set([id]));
    const containers = new Map(parts.flatMap((part) => part.containers).map((container) => [container.id, container]));
    const placeOf = (containerId: string | undefined): { tab: string | null; group: string | null; order: number[] } => {
      const container = containerId ? containers.get(containerId) : undefined;
      if (!container) {
        return { tab: null, group: null, order: [0, 0] };
      }
      const parent = container.parent ? containers.get(container.parent.id) : undefined;
      if (container.type === 'Tab') {
        return { tab: container.name?.trim() || null, group: null, order: [container.sortOrder, -1] };
      }
      return { tab: parent?.name?.trim() || null, group: container.name?.trim() || null, order: [parent?.sortOrder ?? -1, container.sortOrder] };
    };

    const fields: (FieldModel & { order: number[] })[] = [];
    for (const property of parts.flatMap((part) => part.properties)) {
      let dataType = dataTypes.get(property.dataType.id);
      if (!dataType) {
        dataType = await api.dataType(property.dataType.id);
        dataTypes.set(property.dataType.id, dataType);
      }
      const config = configOf(dataType.values);
      // Names for the ids the configuration holds: the media types a picker allows, the element types of blocks
      for (const mediaType of typeof config.filter === 'string' ? config.filter.split(',').map((part) => part.trim()).filter(Boolean) : []) {
        if (!names.has(mediaType)) {
          names.set(mediaType, await api.mediaTypeName(mediaType));
        }
      }
      for (const block of Array.isArray(config.blocks) ? (config.blocks as { contentElementTypeKey?: string }[]) : []) {
        if (block.contentElementTypeKey && !names.has(block.contentElementTypeKey)) {
          names.set(block.contentElementTypeKey, await api.documentTypeName(block.contentElementTypeKey));
        }
      }
      const validation = property.validation ?? {};
      const field = {
        editor: dataType.editorAlias,
        required: validation.mandatory === true,
        requiredMessage: validation.mandatoryMessage || undefined,
        pattern: validation.regEx || undefined,
        patternMessage: validation.regExMessage || undefined,
      };
      const place = placeOf(property.container?.id);
      fields.push({
        alias: property.alias,
        name: property.name.trim(),
        tab: place.tab,
        group: place.group,
        editorName: editorName(dataType.editorAlias, config),
        perLanguage: property.variesByCulture,
        rules: rulesOf(field, config, nameOf),
        config,
        ...field,
        order: [...place.order, property.sortOrder],
      });
    }
    fields.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);
    const placed = pages.filter((page) => page.documentType === id);
    types.push({
      id,
      alias: type.alias,
      name: type.name,
      usedAt: placed.slice(0, PLACES_SHOWN).map((page) => page.path),
      pageCount: placed.length,
      allowedChildren: allowed.get(id) ?? [],
      fields: fields.map(({ order: _order, ...field }) => field),
    });
    log(`${type.name}: ${fields.length} fields`);
  }
  return { model: { generatedAt: new Date().toISOString(), host: new URL(process.env.CMS_BASE_URL ?? 'https://unknown').host, types }, pages, dataTypes };
};
