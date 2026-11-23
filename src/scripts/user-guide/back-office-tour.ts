import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CmsApi, ContentNode, DocumentTypeInfo } from '../../api/cms/cms.api.ts';
import { isTestDataName } from '../../domain/test-data-naming.ts';
import { upgradeHttpToHttps } from '../../utils/actions/ui/browserActions.ts';
import { fieldKindOf, guideText, type FieldView, type GuideText } from './guide-text.ts';
import { b, line, type Block, type Chapter, type Figure, type GuideLanguage, type Procedure } from './guide-model.ts';

/** Where a numbered badge goes on the screen (viewport pixels). */
type Badge = { x: number; y: number; number: number };
type Box = { x: number; y: number; width: number; height: number };

const VIEW = { width: 1280, height: 900 } as const;
/** The editor's area: right of the content tree, below the top bar. */
const WORKSPACE_LEFT = 300;
const HEADER_HEIGHT = 60;
/** The tallest part of a form one screenshot shows: it then fits a page of the guide at a readable size. */
const MAX_PART_HEIGHT = 1150;
const BADGE_COLOUR = '#E8590C';

/**
 * Walks the back office the way an editor does and turns what it sees into the chapters of the user guide: one chapter per
 * node of the content tree, in the tree's order, with screenshots carrying numbered badges that match the steps.
 *
 * It only looks. It opens forms and the Create panel and leaves them without saving: nothing is created, changed, published
 * or deleted. Field names, required marks, button labels and the states of switches are read from the screen and the back
 * office's own definitions - no step describes anything that is not there.
 */
export class BackOfficeTour {
  private readonly text: GuideText;
  private figures = 0;
  private readonly figureFolder: string;

  constructor(
    private readonly page: Page,
    private readonly api: CmsApi,
    private readonly language: GuideLanguage,
    private readonly origin: string,
    outputFolder: string,
    private readonly log: (message: string) => void,
  ) {
    this.text = guideText(language);
    this.figureFolder = path.join(outputFolder, 'figures');
    mkdirSync(this.figureFolder, { recursive: true });
  }

  //=====================Chapters=====================
  /** Signing in: the sign-in page as a visitor sees it (in a tab of its own, never signed in; nothing is typed). */
  async signInChapter(): Promise<Chapter> {
    const t = this.text.signIn;
    const context = await this.page.context().browser()?.newContext({ storageState: { cookies: [], origins: [] }, ignoreHTTPSErrors: true, viewport: VIEW, locale: 'en-US' });
    if (!context) {
      throw new Error('GUIDE_NO_BROWSER: no browser to open the sign-in page in');
    }
    try {
      const tab = await context.newPage();
      await upgradeHttpToHttps(tab, this.origin);
      await tab.goto(`${this.origin}/umbraco/`, { waitUntil: 'domcontentloaded' });
      const email = tab.locator('#username-input');
      const password = tab.locator('#password-input');
      const submit = tab.locator('#umb-login-button');
      await email.waitFor({ timeout: 90_000 });
      const [emailLabel, passwordLabel, submitLabel] = [await labelOf(tab, 'username-input', 'Email'), await labelOf(tab, 'password-input', 'Password'), await textOf(submit, 'Login')];
      const figure = await this.shoot(tab, 'sign-in', { x: 0, y: 0, ...VIEW }, t.caption, [
        await badgeLeftOf(email, 2),
        await badgeLeftOf(password, 3),
        await badgeLeftOf(submit, 4),
      ]);
      return {
        title: t.chapter,
        intro: [t.intro],
        procedures: [{ title: t.procedure, blocks: [step(t.open(`${this.origin}/umbraco/`)), figure, step(t.email(emailLabel)), step(t.password(passwordLabel)), step(t.submit(submitLabel)), note(t.note)] }],
      };
    } finally {
      await context.close();
    }
  }

  /** The Content section: the top bar, the language, the content tree and the Recycle Bin. */
  async contentChapter(): Promise<Chapter> {
    const t = this.text.content;
    await this.openContentTree();
    const section = this.page.locator('uui-tab[label="Content"]').first();
    const languageButton = this.page.locator('umb-section-sidebar').getByRole('button').first();
    const languageLabel = await textOf(languageButton, 'Arabic (Egypt)');
    const home = this.treeItem('Home');
    const bin = this.treeItem('Recycle Bin');
    const figure = await this.shoot(this.page, 'content-section', { x: 0, y: 0, ...VIEW }, t.caption, [
      await badgeOn(section, 1, 'below'),
      await badgeOn(languageButton, 2, 'right'),
      await badgeOnRow(home, 3),
      await badgeOnRow(bin, 4),
    ]);
    return {
      title: t.chapter,
      intro: [t.intro],
      procedures: [{ title: t.procedure, blocks: [figure, step(t.section('Content')), step(t.language(languageLabel)), step(t.tree), step(t.recycleBin(await textOf(bin, 'Recycle Bin')))] }],
    };
  }

  /**
   * One chapter per node under Home, in the tree's order (the cases' own test copies are left out); `only` limits them to
   * some (English names). Also returns a page with fields, for the save buttons chapter.
   */
  async sectionChapters(only: readonly string[] = []): Promise<{ chapters: Chapter[]; sample?: ContentNode }> {
    const [home] = await this.api.treeChildren();
    const sections = (await this.api.treeChildren(home.id))
      .filter(isRealContent)
      .filter((node) => only.length === 0 || only.includes((node.names['en-US'] ?? '').trim().toLowerCase()));
    const chapters: Chapter[] = [];
    // Home itself is a page with fields of its own (the home page)
    const homeType = await this.api.documentType(home.documentType);
    if ((only.length === 0 || only.includes('home')) && (await this.allProperties(homeType)).length > 0) {
      this.log(`chapter: ${shownName(home)}`);
      chapters.push(
        await this.editProcedure(home, [], homeType)
          .then((procedure) => ({ title: this.titleOf(home), intro: [this.text.sectionIntro(shownName(home), this.typeName(homeType))], procedures: [procedure] }))
          .catch((error: unknown) => this.unavailable(home, error)),
      );
    }
    let sample: ContentNode | undefined;
    for (const node of sections) {
      this.log(`chapter: ${shownName(node)}`);
      chapters.push(await this.sectionChapter(node).catch((error: unknown) => this.unavailable(node, error)));
      if (!sample && !node.hasChildren && (await this.api.documentType(node.documentType)).properties.length > 0) {
        sample = node;
      }
    }
    return { chapters, sample };
  }

  /** How many screenshots the guide has. */
  get figureCount(): number {
    return this.figures;
  }

  /** The club's logo from the public portal's home page (saved as a file), or undefined when there is none. */
  async portalLogo(): Promise<string | undefined> {
    const portal = process.env.PORTAL_BASE_URL;
    if (!portal) {
      return undefined;
    }
    const home = await this.page.request.get(new URL('/en/', portal).toString()).catch(() => undefined);
    const source = /<img[^>]+src="([^"]+)"[^>]*class="logo"|<img[^>]+class="logo"[^>]*src="([^"]+)"/i.exec((await home?.text().catch(() => '')) ?? '');
    const address = source?.[1] ?? source?.[2];
    if (!address || !/\.png(\?|$)/i.test(address)) {
      return undefined;
    }
    const picture = await this.page.request.get(new URL(address, portal).toString()).catch(() => undefined);
    if (!picture?.ok()) {
      return undefined;
    }
    const file = path.join(this.figureFolder, 'logo.png');
    writeFileSync(file, await picture.body());
    return file;
  }

  /** Saving and publishing: the save buttons every form ends with, and the more-options menu (opened and closed). */
  async publishingChapter(sampleNode: ContentNode): Promise<Chapter> {
    const t = this.text.publishing;
    await this.openEditorOf(sampleNode, []);
    const buttons = this.page.locator('umb-workspace-footer uui-button[label]');
    const labels = await buttons.evaluateAll((elements) => elements.map((element) => (element.getAttribute('label') ?? '').trim()));
    const [preview, save, publish] = [labels.find((label) => /preview/i.test(label)), labels.find((label) => /^save(…|\.\.\.)?$/i.test(label)), labels.find((label) => /publish/i.test(label) && !/preview/i.test(label))];
    const footer = await this.footerBox();
    const badges: (Badge | undefined)[] = [];
    for (const [index, label] of [preview, save, publish].entries()) {
      if (label) {
        badges.push(await badgeOn(this.page.locator(`umb-workspace-footer uui-button[label="${label}"]`).first(), index + 1, 'top-left'));
      }
    }
    const blocks: Block[] = [await this.shoot(this.page, 'save-buttons', footer, this.text.captions.footer, badges), ...t.buttons({ preview, save, publish }).map(note)];
    const arrow = this.page.locator('umb-workspace-action-menu').getByRole('button').first();
    if (await arrow.isVisible().catch(() => false)) {
      await arrow.click();
      // The menu's own entries (the content tree's items are menu items too: only those over the save buttons count)
      const entries = this.page.locator('umb-workspace-footer uui-menu-item:visible, umb-workspace-action-menu uui-menu-item:visible');
      await entries.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const names = await entries.evaluateAll((items) => items.map((item) => item.getAttribute('label') ?? '').filter(Boolean));
      const menu = await unionBox(this.page.locator('uui-popover-container:visible, umb-popover-layout:visible').first(), footer);
      if (names.length > 0) {
        blocks.push(await this.shoot(this.page, 'more-options', menu, this.text.captions.menu, []), note(t.more(names)));
      }
      await this.page.keyboard.press('Escape');
    }
    return { title: t.chapter, intro: [t.intro], procedures: [{ title: t.procedure, blocks }] };
  }

  //=====================One section=====================
  private async sectionChapter(node: ContentNode): Promise<Chapter> {
    const type = await this.api.documentType(node.documentType);
    const children = node.hasChildren ? (await this.api.treeChildren(node.id)).filter(isRealContent) : [];
    const allowed = await this.api.allowedChildTypes(node.documentType);
    // A list holds many items of one kind (news, categories); otherwise the nodes under it are pages of their own (About Club)
    const isList = allowed.length > 0 && (allowed.length === 1 || children.length > allowed.length);
    const procedures: Procedure[] = [];
    if ((await this.allProperties(type)).length > 0) {
      procedures.push(await this.editProcedure(node, [], type));
    }
    if (isList) {
      // A list: open it, add an item, edit an item, the other actions on an item, and the order of the items
      procedures.push(await this.listProcedure(node).catch((error: unknown) => this.unavailableProcedure(node, error)));
      for (const childType of allowed) {
        procedures.push(await this.createProcedure(node, childType).catch((error: unknown) => this.unavailableProcedure(node, error)));
      }
      const example = children[0];
      if (example) {
        const exampleType = await this.api.documentType(example.documentType);
        procedures.push(await this.editProcedure(example, [node], exampleType, this.text.list.editItem(this.typeName(exampleType))).catch((error: unknown) => this.unavailableProcedure(example, error)));
        procedures.push(await this.actionsProcedure(example, [node]).catch((error: unknown) => this.unavailableProcedure(example, error)));
      }
      if (children.length > 1) {
        procedures.push(await this.sortProcedure(node).catch((error: unknown) => this.unavailableProcedure(node, error)));
      }
    } else {
      for (const child of children) {
        this.log(`  page: ${shownName(child)}`);
        procedures.push(await this.editProcedure(child, [node], await this.api.documentType(child.documentType)).catch((error: unknown) => this.unavailableProcedure(child, error)));
      }
    }
    return { title: this.titleOf(node), intro: [this.text.sectionIntro(shownName(node), this.typeName(type))], procedures };
  }

  /** Editing a page: click it in the tree, change the fields (tab by tab), Save and publish. */
  private async editProcedure(node: ContentNode, ancestors: ContentNode[], type: DocumentTypeInfo, title?: string): Promise<Procedure> {
    const blocks: Block[] = [];
    let number = 1;
    await this.openContentTree(ancestors);
    const item = this.treeItem(treeLabel(node));
    blocks.push(await this.shoot(this.page, `tree-${slug(node)}`, await this.treeBox(), this.text.captions.tree(shownName(node)), [await badgeOnRow(item, number)]), step(this.text.clickTree(shownName(node))));
    number += 1;
    await clickRow(item);
    number = await this.captureForm(type, this.titleOf(node), blocks, number, false);
    return { title: title ?? this.text.edit(this.titleOf(node)), blocks };
  }

  /**
   * Opening a list. A list with a list view (News, News Category) shows its items in a table when it is clicked; any other
   * list shows them in the tree, under its arrow.
   */
  private async listProcedure(node: ContentNode): Promise<Procedure> {
    await this.openContentTree();
    const item = this.treeItem(treeLabel(node));
    await clickRow(item);
    const table = this.page.locator('umb-workspace-editor').locator('uui-table, umb-table, uui-card-content-node').first();
    const hasListView = await table.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    if (!hasListView) {
      await this.openContentTree([node]);
      return {
        title: this.text.list.procedure,
        blocks: [await this.shoot(this.page, `tree-${slug(node)}`, await this.treeBox(), this.text.captions.tree(shownName(node)), [await badgeOnRow(this.treeItem(treeLabel(node)), 1)]), step(this.text.list.expand(shownName(node)))],
      };
    }
    await this.untilLayoutSettles();
    const blocks: Block[] = [
      await this.shoot(this.page, `list-${slug(node)}`, { x: 0, y: HEADER_HEIGHT, width: VIEW.width, height: VIEW.height - HEADER_HEIGHT }, this.text.list.caption(shownName(node)), [await badgeOnRow(item, 1)]),
      step(this.text.clickTree(shownName(node))),
      step(this.text.list.opens),
    ];
    return { title: this.text.list.procedure, blocks };
  }

  /** The other actions on an item (Unpublish, Trash, Rollback ...): the ••• menu of the tree, opened and closed again. */
  private async actionsProcedure(node: ContentNode, ancestors: ContentNode[]): Promise<Procedure> {
    const { figure, entries } = await this.actionsMenu(node, ancestors, undefined, 'actions');
    const t = this.text.actions;
    const known = entries.filter((entry) => t.meaning[entry]);
    const others = entries.filter((entry) => !t.meaning[entry]);
    return {
      title: t.procedure,
      blocks: [figure, step(t.open(shownName(node))), step(t.choose), ...known.map((entry) => note(line(b(entry), `: ${t.meaning[entry]}.`))), ...(others.length ? [note(t.others(others))] : [])],
    };
  }

  /** The order of a list's items: ••• of the list, Sort children (the sort panel itself is not opened). */
  private async sortProcedure(node: ContentNode): Promise<Procedure> {
    const { figure, entries } = await this.actionsMenu(node, [], /^sort children/i, 'sort');
    const sortEntry = entries.find((entry) => /^sort children/i.test(entry));
    if (!sortEntry) {
      throw new Error('GUIDE_NO_SORT: the list offers no Sort children action');
    }
    return { title: this.text.sort.procedure, blocks: [figure, step(this.text.sort.open(shownName(node))), step(this.text.sort.choose(sortEntry))] };
  }

  /**
   * The ••• menu of a node of the tree: its entries and a picture of it (badge 1 on •••, badge 2 on `mark`). It is closed
   * again without choosing anything.
   */
  private async actionsMenu(node: ContentNode, ancestors: ContentNode[], mark: RegExp | undefined, name: string): Promise<{ figure: Figure; entries: string[] }> {
    await this.openContentTree(ancestors);
    const item = this.treeItem(treeLabel(node));
    await item.hover();
    const more = item.getByRole('button', { name: 'Open actions menu' }).first();
    await more.click();
    const entries = this.page.locator('uui-menu-item').filter({ hasNot: this.page.locator('uui-menu-item') });
    // The menu opens in a panel next to the tree: its entries are the menu items right of the tree
    const read = async (): Promise<{ label: string; box: Box }[]> =>
      (await entries.evaluateAll((items, left) =>
        items
          .map((entry) => ({ label: entry.getAttribute('label') ?? '', box: entry.getBoundingClientRect() }))
          .filter(({ label, box }) => label && box.width > 0 && box.x >= left - 4)
          .map(({ label, box }) => ({ label, box: { x: box.x, y: box.y, width: box.width, height: box.height } })), WORKSPACE_LEFT));
    // The panel slides in: it is measured once two looks in a row find its entries in the same places
    let shown = await read();
    let before = '';
    for (let round = 0; round < 20 && (shown.length === 0 || JSON.stringify(shown) !== before); round += 1) {
      before = JSON.stringify(shown);
      await pollInterval();
      shown = await read();
    }
    if (shown.length === 0) {
      throw new Error('GUIDE_NO_MENU: the ••• menu did not open');
    }
    const row = await item.boundingBox();
    const bottom = Math.max(...shown.map((entry) => entry.box.y + entry.box.height), row ? row.y + Math.min(row.height, 36) : 0);
    const right = Math.max(...shown.map((entry) => entry.box.x + entry.box.width));
    const target = mark ? shown.find((entry) => mark.test(entry.label)) : undefined;
    const badges: (Badge | undefined)[] = [await badgeOn(more, 1, 'top-left'), ...(target ? [{ x: target.box.x + target.box.width - 24, y: target.box.y + target.box.height / 2, number: 2 }] : [])];
    const figure = await this.shoot(this.page, `${name}-${slug(node)}`, { x: 0, y: HEADER_HEIGHT, width: Math.min(VIEW.width, Math.round(right + 16)), height: Math.round(bottom + 12 - HEADER_HEIGHT) }, this.text.actions.caption, badges);
    await this.page.keyboard.press('Escape');
    return { figure, entries: shown.map((entry) => entry.label) };
  }

  /** Adding an item to a list: + beside the list, the kind of item, the name, the fields, Save and publish - nothing is saved here. */
  private async createProcedure(parent: ContentNode, childType: { id: string; name: string; description: string | null }): Promise<Procedure> {
    const blocks: Block[] = [];
    await this.openContentTree();
    const item = this.treeItem(treeLabel(parent));
    await item.hover();
    const plus = item.getByRole('button', { name: /actions_create|create/i }).first();
    blocks.push(await this.shoot(this.page, `create-${slug(parent)}`, await this.treeBox(), this.text.captions.tree(shownName(parent)), [await badgeOn(plus, 1, 'left')]), step(this.text.pointAndCreate(shownName(parent))));
    await plus.click();
    const panel = this.page.locator('uui-modal-sidebar').last();
    // An entry of the panel: the kind's name, with its description under it
    // An entry of the panel (the kind's name with its description under it); the entry itself takes the click
    const option = panel.locator('uui-ref-node-document-type, uui-ref-node').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(childType.name.trim())}\\b`) }).first();
    await option.waitFor({ timeout: 30_000 });
    const panelBox = await unionBox(panel.locator('uui-box').first(), undefined, 12);
    const dialogTitle = (await panel.locator('h3, [slot="headline"], umb-body-layout').first().getAttribute('headline').catch(() => null)) ?? 'Create';
    blocks.push(await this.shoot(this.page, `create-panel-${slug(parent)}`, panelBox, this.text.captions.dialog, [await badgeOn(option, 2, 'left')]), step(this.text.chooseType(dialogTitle, childType.name)));
    await option.click();
    const type = await this.api.documentType(childType.id);
    await this.captureForm(type, this.typeName(type), blocks, 3, true);
    blocks.push(note(this.text.editTail(shownName(parent), await this.publishLabel())));
    // Leave the empty form: nothing was typed, so nothing is kept
    await this.page.goto(`${this.origin}/umbraco/section/content`, { waitUntil: 'domcontentloaded' });
    return { title: this.text.create(this.typeName(type)), blocks };
  }

  /**
   * The open form: its fields, tab by tab, each with a numbered badge and a step; the required fields; the save buttons.
   * Returns the next step number.
   */
  private async captureForm(type: DocumentTypeInfo, name: string, blocks: Block[], first: number, withNodeName: boolean): Promise<number> {
    let number = first;
    const nameBox = this.page.getByRole('textbox', { name: 'Enter a name...' });
    await nameBox.waitFor({ timeout: 90_000 });
    await this.untilFieldsSettle();
    const tabs = await this.formTabs();
    const required: string[] = [];
    for (const [index, tab] of (tabs.length > 0 ? tabs : [undefined]).entries()) {
      const badges: (Badge | undefined)[] = [];
      const steps: Block[] = [];
      if (tab) {
        if (index > 0) {
          await this.formTab(tab).click();
          await this.untilFieldsSettle();
        }
        badges.push(await badgeOn(this.formTab(tab), number, 'under'));
        steps.push(step(this.text.openTab(tab)));
        number += 1;
      }
      if (withNodeName && index === 0) {
        badges.push(await badgeOn(nameBox, number, 'inside'));
        steps.push(step(this.text.nodeName('Enter a name...')));
        number += 1;
      }
      await this.untilEditorsDrawn();
      await this.useTallView();
      const fields: { badge: Badge | undefined; step: Block; top: number; bottom: number }[] = [];
      for (const field of await this.visibleFields(type)) {
        const box = await field.element.boundingBox();
        fields.push({ badge: await badgeOn(field.element, number, 'label'), step: step(this.text.field(field.view)), top: box?.y ?? 0, bottom: (box?.y ?? 0) + (box?.height ?? 0) });
        if (field.view.required && !required.includes(field.view.label)) {
          required.push(field.view.label);
        }
        number += 1;
      }
      // A long form is shown in parts that each fit a page, cut between fields; each part is followed by its own steps
      const form = await this.formBox();
      const parts: { top: number; bottom: number; steps: Block[] }[] = [{ top: form.y, bottom: form.y, steps }];
      for (const field of fields) {
        const part = parts[parts.length - 1];
        if (field.bottom - part.top > MAX_PART_HEIGHT && part.steps.length > 0) {
          parts.push({ top: field.top - 16, bottom: field.bottom + 2, steps: [field.step] });
        } else {
          // Cut just under the field: the next field's badge (above its label) stays out of this part
          part.bottom = field.bottom + 2;
          part.steps.push(field.step);
        }
      }
      const shown = [...badges, ...fields.map((field) => field.badge)];
      for (const [partIndex, part] of parts.entries()) {
        const clip = { x: form.x, y: Math.round(part.top), width: form.width, height: Math.round(Math.max(part.bottom, part.top + 120) - part.top) };
        const caption = tab ? this.text.captions.tab(tab) : this.text.captions.form(name);
        blocks.push(await this.shoot(this.page, `form-${slugText(name)}-${index + 1}-${partIndex + 1}`, clip, parts.length > 1 ? `${caption} (${partIndex + 1}/${parts.length})` : caption, shown), ...part.steps);
      }
      await this.page.setViewportSize(VIEW);
    }
    const publishLabel = await this.publishLabel();
    const publish = this.page.locator(`umb-workspace-footer uui-button[label="${publishLabel}"]`).first();
    blocks.push(await this.shoot(this.page, `save-${slugText(name)}`, await this.footerBox(), this.text.captions.footer, [await badgeOn(publish, number, 'top-left')]), step(this.text.savePublish(publishLabel)));
    if (required.length > 0) {
      blocks.push(note(this.text.required(required)));
    }
    return number + 1;
  }

  /** A document type's fields with those of the types it is composed of (a shared Publish Date group, ...). */
  private async allProperties(type: DocumentTypeInfo): Promise<DocumentTypeInfo['properties']> {
    const properties = [...type.properties];
    for (const composition of type.compositions) {
      properties.push(...(await this.allProperties(await this.api.documentType(composition))));
    }
    return properties;
  }

  /** The fields on the screen now (the open tab), top to bottom, with what the steps say about each. */
  private async visibleFields(type: DocumentTypeInfo): Promise<{ element: Locator; view: FieldView }[]> {
    const properties = await this.allProperties(type);
    const fields: { element: Locator; view: FieldView; top: number }[] = [];
    for (const element of await this.page.locator('umb-property[data-mark^="property:"]').all()) {
      const box = await element.boundingBox();
      if (!box || box.width === 0 || box.x < WORKSPACE_LEFT || !(await element.isVisible())) {
        continue;
      }
      const alias = ((await element.getAttribute('data-mark')) ?? '').replace('property:', '');
      const property = properties.find((candidate) => candidate.alias === alias);
      if (!property) {
        continue;
      }
      const isSwitch = (await element.locator('uui-toggle').count()) > 0;
      const kind = isSwitch ? 'toggle' : fieldKindOf(await this.api.editorOf(property.dataType));
      const button = ['media', 'blocks', 'picker'].includes(kind) ? await firstButtonText(element) : undefined;
      const state = isSwitch ? await textOf(element.locator('uui-toggle').first(), '') : undefined;
      fields.push({
        element,
        top: box.y,
        view: { label: property.name, description: property.description, required: property.mandatory, kind, ...(button ? { button } : {}), ...(state ? { state } : {}) },
      });
    }
    return fields.sort((a, b) => a.top - b.top).map(({ element, view }) => ({ element, view }));
  }

  //=====================Screens=====================
  /** The Content section with the tree opened down to the given nodes (Home first). */
  private async openContentTree(ancestors: ContentNode[] = []): Promise<void> {
    await this.page.setViewportSize(VIEW);
    await this.page.goto(`${this.origin}/umbraco/section/content`, { waitUntil: 'domcontentloaded' });
    await this.treeItem('Home').waitFor({ timeout: 120_000 });
    for (const label of ['Home', ...ancestors.map(treeLabel)]) {
      const expand = this.treeItem(label).getByRole('button', { name: new RegExp(`^Expand child items for\\s*${escapeRegExp(label.trim())}`) }).first();
      if (await expand.isVisible().catch(() => false)) {
        const shown = await this.treeRows();
        await expand.click();
        // The opened level is drawn under the node: wait until the tree has more rows (at most 10 s)
        for (let round = 0; round < 20 && (await this.treeRows()) <= shown; round += 1) {
          await pollInterval();
        }
      }
    }
  }

  /** Opens a page's form from the tree (used for the save buttons chapter). */
  private async openEditorOf(node: ContentNode, ancestors: ContentNode[]): Promise<void> {
    await this.openContentTree(ancestors);
    await clickRow(this.treeItem(treeLabel(node)));
    await this.page.getByRole('textbox', { name: 'Enter a name...' }).waitFor({ timeout: 90_000 });
    await this.untilFieldsSettle();
  }

  /** How many rows the content tree shows. */
  private async treeRows(): Promise<number> {
    return this.page.locator('umb-section-sidebar uui-menu-item').evaluateAll((items) => items.filter((item) => item.getBoundingClientRect().width > 0).length);
  }

  /** A node of the tree by its English name (the tree tags its items with it; it shows the name of the language being edited). */
  private treeItem(englishName: string): Locator {
    return this.page.locator(`umb-section-sidebar uui-menu-item[label="${englishName.replace(/"/g, '\\"')}"]`).first();
  }

  /** The form draws its fields group by group: it is read once the number of fields stops changing. */
  private async untilFieldsSettle(): Promise<void> {
    let last = -1;
    for (let round = 0; round < 20; round += 1) {
      const count = await this.page.locator('umb-property').count();
      if (count === last && count > 0) {
        return;
      }
      last = count;
      await pollInterval();
    }
  }

  /** The tabs of the open form (its own tabs, not Content / Info at the top): links with the tab role. */
  private async formTabs(): Promise<string[]> {
    const tabs = await this.page.getByRole('tab').evaluateAll((elements, left) =>
      elements
        .map((element) => ({ box: element.getBoundingClientRect(), name: (element.textContent ?? '').replace(/\s+/g, ' ').trim() }))
        .filter(({ box, name }) => name && box.width > 0 && box.x >= left && box.y > 125)
        .map(({ name }) => name), WORKSPACE_LEFT);
    return [...new Set(tabs)];
  }

  private formTab(name: string): Locator {
    return this.page.getByRole('tab', { name, exact: true }).first();
  }

  /** The text editors (rich text) load after the form: wait until each has been drawn (up to 20 s, then go on). */
  private async untilEditorsDrawn(): Promise<void> {
    const editors = this.page.locator('umb-input-tiny-mce, umb-input-rich-text');
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const heights = await editors.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      if (heights.every((height) => height > 0)) {
        return;
      }
      await pollInterval();
    }
  }

  /** A view as tall as the form, so one screenshot holds every field of the open tab (and the save buttons below them). */
  private async useTallView(): Promise<void> {
    const bottoms = await this.page.locator('umb-property').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
    const needed = Math.max(0, ...bottoms) + 24 + 54 + 20;
    await this.page.setViewportSize({ width: VIEW.width, height: Math.min(4000, Math.max(VIEW.height, Math.round(needed))) });
    await this.untilLayoutSettles();
  }

  /** After the view changed size the editor lays its fields out again: wait until they stop moving (at most 5 s). */
  private async untilLayoutSettles(): Promise<void> {
    let last = '';
    for (let round = 0; round < 10; round += 1) {
      const now = (await this.page.locator('umb-property').evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().bottom)))).join(',');
      if (now === last) {
        return;
      }
      last = now;
      await pollInterval();
    }
  }

  /** The form's area down to its last field (the fields are inside the editor's components: read through Playwright). */
  private async formBox(): Promise<Box> {
    const bottoms = await this.page.locator('umb-property').evaluateAll((elements, left) =>
      elements.map((element) => element.getBoundingClientRect()).filter((box) => box.height > 0 && box.x >= left).map((box) => box.bottom), WORKSPACE_LEFT);
    const bottom = Math.max(200, ...bottoms);
    return { x: WORKSPACE_LEFT, y: HEADER_HEIGHT, width: VIEW.width - WORKSPACE_LEFT, height: Math.round(bottom + 24 - HEADER_HEIGHT) };
  }

  private async footerBox(): Promise<Box> {
    const footer = await this.page.locator('umb-workspace-footer').first().boundingBox();
    return footer ? { x: Math.round(footer.x), y: Math.round(footer.y), width: Math.round(footer.width), height: Math.round(footer.height) } : { x: WORKSPACE_LEFT, y: VIEW.height - 54, width: VIEW.width - WORKSPACE_LEFT, height: 54 };
  }

  private async treeBox(): Promise<Box> {
    const bottom = await this.page.locator('umb-section-sidebar uui-menu-item').evaluateAll((items) => Math.max(0, ...items.map((item) => item.getBoundingClientRect()).filter((box) => box.width > 0 && box.height <= 40).map((box) => box.bottom)));
    return { x: 0, y: HEADER_HEIGHT, width: WORKSPACE_LEFT, height: Math.max(200, Math.round(bottom + 10 - HEADER_HEIGHT)) };
  }

  /** The Save and publish button's own label (the button also holds its hidden more-options menu). */
  private async publishLabel(): Promise<string> {
    const labels = await this.page.locator('umb-workspace-footer uui-button[label]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('label') ?? ''));
    return labels.find((label) => /publish/i.test(label) && !/preview/i.test(label)) ?? 'Save and publish…';
  }

  //=====================Pictures=====================
  /** Draws the badges over the screen, takes the picture of `clip`, and removes the badges again. */
  private async shoot(page: Page, name: string, clip: Box, caption: string, badges: (Badge | undefined)[]): Promise<Figure> {
    const shown = badges.filter((badge): badge is Badge => badge !== undefined);
    await page.evaluate(
      ({ marks, colour }) => {
        document.getElementById('__guide_badges')?.remove();
        const layer = document.createElement('div');
        layer.id = '__guide_badges';
        layer.setAttribute('popover', 'manual');
        layer.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;';
        for (const mark of marks) {
          const badge = document.createElement('div');
          badge.textContent = String(mark.number);
          badge.style.cssText = `position:fixed;left:${mark.x - 13}px;top:${mark.y - 13}px;width:26px;height:26px;border-radius:50%;background:${colour};color:#fff;border:2px solid #fff;box-shadow:0 0 0 1px ${colour};font:700 14px/22px "DejaVu Sans",Arial,sans-serif;text-align:center;box-sizing:border-box;`;
          layer.append(badge);
        }
        document.body.append(layer);
        (layer as HTMLElement & { showPopover?: () => void }).showPopover?.();
      },
      { marks: shown, colour: BADGE_COLOUR },
    );
    this.figures += 1;
    const file = path.join(this.figureFolder, `${String(this.figures).padStart(2, '0')}-${name}.png`);
    const view = page.viewportSize() ?? VIEW;
    const safe = { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: Math.min(clip.width, view.width - Math.max(0, clip.x)), height: Math.min(clip.height, view.height - Math.max(0, clip.y)) };
    await page.screenshot({ path: file, clip: safe });
    await page.evaluate(() => document.getElementById('__guide_badges')?.remove());
    return { kind: 'figure', file, width: Math.round(safe.width), height: Math.round(safe.height), caption: this.text.figure(this.figures, caption) };
  }

  //=====================Names=====================
  private titleOf(node: ContentNode): string {
    return (this.language === 'ar' ? node.names['ar-EG'] ?? node.names['en-US'] : node.names['en-US'] ?? node.names['ar-EG'])?.trim() ?? node.id;
  }

  /** A document type's name: its Arabic description in the Arabic guide when it has one (the back office's own words). */
  private typeName(type: DocumentTypeInfo): string {
    return (this.language === 'ar' && type.description ? type.description : type.name).trim();
  }

  /** A section the tour could not capture is still listed, with the reason, so the guide never silently misses one. */
  private unavailable(node: ContentNode, error: unknown): Chapter {
    this.log(`  could not capture ${shownName(node)}: ${messageOf(error)}`);
    return { title: this.titleOf(node), intro: [this.text.sectionIntro(shownName(node), ''), line(`[${messageOf(error)}]`)], procedures: [] };
  }

  private unavailableProcedure(node: ContentNode, error: unknown): Procedure {
    this.log(`  could not capture ${shownName(node)}: ${messageOf(error)}`);
    return { title: this.text.edit(this.titleOf(node)), blocks: [note(line(`[${messageOf(error)}]`))] };
  }
}

//=====================Helpers=====================
/** The pause between two looks at the screen while waiting for it to settle (a poll, not a fixed wait). */
const pollInterval = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 500));

const step = (runs: ReturnType<typeof line>): Block => ({ kind: 'step', runs });
const note = (runs: ReturnType<typeof line>): Block => ({ kind: 'note', runs });

/** Clicks a node of the tree on its own row (an opened node holds the rows of its children too). */
const clickRow = (item: Locator): Promise<void> => item.click({ position: { x: 120, y: 18 } });

/** The name the tree tags a node with: its English name when it has one (whatever language the tree shows). */
const treeLabel = (node: ContentNode): string => node.names['en-US'] ?? node.names['ar-EG'] ?? node.id;

/** The name the tree shows: the default language's (Arabic), as the editor sees it. */
const shownName = (node: ContentNode): string => (node.names['ar-EG'] ?? node.names['en-US'] ?? node.id).trim();

const isRealContent = (node: ContentNode): boolean => !Object.values(node.names).some((name) => isTestDataName(name));

const slug = (node: ContentNode): string => slugText(node.names['en-US'] ?? node.id);
const slugText = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 700);

/** The visible text of a control (its shadow DOM included), or a fallback. */
const textOf = async (element: Locator, fallback: string): Promise<string> => {
  const text = await element
    .evaluate((node) => {
      let found = '';
      const walk = (current: Node): void => {
        if (current.nodeType === Node.TEXT_NODE) {
          found += `${current.textContent ?? ''} `;
        }
        if (current instanceof Element && ['STYLE', 'SCRIPT'].includes(current.tagName)) {
          return;
        }
        const shadow = (current as Element).shadowRoot;
        if (shadow) {
          walk(shadow);
        }
        current.childNodes.forEach(walk);
      };
      walk(node);
      return found.replace(/\s+/g, ' ').trim() || (node as Element).getAttribute('label') || '';
    })
    .catch(() => '');
  return text || fallback;
};

/**
 * The button a field is filled in with ("Choose", "Add Phone Number"): Umbraco's buttons carry their name as `label`. The
 * entries' own buttons (actions menu, copy, delete) are not it.
 */
const firstButtonText = async (field: Locator): Promise<string | undefined> => {
  const labels = await field.locator('uui-button[label]').evaluateAll((buttons) =>
    buttons.filter((button) => button.getBoundingClientRect().width > 0).map((button) => (button.getAttribute('label') ?? '').trim()));
  const usable = labels.filter((label) => label && !/actions menu|copy|clipboard|delete|remove|replace|edit/i.test(label));
  return usable.find((label) => /^(add|choose|upload|\+)/i.test(label)) ?? usable[0];
};

/** The label of a sign-in field (its <label>, else its placeholder or accessible name). */
const labelOf = async (page: Page, id: string, fallback: string): Promise<string> =>
  (await page
    .evaluate((inputId) => {
      const label = document.querySelector(`label[for="${inputId}"], uui-label[for="${inputId}"]`)?.textContent?.trim();
      const input = document.getElementById(inputId);
      return label || input?.getAttribute('label') || input?.getAttribute('placeholder') || input?.getAttribute('aria-label') || '';
    }, id)
    .catch(() => '')) || fallback;

/** A badge beside a control: on its left edge, top-left corner, or by its label (fields). */
const badgeOn = async (element: Locator, number: number, where: 'left' | 'right' | 'top-left' | 'below' | 'under' | 'inside' | 'label'): Promise<Badge | undefined> => {
  const box = await element.boundingBox().catch(() => null);
  if (!box) {
    return undefined;
  }
  switch (where) {
    case 'left':
      return { x: Math.max(14, box.x - 14), y: box.y + box.height / 2, number };
    case 'right':
      // Left of the arrow a selector ends with
      return { x: box.x + box.width - 48, y: box.y + box.height / 2, number };
    case 'top-left':
      return { x: box.x - 2, y: box.y - 4, number };
    case 'inside':
      // In a text box, on its empty right part (before the language name a name box ends with)
      return { x: box.x + box.width - 150, y: box.y + box.height / 2, number };
    case 'under':
      // Under a tab's name, on its underline (tabs sit side by side: beside one is on the next)
      return { x: box.x + box.width / 2, y: box.y + box.height - 2, number };
    case 'below':
      return { x: box.x + box.width / 2, y: box.y + box.height - 10, number };
    default:
      // Fields: at the end of the label column, where the label's text has ended (labels are short; the control starts further right)
      return { x: box.x + 205, y: box.y + 14, number };
  }
};

const badgeLeftOf = (element: Locator, number: number): Promise<Badge | undefined> => badgeOn(element, number, 'left');

/** A badge on the right of a tree row (the first row of an item that shows its children below it). */
const badgeOnRow = async (item: Locator, number: number): Promise<Badge | undefined> => {
  const box = await item.boundingBox().catch(() => null);
  return box ? { x: box.x + box.width - 22, y: box.y + 18, number } : undefined;
};

/** The box around an element (with a margin), or the fallback when it is not on the screen. */
const unionBox = async (element: Locator, fallback?: Box, margin = 0): Promise<Box> => {
  const box = await element.boundingBox().catch(() => null);
  if (!box) {
    return fallback ?? { x: 0, y: 0, ...VIEW };
  }
  return { x: Math.round(box.x - margin), y: Math.round(box.y - margin), width: Math.round(box.width + margin * 2), height: Math.round(box.height + margin * 2) };
};
