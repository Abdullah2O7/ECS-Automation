import path from 'node:path';
import type { Locator, Page, Response } from '@playwright/test';
import { backOfficeTimeouts } from '../../config/timeouts';
import { step } from '../../utils/core/stepDecorator';
import { logger } from '../../utils/logger/logger';
import * as actions from '../../utils/actions/ui/elementActions';
import * as assertions from '../../utils/assertions/ui/elementAssertions';
import { noteContext } from '../../utils/evidence/failure-focus';
import { CmsDocumentEditor } from './document-editor.page';
import { propertyOf, propertyWithAlias } from './umbraco-ui';
import type { Culture } from './umbraco-ui';

/**
 * A field of a back-office form: the alias the back office tags it with, and the tab it is drawn on when the form has tabs.
 * Both are in docs/cms-model.md.
 */
export type FormField = { alias: string; tab?: string };

/** How long an uploaded picture may take to reach the server and show in its field. */
const UPLOAD_TIMEOUT = 60_000;

/**
 * Any document form of the back office, driven by a list of its fields: a new back-office story needs only the list
 * (names as the sheet says them -> alias and tab, from docs/cms-model.md), not a page object of its own.
 *
 * ```ts
 * const FIELDS = { Title: { alias: 'title' }, 'Founder Name': { alias: 'founderName', tab: 'Club Founder' } } satisfies Record<string, FormField>;
 * class CmsHistoryForm extends CmsDocumentForm<keyof typeof FIELDS> { ... super(page, parentId, 'History page', FIELDS) }
 * ```
 *
 * What it does with a field: text boxes and text areas (typeText), rich text (typeRichText), pictures through the field's
 * "Click to upload" drop zone (upload), Yes / No switches (setSwitch). A field on another tab is shown first (its tab is
 * chosen). Save and publish, the messages and the refusals are the document form's (CmsDocumentEditor).
 */
export class CmsDocumentForm<Name extends string> extends CmsDocumentEditor {

  //=====================Constructor==================
  constructor(page: Page, parentId: string, what: string, private readonly fields: Readonly<Record<Name, FormField>>) {
    super(page, parentId, what);
  }

  /** A field of the form. */
  field(name: Name): Locator {
    return propertyWithAlias(this.page, this.fields[name].alias);
  }

  //=====================Actions======================
  /** Opens a document (the case's own copy) for editing, in a language. */
  @step('Open the document {id} for editing ({culture})')
  async openExisting(id: string, culture: Culture): Promise<void> {
    await this.openForm(this.addressOf(id, culture), `Open the ${this.what}`);
  }

  /** Goes to a document's address in the back office and does not wait for the form: for a visitor who is not signed in. */
  @step('Go to the document {id} in the back office')
  async goTo(id: string, culture: Culture): Promise<void> {
    await this.visit(this.addressOf(id, culture));
  }

  /** The form is drawn group by group: it is used once the last field of its first tab is there. */
  protected async untilFormRendered(): Promise<void> {
    const names = Object.keys(this.fields) as Name[];
    const firstTab = this.fields[names[0]].tab;
    const last = names.filter((name) => this.fields[name].tab === firstTab).pop() ?? names[0];
    await assertions.assertVisible(this.field(last), `${last} field`, { message: `the ${this.what} form should finish loading`, timeout: backOfficeTimeouts.pageLoad });
  }

  /** Types into a text box or text area (an empty text clears it). */
  @step('Type into {name}: {value}')
  async typeText(name: Name, value: string): Promise<void> {
    await this.show(name);
    await actions.type(this.field(name).locator('input, textarea').first(), value, name);
  }

  /**
   * Types into a rich text field (TinyMCE). The editor replaces its content area while it starts, so text typed too early is
   * lost: the text is put in once the editor is ready, and again if it did not stay.
   */
  @step('Type {length} characters into {name}')
  async typeRichText(name: Name, text: string, length = text.length): Promise<void> {
    void length; // for the step's title only: the text itself can be thousands of characters
    await this.show(name);
    const area = this.field(name).locator('iframe').first().contentFrame().locator('body[contenteditable="true"]');
    await area.waitFor({ state: 'visible', timeout: backOfficeTimeouts.pageLoad });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await area.click();
      await area.fill(text);
      const kept = await assertions
        .assertEventually(async () => (await area.innerText()).trim().length > 0, { message: `${name} should keep the typed text`, timeout: 5_000 })
        .toBe(text.trim().length > 0)
        .then(() => true, () => false);
      if (kept) {
        return;
      }
    }
    throw new Error(`RICH_TEXT_NOT_TYPED: the ${name} editor did not keep the text typed into it`);
  }

  /**
   * Uploads pictures into a picture field the way a user does: through the field's "Click to upload" drop zone. Each picture
   * is sent to the server (a media item is created for it) and only then added to the field as a card. The case goes on once
   * the server has answered for every picture and each one it took shows in the field - a picture the server refuses is
   * left out, so the case can check what the field holds.
   */
  @step('Upload {files} to {name}')
  async upload(name: Name, files: readonly string[]): Promise<void> {
    await this.show(name);
    const before = await this.pictureCount(name);
    const answers: number[] = [];
    const onResponse = (response: Response): void => {
      if (response.request().method() === 'POST' && /\/management\/api\/v1\/media$/.test(new URL(response.url()).pathname)) {
        answers.push(response.status());
      }
    };
    this.page.on('response', onResponse);
    try {
      const input = this.field(name).locator('input[type="file"]').first();
      await input.waitFor({ state: 'attached', timeout: backOfficeTimeouts.pageLoad });
      await input.setInputFiles([...files]);
      await assertions
        .assertEventually(() => answers.length, { message: `the server should answer the upload of ${files.length} picture(s)`, timeout: UPLOAD_TIMEOUT })
        .toBe(files.length);
    } finally {
      this.page.off('response', onResponse);
    }
    const taken = answers.filter((status) => status < 300).length;
    await assertions
      .assertEventually(() => this.pictureCount(name), { message: `${name} should show the ${taken} picture(s) the server took`, timeout: backOfficeTimeouts.message })
      .toBe(before + taken)
      .catch(() => logger.warn(`${name} did not show every picture the server took: ${files.map((file) => path.basename(file)).join(', ')}`));
  }

  /** Switches a Yes / No switch on or off. */
  @step('Set {name} to {on}')
  async setSwitch(name: Name, on: boolean): Promise<void> {
    await this.show(name);
    if ((await this.isSwitchOn(name)) !== on) {
      await actions.click(this.field(name).locator('uui-toggle').first(), name);
    }
    assertions.assertToBe(await this.isSwitchOn(name), on, `${name} should be ${on ? 'Yes' : 'No'}`);
  }

  /** Save and publish, the way an editor updates the page: every language of the page is published. */
  async publish(): Promise<void> {
    await this.saveAndPublish({ allLanguages: true });
  }

  //=====================Reading======================
  /** How many pictures a picture field holds: each is a card with the picture's name (a refused upload leaves a nameless one). */
  async pictureCount(name: Name): Promise<number> {
    noteContext({ locator: this.field(name), what: `the ${name} field` });
    return this.field(name).locator('uui-card-media[name]:not([name=""])').count();
  }

  async isSwitchOn(name: Name): Promise<boolean> {
    noteContext({ locator: this.field(name), what: `the ${name} switch` });
    return this.field(name).locator('uui-toggle').first().evaluate((toggle) => (toggle as HTMLElement & { checked?: boolean }).checked === true);
  }

  //=====================Assertions===================
  /** The form has a field with this label, or a tab of this name (a part of the sheet the back office may lack). */
  @step('Assert the form has {label}')
  async expectFieldOrTab(label: string, tab: RegExp = new RegExp(label, 'i')): Promise<void> {
    const found = propertyOf(this.page, label).or(this.page.getByRole('tab', { name: tab })).first();
    await assertions.assertVisible(found, label, { message: `the ${this.what} form should have ${label}`, timeout: 5_000 });
  }

  //=====================Private======================
  /** Chooses the tab a field is on, when it is not shown: the tab the field list names, or else each form tab in turn. */
  private async show(name: Name): Promise<void> {
    const field = this.field(name);
    if (await field.isVisible()) {
      return;
    }
    const named = this.fields[name].tab;
    const tabs = named ? [named] : (await this.page.getByRole('tab').allInnerTexts()).map((text) => text.trim()).filter((text) => text && text !== 'Info');
    for (const tab of tabs) {
      await actions.click(this.page.getByRole('tab', { name: tab, exact: true }), `${tab} tab`);
      if (await field.waitFor({ state: 'visible', timeout: named ? backOfficeTimeouts.pageLoad : 5_000 }).then(() => true, () => false)) {
        return;
      }
    }
    await assertions.assertVisible(field, name, { message: `the ${this.what} form should show the ${name}`, timeout: 1_000 });
  }

  private addressOf(id: string, culture: Culture): string {
    return `/umbraco/section/content/workspace/document/edit/${id}/${culture}/root`;
  }
}
