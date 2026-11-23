import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page, Response } from '@playwright/test';
import { BaseApi, failureOf, type ApiRead } from '../base.api';
import { logger } from '../../utils/logger/logger';
import { isTestDataName, testDataCreatedAt } from '../../domain/test-data-naming';

/** What the tests create in the back office, as the server reported it (the id comes from the server, never guessed). */
export type CreatedItem = { kind: 'document' | 'media'; id: string };

type TreeItem = { id: string; hasChildren: boolean; documentType?: { id: string }; variants?: { name: string; culture: string | null; state?: string }[] };
type TreePage = { total: number; items: TreeItem[] };

/** An article (or a media item) as the management API returns it. */
export type CmsDocument = {
  id: string;
  isTrashed: boolean;
  documentType?: { id: string };
  template?: { id: string } | null;
  variants: { culture: string | null; name: string; state?: string; publishDate?: string | null }[];
  values?: { alias: string; culture: string | null; value: unknown }[];
};

/** A node of the content tree, as the tree shows it. */
export type ContentNode = { id: string; hasChildren: boolean; documentType: string; names: Record<string, string> };

/** A document type: its name and fields (in the order the form shows them) and its groups and tabs. */
export type DocumentTypeInfo = {
  id: string;
  name: string;
  description: string | null;
  properties: { alias: string; name: string; description: string | null; mandatory: boolean; dataType: string; container: string | null; sortOrder: number }[];
  containers: { id: string; name: string | null; type: string; parent: string | null; sortOrder: number }[];
  /** The document types whose fields this one includes (compositions). */
  compositions: string[];
};

/** One field value of a document in one language (`culture: null` for a field that is the same in every language). */
export type CmsValue = { alias: string; culture: string | null; value: unknown };

/** One category of the News Category node, with every language's name and whether it is published. */
export type CategoryNode = { names: string[]; published: boolean };

type MediaItem = { id: string; isTrashed: boolean; variants: { name: string }[] };

const API = '/umbraco/management/api/v1';

/**
 * The back office's token, kept for the worker's later cases (see CmsApi.bearer). In memory only - except for verification
 * runs that set KEEP_SIGN_IN_FILE (see session.ts), which keep it next to that file for the next run.
 */
/** Where the nodes under Home are (News, Contact US, ...) and Home itself: found once per worker - they do not move during a run. */
const nodesUnderHome = new Map<string, string>();
let homeIdKept: Promise<string> | undefined;

const keptTokenFile = process.env.KEEP_SIGN_IN_FILE ? `${process.env.KEEP_SIGN_IN_FILE}.token` : undefined;
let workerToken = keptTokenFile && existsSync(keptTokenFile) ? readFileSync(keptTokenFile, 'utf8') : '';

const keepToken = (token: string): void => {
  workerToken = token;
  if (keptTokenFile) {
    writeFileSync(keptTokenFile, token, { mode: 0o600 });
  }
};

/**
 * The Umbraco management API - the one the back office itself uses. The tests use it for three things only:
 * finding where the news section is, reading back what a screen saved ("retrieved from the system"), and removing
 * EXACTLY the data a test created.
 *
 * Authentication: the back office calls its API with a bearer token, which is read from the page's own requests and
 * kept in memory (never written anywhere).
 *
 * Cleanup rule: an item is deleted only when (1) the server reported its id as created by this test's own browser and
 * (2) its name still carries the test prefix. An item that fails either check is left alone and reported.
 */
export class CmsApi extends BaseApi {
  protected override readonly apiBaseUrlVariable: string = 'CMS_BASE_URL';
  private authorization = '';
  private readonly created: CreatedItem[] = [];

  constructor(page: Page) {
    super(page);
    page.on('request', (request) => {
      const header = request.headers()['authorization'];
      if (header && request.url().includes('/management/api/')) {
        this.authorization = header;
      }
    });
    page.on('response', (response) => this.rememberCreation(response));
  }

  protected override async headers(): Promise<Record<string, string>> {
    return { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: await this.bearer() };
  }

  /**
   * The token the back office is using. It is kept for the worker's later cases (opening the back office just to read it
   * costs half a minute on a slow day); when the server no longer takes it (401), a new one is read in a tab of its own -
   * never in the case's tab, which may be in the middle of a form.
   */
  protected async bearer(): Promise<string> {
    this.authorization ||= workerToken;
    if (!this.authorization) {
      this.authorization = await this.tokenFromNewTab();
    }
    keepToken(this.authorization);
    return this.authorization;
  }

  /** Opens the back office in a new tab of the signed-in browser and reads the token of its first API call. */
  private async tokenFromNewTab(): Promise<string> {
    const tab = await this.page.context().newPage();
    try {
      const call = tab.waitForRequest((request) => Boolean(request.headers()['authorization']) && request.url().includes('/management/api/'), { timeout: 90_000 });
      await tab.goto(`${this.apiBaseUrl()}/umbraco/section/content`, { waitUntil: 'domcontentloaded' });
      const token = (await call.catch(() => undefined))?.headers()['authorization'];
      if (!token) {
        throw new Error('CMS_API_NOT_AUTHENTICATED: the back office made no API call with a token - is the session signed in?');
      }
      return token;
    } finally {
      await tab.close().catch(() => undefined);
    }
  }

  /** Runs a request; when the kept token has expired (401), once more with a new one. */
  private async withFreshToken<T>(send: () => Promise<ApiRead<T>>): Promise<ApiRead<T>> {
    const first = await send();
    if (first.response.status() !== 401) {
      return first;
    }
    this.authorization = '';
    keepToken('');
    return send();
  }

  protected override get<T>(path: string, params?: Record<string, string>, timeout?: number): Promise<ApiRead<T>> {
    return this.withFreshToken(() => super.get<T>(path, params, timeout));
  }

  protected override post<T>(path: string, body: unknown, timeout?: number): Promise<ApiRead<T>> {
    return this.withFreshToken(() => super.post<T>(path, body, timeout));
  }

  protected override put<T>(path: string, body: unknown): Promise<ApiRead<T>> {
    return this.withFreshToken(() => super.put<T>(path, body));
  }

  protected override delete<T>(path: string): Promise<ApiRead<T>> {
    return this.withFreshToken(() => super.delete<T>(path));
  }

  //=====================Reading=====================
  /** The id of the News node (the list whose children are the articles), found by its document type under Home. */
  async newsListId(newsListType: string): Promise<string> {
    return this.childOfHome(newsListType, 'CMS_NEWS_NOT_FOUND', 'the News document type');
  }

  /** The id of the News Category node (the list whose children are the categories), found by its document type under Home. */
  async categoryListId(categoryListType: string): Promise<string> {
    return this.childOfHome(categoryListType, 'CMS_CATEGORIES_NOT_FOUND', 'the News Category document type');
  }

  /** The Home node: the root of the content tree. */
  async homeId(): Promise<string> {
    homeIdKept ??= this.readHomeId().catch((error: unknown) => {
      homeIdKept = undefined;
      throw error;
    });
    return homeIdKept;
  }

  private async readHomeId(): Promise<string> {
    const root = await this.valueOf(await this.get<TreePage>(`${API}/tree/document/root?skip=0&take=100`), 'CMS_TREE_UNREADABLE', 'the content tree root');
    const home = root.items[0];
    if (!home) {
      throw new Error('CMS_HOME_NOT_FOUND: the content tree has no root node');
    }
    return home.id;
  }

  /** The node of a document type directly under Home (Contact US, About Club, ...). */
  async nodeUnderHome(documentType: string, what: string): Promise<string> {
    return this.childOfHome(documentType, 'CMS_NODE_NOT_FOUND', what);
  }

  /** The child of a node that has a document type (About Club's History page, ...). */
  async childOfType(parentId: string, documentType: string, what: string): Promise<string> {
    const children = await this.valueOf(await this.get<TreePage>(`${API}/tree/document/children?parentId=${parentId}&skip=0&take=200`), 'CMS_TREE_UNREADABLE', `the children of ${parentId}`);
    const found = children.items.find((item) => item.documentType?.id === documentType && !(item.variants ?? []).some((variant) => isTestDataName(variant.name)));
    if (!found) {
      throw new Error(`CMS_NODE_NOT_FOUND: no ${what} (${documentType}) under ${parentId} in the content tree.`);
    }
    return found.id;
  }

  /** The node of a document type directly under Home (News, News Category, ...). */
  private async childOfHome(documentType: string, errorCode: string, what: string): Promise<string> {
    const kept = nodesUnderHome.get(documentType);
    if (kept) {
      return kept;
    }
    const id = await this.findUnderHome(documentType, errorCode, what);
    nodesUnderHome.set(documentType, id);
    return id;
  }

  private async findUnderHome(documentType: string, errorCode: string, what: string): Promise<string> {
    const root = await this.valueOf(await this.get<TreePage>(`${API}/tree/document/root?skip=0&take=100`), 'CMS_TREE_UNREADABLE', 'the content tree root');
    for (const home of root.items) {
      const children = await this.valueOf(
        await this.get<TreePage>(`${API}/tree/document/children?parentId=${home.id}&skip=0&take=200`),
        'CMS_TREE_UNREADABLE',
        'the children of Home',
      );
      // The real node, never a copy a case made of it (Contact US copies live under Home too)
      const found = children.items.find((item) => item.documentType?.id === documentType && !(item.variants ?? []).some((variant) => isTestDataName(variant.name)));
      if (found) {
        return found.id;
      }
    }
    throw new Error(`${errorCode}: no node of ${what} (${documentType}) under Home in the content tree.`);
  }

  /** One article as the server holds it: its name, state (Draft / Published / ...) and whether it is in the Recycle Bin. */
  async document(id: string): Promise<CmsDocument> {
    return this.valueOf(await this.get<CmsDocument>(`${API}/document/${id}`), 'CMS_DOCUMENT_UNREADABLE', `the article ${id}`);
  }

  /** The children of a node of the content tree (Home's when `parentId` is undefined: the tree's root), in the tree's order. */
  async treeChildren(parentId?: string): Promise<ContentNode[]> {
    const url = parentId ? `${API}/tree/document/children?parentId=${parentId}&skip=0&take=500` : `${API}/tree/document/root?skip=0&take=100`;
    const page = await this.valueOf(await this.get<TreePage>(url), 'CMS_TREE_UNREADABLE', `the children of ${parentId ?? 'the root'}`);
    return page.items.map((item) => ({
      id: item.id,
      hasChildren: item.hasChildren,
      documentType: item.documentType?.id ?? '',
      names: Object.fromEntries((item.variants ?? []).map((variant) => [variant.culture ?? '', variant.name])),
    }));
  }

  async documentType(id: string): Promise<DocumentTypeInfo> {
    type Raw = Omit<DocumentTypeInfo, 'properties' | 'containers' | 'compositions'> & {
      compositions?: { documentType: { id: string } }[];
      properties: { alias: string; name: string; description: string | null; validation?: { mandatory?: boolean }; dataType: { id: string }; container?: { id: string } | null; sortOrder: number }[];
      containers: { id: string; name: string | null; type: string; parent?: { id: string } | null; sortOrder: number }[];
    };
    const raw = await this.valueOf(await this.get<Raw>(`${API}/document-type/${id}`), 'CMS_TYPE_UNREADABLE', `the document type ${id}`);
    return {
      id: raw.id,
      name: raw.name,
      description: raw.description,
      properties: raw.properties.map((property) => ({
        alias: property.alias,
        name: property.name.trim(),
        description: property.description?.trim() || null,
        mandatory: property.validation?.mandatory === true,
        dataType: property.dataType.id,
        container: property.container?.id ?? null,
        sortOrder: property.sortOrder,
      })),
      containers: raw.containers.map((container) => ({ id: container.id, name: container.name, type: container.type, parent: container.parent?.id ?? null, sortOrder: container.sortOrder })),
      compositions: (raw.compositions ?? []).map((composition) => composition.documentType.id),
    };
  }

  /** The kind of editor a data type is (`Umbraco.TextBox`, `Umbraco.MediaPicker3`, ...). */
  async editorOf(dataTypeId: string): Promise<string> {
    const dataType = await this.valueOf(await this.get<{ editorAlias: string }>(`${API}/data-type/${dataTypeId}`), 'CMS_DATA_TYPE_UNREADABLE', `the data type ${dataTypeId}`);
    return dataType.editorAlias;
  }

  /** One setting of a data type (`validationLimit` of a picture field, `maxChars` of a text box ...); undefined when not set. */
  async dataTypeSetting(dataTypeId: string, alias: string): Promise<unknown> {
    type Raw = { values?: { alias: string; value: unknown }[] };
    const dataType = await this.valueOf(await this.get<Raw>(`${API}/data-type/${dataTypeId}`), 'CMS_DATA_TYPE_UNREADABLE', `the data type ${dataTypeId}`);
    return dataType.values?.find((value) => value.alias === alias)?.value;
  }

  /** The document types that may be created under a document of this type. */
  async allowedChildTypes(documentTypeId: string): Promise<{ id: string; name: string; description: string | null }[]> {
    type Allowed = { items: { id: string; name: string; description: string | null }[] };
    return (await this.valueOf(await this.get<Allowed>(`${API}/document-type/${documentTypeId}/allowed-children?skip=0&take=100`), 'CMS_TYPE_UNREADABLE', `the types allowed under ${documentTypeId}`)).items;
  }

  /** The value of one field in one language exactly as stored (`undefined` when the field is empty). */
  async valueIn(id: string, alias: string, culture: string | null): Promise<unknown> {
    const values = (await this.document(id)).values ?? [];
    return (values.find((value) => value.alias === alias && value.culture === culture) ?? values.find((value) => value.alias === alias && value.culture === null))?.value;
  }

  /** The address of a published page on the portal in one language (`/en/contact-us/`). */
  async urlOf(id: string, culture: string): Promise<string> {
    type Urls = { id: string; urlInfos: { culture: string | null; url: string }[] }[];
    const urls = await this.valueOf(await this.get<Urls>(`${API}/document/urls?id=${id}`), 'CMS_URLS_UNREADABLE', `the address of ${id}`);
    const found = urls[0]?.urlInfos.find((info) => info.culture === culture && info.url.startsWith('/'));
    if (!found) {
      throw new Error(`CMS_NOT_PUBLISHED: ${id} has no ${culture} address on the portal (is it published?)`);
    }
    return found.url;
  }

  /** The address of a picture of the media library on the portal (`/media/fdke2yf1/picture.jpeg`), by its key. */
  async mediaPath(mediaKey: string): Promise<string> {
    type Urls = { id: string; urlInfos: { culture: string | null; url: string }[] }[];
    const urls = await this.valueOf(await this.get<Urls>(`${API}/media/urls?id=${mediaKey}`), 'CMS_URLS_UNREADABLE', `the address of the picture ${mediaKey}`);
    const url = urls[0]?.urlInfos[0]?.url;
    if (!url) {
      throw new Error(`CMS_MEDIA_NOT_FOUND: the picture ${mediaKey} has no address`);
    }
    return new URL(url, 'https://portal.invalid').pathname;
  }

  /** The value of one field of an article in a language (`title`, `summaryOverride`, ...). */
  async propertyValue(id: string, alias: string, culture: string | null): Promise<unknown> {
    const document = await this.document(id);
    return document.values?.find((value) => value.alias === alias && (value.culture === culture || value.culture === null))?.value;
  }

  /** The categories an article can be filed under, from the News Category node: their names in every language, and whether published. */
  async categoryNodes(categoryListType: string): Promise<CategoryNode[]> {
    const listId = await this.categoryListId(categoryListType);
    const categories = await this.valueOf(
      await this.get<TreePage>(`${API}/tree/document/children?parentId=${listId}&skip=0&take=200`),
      'CMS_TREE_UNREADABLE',
      'the news categories',
    );
    return categories.items.map((item) => ({
      names: (item.variants ?? []).map((variant) => variant.name),
      published: (item.variants ?? []).some((variant) => variant.state === 'Published' || variant.state === 'PublishedPendingChanges'),
    }));
  }

  /** The ids of the categories (children of the News Category node), in their display order. */
  async categoryIds(listId: string): Promise<string[]> {
    const page = await this.valueOf(await this.get<TreePage>(`${API}/tree/document/children?parentId=${listId}&skip=0&take=500`), 'CMS_TREE_UNREADABLE', 'the news categories');
    return page.items.map((item) => item.id);
  }

  /** Whether a category is switched to Is Active (its saved value). */
  async isCategoryActive(id: string): Promise<boolean> {
    const value = (await this.document(id)).values?.find((entry) => entry.alias === 'isActive')?.value;
    return value === true || value === 'True' || value === 'true' || value === 1 || value === '1';
  }

  /** The ids of the categories an article is filed under (its Category field as saved). */
  async categoriesOfArticle(id: string): Promise<string[]> {
    const value = (await this.document(id)).values?.find((entry) => entry.alias === 'category')?.value;
    return Array.isArray(value) ? value.map((entry) => (entry as { unique?: string }).unique ?? '').filter(Boolean) : [];
  }

  /** Whether a document was moved to the Recycle Bin (or deleted). */
  async isTrashedOrGone(id: string): Promise<boolean> {
    const read = await this.get<CmsDocument>(`${API}/document/${id}`);
    return read.response.status() === 404 || read.body?.isTrashed === true;
  }

  //=====================Setup=====================
  /**
   * Creates and publishes a news category for a case to work with (CMS-07): its node name and Name in Arabic and English
   * (the English portal lists only categories that have an English name), Is Active as asked. Returns its id. It is
   * removed with the case's other data.
   */
  async createCategory(listId: string, categoryType: string, category: { name: string; active: boolean }): Promise<string> {
    const id = crypto.randomUUID();
    const created = await this.post(`${API}/document`, {
      id,
      parent: { id: listId },
      documentType: { id: categoryType },
      template: null,
      values: [
        { alias: 'title', culture: 'ar-EG', segment: null, value: category.name },
        { alias: 'title', culture: 'en-US', segment: null, value: category.name },
        { alias: 'isActive', culture: null, segment: null, value: category.active },
      ],
      variants: [
        { culture: 'ar-EG', segment: null, name: category.name },
        { culture: 'en-US', segment: null, name: category.name },
      ],
    });
    if (created.response.status() !== 201) {
      throw new Error(`CMS_CREATE_FAILED: the category ${category.name} - ${await failureOf(created.response)}`);
    }
    this.created.push({ kind: 'document', id });
    await this.publish(id, ['ar-EG', 'en-US'], `the category ${category.name}`);
    return id;
  }

  /**
   * Creates and publishes a news article filed under one category (CMS-07 cases about categories with articles). Its main
   * image refers to a picture an existing article already uses - only referred to, never changed. Returns its id.
   */
  async createArticleInCategory(newsListId: string, articleType: string, name: string, categoryId: string): Promise<string> {
    return this.createArticle(newsListId, articleType, { name, categoryId });
  }

  /**
   * Creates and publishes a news article of the case's own (named as test data): in Arabic, or in the languages given, each
   * with the same title, body and summary. A publish date can be set (`YYYY-MM-DD HH:mm:ss`). Its main image refers to a
   * picture an existing article already uses - only referred to, never changed. Returns its id; it is removed with the
   * case's other data.
   */
  async createArticle(
    newsListId: string,
    articleType: string,
    article: { name: string; categoryId: string; cultures?: readonly string[]; body?: string; summary?: string; publishDate?: string },
  ): Promise<string> {
    const picture = await this.anArticlePicture(newsListId);
    const cultures = article.cultures ?? ['ar-EG'];
    const id = crypto.randomUUID();
    const created = await this.post(`${API}/document`, {
      id,
      parent: { id: newsListId },
      documentType: { id: articleType },
      template: null,
      values: [
        ...cultures.flatMap((culture) => [
          { alias: 'title', culture, segment: null, value: article.name },
          { alias: 'body', culture, segment: null, value: { markup: `<p>${article.body ?? 'Automated test article.'}</p>`, blocks: null } },
          { alias: 'thumbnail', culture, segment: null, value: [{ key: crypto.randomUUID(), mediaKey: picture, mediaTypeAlias: 'Image', crops: [], focalPoint: null }] },
          ...(article.summary ? [{ alias: 'summaryOverride', culture, segment: null, value: article.summary }] : []),
        ]),
        { alias: 'category', culture: null, segment: null, value: [{ type: 'document', unique: article.categoryId }] },
        { alias: 'sharingLocation', culture: null, segment: null, value: ['Portal'] },
        ...(article.publishDate ? [{ alias: 'publishDate', culture: null, segment: null, value: article.publishDate }] : []),
      ],
      variants: cultures.map((culture) => ({ culture, segment: null, name: article.name })),
    });
    if (created.response.status() !== 201) {
      throw new Error(`CMS_CREATE_FAILED: the article ${article.name} - ${await failureOf(created.response)}`);
    }
    this.created.push({ kind: 'document', id });
    await this.publish(id, cultures, `the article ${article.name}`);
    return id;
  }

  /** Switches a category of the case's own on or off (Is Active) and publishes it - a step before the check. */
  async setCategoryActive(id: string, active: boolean): Promise<void> {
    const document = await this.document(id);
    if (!document.variants.every((variant) => isTestDataName(variant.name))) {
      throw new Error(`CMS_NOT_TEST_DATA: the category ${id} is not one the tests made - it is left alone`);
    }
    const saved = await this.put(`${API}/document/${id}`, {
      template: null,
      values: (document.values ?? []).map((entry) => ({ alias: entry.alias, culture: entry.culture, segment: null, value: entry.alias === 'isActive' ? active : entry.value })),
      variants: document.variants.map((variant) => ({ culture: variant.culture, segment: null, name: variant.name })),
    });
    if (!saved.response.ok()) {
      throw new Error(`CMS_SAVE_FAILED: the category ${id} - ${await failureOf(saved.response)}`);
    }
    await this.publish(id, document.variants.map((variant) => variant.culture ?? 'ar-EG'), `the category ${id}`);
  }

  /**
   * Makes a copy of a page of the case's own to work on (CMS-02, PTL-90): the same document type, template and field values
   * as `sourceId`, `changes` applied, under `parentId` (null: at the root of the tree), named `name` in every language. It is a draft - nothing a visitor
   * sees changes - until `publishOwn` is called. The page copied from is only read. Returns the copy's id; it is removed
   * with the case's other data.
   */
  async createCopy(sourceId: string, parentId: string | null, name: string, changes: readonly CmsValue[] = []): Promise<string> {
    const source = await this.document(sourceId);
    const id = crypto.randomUUID();
    const created = await this.post(`${API}/document`, {
      id,
      parent: parentId ? { id: parentId } : null,
      documentType: { id: source.documentType?.id },
      template: source.template ? { id: source.template.id } : null,
      values: withChanges(source.values ?? [], changes).map((entry) => ({ alias: entry.alias, culture: entry.culture, segment: null, value: withNewBlockKeys(entry.value) })),
      variants: source.variants.map((variant) => ({ culture: variant.culture, segment: null, name })),
    });
    if (created.response.status() !== 201) {
      throw new Error(`CMS_CREATE_FAILED: a copy of ${sourceId} - ${await failureOf(created.response)}`);
    }
    this.created.push({ kind: 'document', id });
    return id;
  }

  /** Changes fields of a page of the case's own (made by `createCopy`) and saves it; a page the tests did not make is refused. */
  async updateOwn(id: string, changes: readonly CmsValue[]): Promise<void> {
    const document = await this.ownDocument(id);
    const saved = await this.put(`${API}/document/${id}`, {
      template: document.template ? { id: document.template.id } : null,
      values: withChanges(document.values ?? [], changes).map((entry) => ({ alias: entry.alias, culture: entry.culture, segment: null, value: entry.value })),
      variants: document.variants.map((variant) => ({ culture: variant.culture, segment: null, name: variant.name })),
    });
    if (!saved.response.ok()) {
      throw new Error(`CMS_SAVE_FAILED: ${id} - ${await failureOf(saved.response)}`);
    }
  }

  /** Publishes a page of the case's own in every language it has. */
  async publishOwn(id: string): Promise<void> {
    const document = await this.ownDocument(id);
    await this.publish(id, document.variants.map((variant) => variant.culture ?? 'ar-EG'), `the page ${id}`);
  }

  /** A document the tests made (every name is a test name); any other is refused, so real content is never changed. */
  private async ownDocument(id: string): Promise<CmsDocument> {
    const document = await this.document(id);
    if (document.variants.length === 0 || !document.variants.every((variant) => isTestDataName(variant.name))) {
      throw new Error(`CMS_NOT_TEST_DATA: ${id} is not a page the tests made - it is left alone`);
    }
    return document;
  }

  /** The media key of a picture an existing article shows as its main image. */
  private async anArticlePicture(newsListId: string): Promise<string> {
    const children = await this.valueOf(await this.get<TreePage>(`${API}/tree/document/children?parentId=${newsListId}&skip=0&take=20`), 'CMS_TREE_UNREADABLE', 'the articles');
    for (const item of children.items) {
      const value = (await this.document(item.id)).values?.find((entry) => entry.alias === 'thumbnail' || entry.alias === 'headerImage')?.value;
      const key = Array.isArray(value) ? (value[0] as { mediaKey?: string } | undefined)?.mediaKey : undefined;
      if (key) {
        return key;
      }
    }
    throw new Error('CMS_NO_PICTURE: no existing article has a main image to refer to');
  }

  private async publish(id: string, cultures: readonly string[], what: string): Promise<void> {
    const published = await this.put(`${API}/document/${id}/publish`, { publishSchedules: cultures.map((culture) => ({ culture })) });
    if (!published.response.ok()) {
      throw new Error(`CMS_PUBLISH_FAILED: ${what} - ${await failureOf(published.response)}`);
    }
  }

  /** Whether the article still exists (a deleted one answers 404). */
  async documentExists(id: string): Promise<boolean> {
    return (await this.get<CmsDocument>(`${API}/document/${id}`)).response.ok();
  }

  /** Remembers something this test made through the API, so the clean-up removes it (and only it). */
  protected track(item: CreatedItem): void {
    this.created.push(item);
  }

  /** The articles created by this test so far, as the server reported them. */
  createdDocuments(): string[] {
    return this.created.filter((item) => item.kind === 'document').map((item) => item.id);
  }

  //=====================Cleanup=====================
  /**
   * Removes what this test created and nothing else. Returns what it could not remove, with the reason, so the report
   * can say so instead of leaving data behind silently.
   */
  async cleanUp(): Promise<string[]> {
    const problems: string[] = [];
    for (const item of [...this.created].reverse()) {
      try {
        const problem = item.kind === 'document' ? await this.removeDocument(item.id) : await this.removeMedia(item.id);
        if (problem) {
          problems.push(`${item.kind} ${item.id}: ${problem}`);
        }
      } catch (error) {
        problems.push(`${item.kind} ${item.id}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      }
    }
    this.created.length = 0;
    return problems;
  }

  protected async removeDocument(id: string): Promise<string | undefined> {
    const read = await this.get<CmsDocument>(`${API}/document/${id}`);
    if (read.response.status() === 404) {
      return undefined; // a case that deleted it already
    }
    const document = await this.valueOf(read, 'CMS_DOCUMENT_UNREADABLE', `the article ${id}`);
    if (document.variants.length === 0 || !document.variants.every((variant) => isTestDataName(variant.name))) {
      return `left alone: its name is not a test name (${document.variants.map((variant) => variant.name).join(' | ')})`;
    }
    if (!document.isTrashed) {
      const moved = await this.put(`${API}/document/${id}/move-to-recycle-bin`, undefined);
      if (!moved.response.ok()) {
        return `could not move to the Recycle Bin: ${await failureOf(moved.response)}`;
      }
    }
    const deleted = await this.delete(`${API}/recycle-bin/document/${id}`);
    return deleted.response.ok() ? undefined : `could not delete from the Recycle Bin: ${await failureOf(deleted.response)}`;
  }

  protected async removeMedia(id: string): Promise<string | undefined> {
    const read = await this.get<MediaItem>(`${API}/media/${id}`);
    if (read.response.status() === 404) {
      return undefined;
    }
    const media = await this.valueOf(read, 'CMS_MEDIA_UNREADABLE', `the media item ${id}`);
    if (media.variants.length === 0 || !media.variants.every((variant) => isTestDataName(variant.name))) {
      return `left alone: its name is not a test name (${media.variants.map((variant) => variant.name).join(' | ')})`;
    }
    if (!media.isTrashed) {
      const moved = await this.put(`${API}/media/${id}/move-to-recycle-bin`, undefined);
      if (!moved.response.ok()) {
        return `could not move to the Recycle Bin: ${await failureOf(moved.response)}`;
      }
    }
    const deleted = await this.delete(`${API}/recycle-bin/media/${id}`);
    return deleted.response.ok() ? undefined : `could not delete from the Recycle Bin: ${await failureOf(deleted.response)}`;
  }

  /**
   * Removes test data an earlier run left behind - when a run is ended by force its clean-up never runs. Only items whose every
   * name is test data AND whose name says a test made it longer ago than `olderThanMs` (so never something a test that is still
   * running has made) are removed: the children of the given lists (News, News Category), the media at the root of the
   * library, and both Recycle Bins.
   */
  async sweepLeftovers(parentIds: readonly string[], olderThanMs: number): Promise<string[]> {
    const before = Date.now() - olderThanMs;
    const isLeftover = (item: TreeItem): boolean => {
      const names = (item.variants ?? []).map((variant) => variant.name);
      return names.length > 0 && names.every((name) => isTestDataName(name) && (testDataCreatedAt(name) ?? Number.POSITIVE_INFINITY) < before);
    };
    const listed = async (url: string): Promise<TreeItem[]> => {
      const read = await this.get<TreePage>(url);
      return read.response.ok() ? (read.body?.items ?? []).filter(isLeftover) : [];
    };
    const removed: string[] = [];
    const documents: TreeItem[] = [];
    for (const parentId of parentIds) {
      documents.push(...(await listed(`${API}/tree/document/children?parentId=${parentId}&skip=0&take=1000`)));
    }
    documents.push(...(await listed(`${API}/recycle-bin/document/root?skip=0&take=1000`)));
    for (const item of documents) {
      if (!(await this.removeDocument(item.id))) {
        removed.push(`document ${item.variants?.[0]?.name ?? item.id}`);
      }
    }
    const media = [...(await listed(`${API}/tree/media/root?skip=0&take=1000`)), ...(await listed(`${API}/recycle-bin/media/root?skip=0&take=1000`))];
    for (const item of media) {
      if (!(await this.removeMedia(item.id))) {
        removed.push(`media ${item.variants?.[0]?.name ?? item.id}`);
      }
    }
    return removed;
  }

  //=====================Tracking=====================
  /** Notes the id of an article or a media item the server just created for this browser. */
  private rememberCreation(response: Response): void {
    const request = response.request();
    if (request.method() !== 'POST' || response.status() !== 201) {
      return;
    }
    const match = /\/management\/api\/v1\/(document|media)$/.exec(new URL(response.url()).pathname);
    if (!match) {
      return;
    }
    const headers = response.headers();
    const id = headers['umb-generated-resource'] ?? headers['location']?.split('/').filter(Boolean).pop();
    if (!id) {
      logger.warn(`A ${match[1]} was created but the server did not report its id - it cannot be cleaned up by id`);
      return;
    }
    this.created.push({ kind: match[1] === 'media' ? 'media' : 'document', id });
  }
}

/** The values with the changes applied: a change replaces the value of its field and language; `value: undefined` empties it. */
export const withChanges = (values: readonly CmsValue[], changes: readonly CmsValue[]): CmsValue[] => {
  const same = (a: CmsValue, b: CmsValue): boolean => a.alias === b.alias && a.culture === b.culture;
  const kept = values.filter((value) => !changes.some((change) => same(change, value)));
  return [...kept, ...changes.filter((change) => change.value !== undefined)];
};

/**
 * A block list value (Phone Numbers) with new keys for its blocks: a copy must not share its blocks' keys with the page it
 * was copied from. Any other value is returned as it is.
 */
export const withNewBlockKeys = (value: unknown): unknown => {
  const blocks = (value as { contentData?: { key?: string }[] } | null)?.contentData;
  if (!Array.isArray(blocks)) {
    return value;
  }
  let text = JSON.stringify(value);
  for (const block of blocks) {
    if (block.key) {
      text = text.split(block.key).join(crypto.randomUUID());
    }
  }
  return JSON.parse(text) as unknown;
};
