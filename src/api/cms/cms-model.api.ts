import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CmsApi, withChanges, withNewBlockKeys, type CmsDocument, type CmsValue } from './cms.api';
import { failureOf } from '../base.api';
import { isTestDataName, testDataCreatedAt } from '../../domain/test-data-naming';

const API = '/umbraco/management/api/v1';

/** A document type exactly as the management API describes it. */
export type RawDocumentType = {
  id: string;
  alias: string;
  name: string;
  isElement: boolean;
  compositions?: { documentType: { id: string } }[];
  properties: {
    alias: string;
    name: string;
    variesByCulture: boolean;
    sortOrder: number;
    dataType: { id: string };
    container?: { id: string } | null;
    validation?: { mandatory?: boolean; mandatoryMessage?: string | null; regEx?: string | null; regExMessage?: string | null };
  }[];
  containers: { id: string; name: string | null; type: string; parent?: { id: string } | null; sortOrder: number }[];
};

export type RawDataType = { id: string; name: string; editorAlias: string; editorUiAlias?: string; values?: { alias: string; value: unknown }[] };

/** A page of the content tree with where it is ("Home > About Club > History"). */
export type TreePage = { id: string; parentId: string | null; documentType: string; path: string };

/** What the back office did with a value: refused (with what it said) or accepted. */
export type Attempt = { refused: boolean; says: string };

/**
 * The management API calls of the back-office tools (cms-model, cms-probe, cms-cleanup): reading the content model - document
 * types, data types, the whole content tree - and trying values on a page the tool made itself. Everything made is
 * tracked and removed by the clean-up, like a test's data; a page or picture the tools did not make is never changed.
 */
export class CmsModelApi extends CmsApi {
  async documentTypeRaw(id: string): Promise<RawDocumentType> {
    return this.valueOf(await this.get<RawDocumentType>(`${API}/document-type/${id}`), 'CMS_TYPE_UNREADABLE', `the document type ${id}`);
  }

  async dataType(id: string): Promise<RawDataType> {
    return this.valueOf(await this.get<RawDataType>(`${API}/data-type/${id}`), 'CMS_DATA_TYPE_UNREADABLE', `the data type ${id}`);
  }

  /** The name of a media type (the "Image" a picture field allows), or the id when it cannot be read. */
  async mediaTypeName(id: string): Promise<string> {
    const read = await this.get<{ name: string }>(`${API}/media-type/${id}`);
    return read.body?.name ?? id;
  }

  /** The name of a document type (an element type of a block list), or the id when it cannot be read. */
  async documentTypeName(id: string): Promise<string> {
    const read = await this.get<{ name: string }>(`${API}/document-type/${id}`);
    return read.body?.name ?? id;
  }

  /** Every page of the content tree (test data left out), each with its place in the tree, in the tree's order. */
  async contentTree(): Promise<TreePage[]> {
    const pages: TreePage[] = [];
    const visit = async (parentId: string | undefined, trail: string[]): Promise<void> => {
      for (const node of await this.treeChildren(parentId)) {
        const name = node.names['en-US'] || node.names['ar-EG'] || Object.values(node.names)[0] || node.id;
        if (Object.values(node.names).some((value) => isTestDataName(value))) {
          continue;
        }
        const where = [...trail, name.trim()];
        pages.push({ id: node.id, parentId: parentId ?? null, documentType: node.documentType, path: where.join(' > ') });
        if (node.hasChildren) {
          await visit(node.id, where);
        }
      }
    };
    await visit(undefined, []);
    return pages;
  }

  /**
   * Makes a draft copy of a page for the tools to try values on (like CmsApi.createCopy), named `name` in every language,
   * `changes` applied. When the back office refuses to make it, says why instead of failing.
   */
  async copyPage(sourceId: string, parentId: string | null, name: string, changes: readonly CmsValue[] = []): Promise<{ id: string } | Attempt> {
    const source = await this.document(sourceId);
    const id = crypto.randomUUID();
    const created = await this.post<{ title?: string; detail?: string }>(`${API}/document`, {
      id,
      parent: parentId ? { id: parentId } : null,
      documentType: { id: source.documentType?.id },
      template: source.template ? { id: source.template.id } : null,
      values: withChanges(source.values ?? [], changes).map((entry) => ({ alias: entry.alias, culture: entry.culture, segment: null, value: withNewBlockKeys(entry.value) })),
      variants: source.variants.map((variant) => ({ culture: variant.culture, segment: null, name })),
    });
    if (created.response.status() === 201) {
      this.track({ kind: 'document', id });
      return { id };
    }
    return { refused: true, says: plainText(notificationsOf(created.response.headers()) || created.body?.detail || created.body?.title || (await failureOf(created.response))) };
  }

  /**
   * Removes the test data that interrupted runs left anywhere in the content tree (and in the media library and the Recycle
   * Bins): pages and pictures whose every name is test data, made longer ago than `olderThanMs`, and - when `label` is given -
   * named with it (`probe`: only what an interrupted probe left). Returns what it removed.
   */
  async removeLeftovers(olderThanMs: number, label?: string): Promise<string[]> {
    const before = Date.now() - olderThanMs;
    const isLeftover = (names: string[]): boolean =>
      names.length > 0 && names.every((name) => isTestDataName(name) && (testDataCreatedAt(name) ?? Number.POSITIVE_INFINITY) < before && (!label || name.includes(`-${label}-`)));
    const removed: string[] = [];
    const visit = async (parentId: string | undefined): Promise<void> => {
      for (const node of await this.treeChildren(parentId)) {
        const names = Object.values(node.names);
        if (isLeftover(names)) {
          if (!(await this.removeDocument(node.id))) {
            removed.push(`page ${names[0]}`);
          }
        } else if (node.hasChildren && !names.some((name) => isTestDataName(name))) {
          await visit(node.id);
        }
      }
    };
    await visit(undefined);
    // The media library's root and both Recycle Bins
    if (!label) {
      removed.push(...(await this.sweepLeftovers([], olderThanMs)));
    }
    return removed;
  }

  /**
   * Tries one changed value on a page the tool made (`base`: the page as made): first the form's own check (validate), then
   * the save itself, where the server's own checks run. Returns whether it was refused and what the back office said.
   */
  async tryValue(base: CmsDocument, change: CmsValue): Promise<Attempt> {
    if (!base.variants.every((variant) => isTestDataName(variant.name))) {
      throw new Error(`CMS_NOT_TEST_DATA: ${base.id} is not a page the tools made - it is left alone`);
    }
    const values = (base.values ?? []).filter((entry) => !(entry.alias === change.alias && entry.culture === change.culture));
    values.push(change);
    const body = {
      template: base.template ? { id: base.template.id } : null,
      values: values.map((entry) => ({ alias: entry.alias, culture: entry.culture, segment: null, value: entry.value })),
      variants: base.variants.map((variant) => ({ culture: variant.culture, segment: null, name: variant.name })),
    };
    const validated = await this.put<{ errors?: Record<string, unknown>; title?: string }>(`/umbraco/management/api/v1.1/document/${base.id}/validate`, {
      ...body,
      cultures: base.variants.map((variant) => variant.culture).filter(Boolean),
    });
    if (validated.response.status() >= 400) {
      const index = values.length - 1;
      const reasons = Object.entries(validated.body?.errors ?? {})
        .filter(([key]) => key.includes(`values[${index}]`) || !key.includes('values['))
        .flatMap(([, reason]) => (Array.isArray(reason) ? reason.map(String) : [String(reason)]));
      return { refused: true, says: plainText(reasons.join(' / ') || validated.body?.title || (await failureOf(validated.response))) };
    }
    const saved = await this.put<{ title?: string; detail?: string }>(`${API}/document/${base.id}`, body);
    const said = notificationsOf(saved.response.headers());
    if (!saved.response.ok()) {
      return { refused: true, says: plainText(said || saved.body?.detail || saved.body?.title || (await failureOf(saved.response))) };
    }
    return { refused: false, says: plainText(said) };
  }

  /**
   * Uploads a picture to the media library the way the back office does (a temporary file, then a media item of the given
   * type). The item is removed by the clean-up; its name is the file's (a test-data name). Returns what the server said.
   */
  async uploadPicture(file: string, mediaTypeId: string): Promise<Attempt> {
    const name = path.basename(file);
    if (!isTestDataName(name)) {
      throw new Error(`CMS_NOT_TEST_DATA: ${name} - the tools only upload files named as test data`);
    }
    const temporaryId = crypto.randomUUID();
    const temporary = await this.page.request.post(`${this.apiBaseUrl()}${API}/temporary-file`, {
      headers: { Authorization: await this.bearer() },
      multipart: { Id: temporaryId, File: { name, mimeType: mimeOf(name), buffer: readFileSync(file) } },
    });
    if (!temporary.ok()) {
      return { refused: true, says: `the upload itself was refused: ${notificationsOf(temporary.headers()) || (await failureOf(temporary))}` };
    }
    const id = crypto.randomUUID();
    const created = await this.post<{ title?: string; detail?: string }>(`${API}/media`, {
      id,
      parent: null,
      mediaType: { id: mediaTypeId },
      values: [{ alias: 'umbracoFile', culture: null, segment: null, value: { temporaryFileId: temporaryId } }],
      variants: [{ culture: null, segment: null, name }],
    });
    if (created.response.status() === 201) {
      this.track({ kind: 'media', id });
      return { refused: false, says: notificationsOf(created.response.headers()) };
    }
    return { refused: true, says: notificationsOf(created.response.headers()) || created.body?.detail || created.body?.title || (await failureOf(created.response)) };
  }
}

/** A message as text: the back office puts some words in <strong>. */
const plainText = (message: string): string => message.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** The messages the back office sends with an answer (header umb-notifications), as one line. */
const notificationsOf = (headers: Record<string, string>): string => {
  const raw = headers['umb-notifications'];
  if (!raw) {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((entry) => {
        const note = entry as { category?: string; message?: string; title?: string };
        return [note.category ?? note.title, note.message].filter(Boolean).join(': ');
      })
      .filter(Boolean)
      .join(' / ');
  } catch {
    return raw;
  }
};

const mimeOf = (name: string): string =>
  ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' })[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
