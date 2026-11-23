import type { Locator, Page, Response } from '@playwright/test';
import { BasePage } from '../base.page';
import { backOfficeTimeouts } from '../../config/timeouts';
import { retrying } from '../../utils/core/retry';
import { step } from '../../utils/core/stepDecorator';
import { logger } from '../../utils/logger/logger';
import { normalizeText } from '../../utils/core/text';
import * as actions from '../../utils/actions/ui/elementActions';
import * as assertions from '../../utils/assertions/ui/elementAssertions';
import { noteContext } from '../../utils/evidence/failure-focus';
import { labelsOfElements, menuEntry, notifications, propertyOf, sessionTimedOut, shownText } from './umbraco-ui';
import type { Culture } from './umbraco-ui';

/** The editor shows its answer within seconds; a control that is missing will not appear later. */
const PRESENCE_TIMEOUT = 5_000;
const SAVE_TIMEOUT = backOfficeTimeouts.serverAnswer;

/** Where the back office shows an error: pop-ups, the messages under fields, alerts and dialogs. */
const ERROR_PLACES = 'uui-toast-notification, umb-form-validation-message, uui-form-validation-message, [role="alert"], uui-dialog, umb-property-layout #messages';

/** Only errors: red pop-ups and the messages under fields (a success pop-up - "Saved" - is not one). */
const ERRORS_ONLY = 'uui-toast-notification[color="danger"], umb-form-validation-message, uui-form-validation-message, umb-property-layout #messages';

const CULTURE_NAME: Record<Culture, RegExp> = { 'en-US': /English/i, 'ar-EG': /Arabic/i };

/**
 * What every document form of the Umbraco back office has in common - an article (CMS-06), a news category (CMS-07), ...:
 * the node name at the top, the Save and Save and publish buttons with their language dialog, the Actions menu, and the
 * messages and errors the back office shows. A page object for one kind of document extends this and adds its own fields.
 *
 * The node name (the "Enter a name..." box at the top) is not the document's Title or Name field: those are fields of
 * the document type, further down the form.
 */
export abstract class CmsDocumentEditor extends BasePage {

  //=====================Locators=====================
  protected readonly nameField: Locator;
  protected readonly saveButton: Locator;
  protected readonly saveAndPublishButton: Locator;
  protected readonly actionsMenuButton: Locator;
  protected readonly variantButton: Locator;

  /** The reasons the back office gave for the fields it refused at the last save (see rememberRefusals). */
  private refusals: string[] = [];

  //=====================Constructor==================
  /**
   * @param parentId the node the documents are created under (News, News Category): its id is never taken for a new document's
   * @param what     what the form edits, for messages: "article", "category"
   */
  protected constructor(page: Page, protected readonly parentId: string, protected readonly what: string) {
    super(page, 'cms');
    this.nameField = this.page.getByRole('textbox', { name: 'Enter a name...' });
    // The buttons are named "Save…" and "Save and publish…" (the dots: they ask which languages to save)
    this.saveButton = this.page.getByRole('button', { name: /^save(…|\.\.\.)?$/i });
    this.saveAndPublishButton = this.page.getByRole('button', { name: /^save and publish/i });
    this.actionsMenuButton = this.page.getByRole('button', { name: 'Actions', exact: true });
    this.variantButton = this.page.getByRole('button', { name: 'Select a variant' });
    this.page.on('response', (response) => void this.rememberRefusals(response));
  }

  /** The form is used once its last field has been drawn (the editor draws its fields one group after another). */
  protected abstract untilFormRendered(): Promise<void>;

  /**
   * Opens a form (create or edit) and waits until it can be used. A form that does not finish loading is loaded again, once:
   * the back office sometimes stalls on a page. An expired session is signed in again.
   */
  protected async openForm(address: string, what: string): Promise<void> {
    await retrying(what, async () => {
      await this.visit(address);
      if (await sessionTimedOut(this.page, this.nameField, backOfficeTimeouts.pageLoad)) {
        await this.visit(address);
      }
      await assertions.assertVisible(this.nameField, `${this.what} name`, { message: `the ${this.what} form should open`, timeout: backOfficeTimeouts.pageLoad });
      await this.untilFormRendered();
    }, { attempts: 2 });
  }

  /** Types the node name: the name at the top of the form, the one the content tree and lists show. */
  @step('Type the node name {name}')
  async typeNodeName(name: string): Promise<void> {
    await actions.type(this.nameField, name, `${this.what} node name`);
  }

  //=====================Actions======================
  /**
   * Umbraco's checkboxes and switches (`uui-checkbox`, `uui-toggle`) hide their real input behind a styled box, so a click goes to
   * the box (the component) and the state is read from the input.
   */
  protected async tick(box: Locator, name: string): Promise<void> {
    const input = box.getByRole('checkbox').or(box.getByRole('switch'));
    if (!(await input.first().isChecked())) {
      await actions.click(box, name);
    }
    await assertions.assertChecked(input.first(), name, { message: `${name} should be ticked`, timeout: PRESENCE_TIMEOUT });
  }

  @step('Click Save')
  async save(): Promise<void> {
    this.refusals = [];
    await this.clickBlockedOrNot(this.saveButton.first(), 'Save');
    // Saved = the server answered the create (POST document) or the update (PUT document/<id>)
    await this.untilServerAnswers(/\/document(\/[0-9a-f-]{36})?$/, () => this.confirmVariantDialog());
  }

  /**
   * Save and publish; `allLanguages` publishes every language of the document (the one edited and the others), as needed
   * when the language edited is not the mandatory one. The reasons of a refusal are collected from this save on.
   */
  @step('Click Save And Publish')
  async saveAndPublish(options: { allLanguages?: boolean } = {}): Promise<void> {
    this.refusals = [];
    await this.clickBlockedOrNot(this.saveAndPublishButton.first(), 'Save And Publish');
    // The back office saves first and publishes after: the case goes on only once the publish itself was answered
    await this.untilServerAnswers(/\/document\/[0-9a-f-]{36}\/publish$/, () => this.confirmVariantDialog(options));
  }

  /**
   * Closes whatever panel or pop-up is still open over the editor (a picker, a dialog, a notification), so the next click
   * reaches the button it is meant for.
   */
  async closePanels(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const open = this.page.locator('uui-modal-sidebar, uui-modal-dialog');
      if ((await open.count()) === 0) {
        break;
      }
      await this.page.keyboard.press('Escape');
      await open.first().waitFor({ state: 'detached', timeout: 3_000 }).catch(() => undefined);
    }
    await this.dismissNotifications();
  }

  /** The notifications stay on screen until closed, over the Save buttons: they are closed before the next action. */
  protected async dismissNotifications(): Promise<void> {
    await notifications(this.page)
      .evaluateAll((toasts) => toasts.forEach((toast) => toast.remove()))
      .catch(() => undefined);
  }

  /**
   * Clicks a button of the editor; when something lies over it (an open panel, a notification) it is closed and the click
   * tried again. A click that never happened is safe to repeat.
   */
  protected async clickBlockedOrNot(button: Locator, name: string): Promise<void> {
    await retrying(`Click ${name}`, () => actions.click(button, name), { recover: () => this.closePanels() });
  }

  /**
   * Runs a step that sends the article to the server and waits for the server's answer to the request whose path matches
   * `request` - or for a refusal (an answer of 400 or more to any article request, e.g. a failed validation, after which the
   * request waited for is never sent). Leaving the page before the answer would cancel the operation.
   */
  protected async untilServerAnswers(request: RegExp, step: () => Promise<void>): Promise<void> {
    const answered = this.page
      .waitForResponse(
        (response) => {
          const method = response.request().method();
          const { pathname } = new URL(response.url());
          // …/v1/document/<id> saves; …/v1.1/document/<id>/validate checks the fields first and answers 400 when one is refused
          return method !== 'GET' && /\/management\/api\/v1(\.\d+)?\/document/.test(pathname) && (request.test(pathname) || response.status() >= 400);
        },
        { timeout: SAVE_TIMEOUT },
      )
      .catch(() => logger.warn(`The back office did not answer ${request} within ${SAVE_TIMEOUT / 1000} s`));
    await step();
    await answered;
  }

  /** Opens the Actions menu of the open document and returns the entries it offers. */
  @step('Open the Actions menu')
  async openActionsMenu(): Promise<string[]> {
    await this.clickBlockedOrNot(this.actionsMenuButton.first(), 'Actions');
    // The menu fills in as the back office works out which actions this article allows: it is read once its own entries
    // (Trash…, the action every article offers) are there
    const read = async (): Promise<string[]> => (await labelsOfElements(this.page, ['uui-menu-item', 'umb-entity-action-list-item'])).map(normalizeText);
    await assertions
      .assertEventually(async () => (await read()).some((entry) => /^trash/i.test(entry)), { message: 'the Actions menu should finish loading', timeout: 15_000 })
      .toBe(true)
      .catch(() => logger.warn('The Actions menu offered no Trash entry within 15 s'));
    return read();
  }

  /**
   * Chooses an entry of the Actions menu (`Unpublish…`, `Trash…`, ...) and confirms the dialog it opens. Give an anchored pattern
   * (`/^trash/i`): the content tree's own items ("Recycle Bin") are menu items on the screen too.
   */
  @step('Run the action {action}')
  async runAction(action: RegExp): Promise<void> {
    const offered = await this.openActionsMenu();
    if (!offered.some((entry) => action.test(entry))) {
      throw new Error(`ACTION_NOT_AVAILABLE: the Actions menu has no entry matching ${action}; it offers [${offered.join(', ')}]`);
    }
    const entry = offered.find((candidate) => action.test(candidate)) ?? '';
    await actions.click(menuEntry(this.page, entry), `Action ${entry}`);
    // Unpublish asks which languages: all of them (an article that exists in one language only has just that one to unpublish).
    // The case goes on once the server answered the action (…/unpublish, …/move-to-recycle-bin, …).
    await this.untilServerAnswers(/\/document\/[0-9a-f-]{36}\/[a-z-]+$/, () =>
      this.confirmDialog(/^(unpublish|trash|move to recycle bin|delete|restore|archive|confirm|ok|yes)$/i, { allLanguages: true }),
    );
  }

  //=====================Reading======================
  /** The document's id once the server has created it: the editor's address changes from create to edit. */
  async savedId(): Promise<string> {
    // The editor's address ends in the article's id; the News node's own id (the page the form was opened under) is never the article's
    const idOf = (): string | undefined => {
      const id = /\/document\/edit\/([0-9a-f-]{36})/.exec(this.page.url())?.[1];
      return id && id !== this.parentId ? id : undefined;
    };
    await assertions.assertEventually(() => idOf() !== undefined, { message: `the ${this.what} should have been created (the editor should switch to edit)`, timeout: SAVE_TIMEOUT }).toBe(true);
    return idOf() ?? '';
  }

  /** Whether a field with this label exists in the editor. */
  async hasField(label: string): Promise<boolean> {
    return (await propertyOf(this.page, label).count()) > 0;
  }

  //=====================Assertions===================
  /** A message the back office shows in a pop-up after an action. */
  @step('Assert the message {message} is displayed')
  async expectMessage(message: string | RegExp): Promise<void> {
    await assertions.assertVisible(notifications(this.page).filter({ hasText: message }).first(), `Message ${message}`, {
      message: `the back office should display a message like "${message}"`,
      timeout: SAVE_TIMEOUT,
    });
  }

  /**
   * An error the back office shows - a pop-up, a message under a field, an alert or a dialog. `field` is the field the error is
   * about (it is framed on the screenshot when the error is missing). When no such error appears, the failure lists the errors
   * the back office does show, so the report says what happened instead.
   */
  @step('Assert the error {message} is displayed')
  async expectError(message: string | RegExp, field?: string): Promise<void> {
    // The back office's red pop-ups close by themselves after a few seconds: what is shown is read every half second while
    // waiting, so a message that came and went is still matched - or listed in the failure
    const places = this.page.locator(ERROR_PLACES);
    const matches = (text: string): boolean => (typeof message === 'string' ? text.toLowerCase().includes(message.toLowerCase()) : message.test(text));
    const seen = new Set<string>();
    const until = Date.now() + backOfficeTimeouts.message;
    while (Date.now() < until) {
      for (const text of await this.textsOf(places).catch(() => [] as string[])) {
        if (matches(text)) {
          return;
        }
        seen.add(text);
      }
      await new Promise((resolve) => setTimeout(resolve, 500)); // the poll interval
    }
    noteContext(
      field
        ? { locator: propertyOf(this.page, field), what: `the ${field} field` }
        : { locator: this.page.locator('umb-content-workspace-view-edit-properties').first(), what: `the ${this.what} form` },
    );
    assertions.assertToBe(
      seen.size > 0 ? `errors shown: ${[...seen].join(' | ')}` : 'no error shown',
      `an error like ${String(message)}`,
      `the editor should display an error like "${String(message)}"`,
    );
  }

  /**
   * After a save that should succeed: no error is shown. Fails at once with the errors the back office shows, instead of
   * waiting for a form that will never switch to edit.
   */
  @step('Assert no error is shown')
  async expectNotRefused(): Promise<void> {
    const shown = await this.textsOf(this.page.locator(ERRORS_ONLY));
    assertions.assertToBe(shown.length === 0 ? 'no error' : `errors shown: ${[...new Set(shown)].join(' | ')}`, 'no error', `the ${this.what} should be saved without an error`);
  }

  /**
   * The back office refused the save with a reason like `message`: shown on the screen (a pop-up, the field's message) or
   * given by its validation for the field (some reasons are only shown inside a block or a picker). When it did not, the
   * failure lists what it showed and said instead. `field` names the field; it is framed (`where`, by default the field
   * with that label) on the screenshot of a failure.
   */
  @step('Assert the back office refuses it: {message}')
  async expectRefused(message: RegExp, field: string, where: Locator = propertyOf(this.page, field)): Promise<void> {
    const seen = new Set<string>();
    const until = Date.now() + backOfficeTimeouts.message;
    while (Date.now() < until) {
      const shown = [...(await this.errorsShown()), ...this.refusals];
      const reason = shown.find((text) => message.test(text));
      if (reason) {
        logger.info(`The back office refused the ${field}: ${reason}`);
        return;
      }
      shown.forEach((text) => seen.add(text));
      await new Promise((resolve) => setTimeout(resolve, 500)); // the poll interval
    }
    noteContext({ locator: where, what: `the ${field} field` });
    assertions.assertToBe(
      seen.size > 0 ? `shown / answered: ${[...seen].join(' | ')}` : 'no error and no refusal',
      `a refusal like ${String(message)}`,
      `the back office should refuse the ${field} with a message like "${String(message)}"`,
    );
  }

  /** The save went through: no error was shown and the back office's validation refused nothing. */
  @step('Assert the back office accepts it')
  async expectAccepted(): Promise<void> {
    await this.expectNotRefused();
    assertions.assertToBe(this.refusals.length === 0 ? 'nothing refused' : `refused: ${this.refusals.join(' | ')}`, 'nothing refused', `the back office should accept every field of the ${this.what}`);
  }

  /** The errors the editor shows now: pop-ups, messages under fields, alerts and dialogs. */
  protected async errorsShown(): Promise<string[]> {
    return this.textsOf(this.page.locator(ERROR_PLACES)).catch(() => []);
  }

  /** The visible text of each element (shadow DOM included), empty ones left out. */
  protected async textsOf(elements: Locator): Promise<string[]> {
    return (await elements.evaluateAll((items) =>
      items.map((item) => {
        let text = '';
        const walk = (node: Node): void => {
          if (node.nodeType === Node.TEXT_NODE) {
            text += `${node.textContent ?? ''} `;
          }
          const element = node as Element;
          if (element.shadowRoot) {
            walk(element.shadowRoot);
          }
          node.childNodes.forEach(walk);
        };
        walk(item);
        return text.replace(/\s+/g, ' ').trim();
      }),
    )).filter(Boolean);
  }

  /** The field's own validation message (the text under its control after a failed save). */
  @step('Assert the {label} field shows an error')
  async expectFieldError(label: string, message: string | RegExp): Promise<void> {
    await assertions.assertTextContains(propertyOf(this.page, label), message, `${label} field`, { message: `the ${label} field should show "${message}"`, timeout: backOfficeTimeouts.message });
  }

  @step('Assert the {label} field exists')
  async expectField(label: string): Promise<void> {
    await assertions.assertVisible(propertyOf(this.page, label).first(), `${label} field`, {
      message: `the editor should have a ${label} field`,
      timeout: PRESENCE_TIMEOUT,
      frame: this.page.locator('umb-content-workspace-view-edit-properties').first(),
    });
  }

  /** The form was refused: the editor is still on the Create form (a created document switches it to edit). */
  @step('Assert it was not saved')
  async expectNotSaved(): Promise<void> {
    assertions.assertToBe(/\/document\/create\//.test(this.page.url()), true, `the ${this.what} should not have been created`);
    await Promise.resolve();
  }

  @step('Assert it was saved')
  async expectSaved(): Promise<string> {
    return this.savedId();
  }

  //=====================Private======================
  /** Switches the editor to a language when it is not already on it. */
  protected async useCulture(culture: Culture): Promise<void> {
    if (!(await this.variantButton.isVisible().catch(() => false))) {
      return;
    }
    if (CULTURE_NAME[culture].test(normalizeText(await shownText(this.variantButton)))) {
      return;
    }
    await actions.click(this.variantButton, 'Variant switch');
    await actions.click(this.page.getByRole('button', { name: CULTURE_NAME[culture] }).or(this.page.locator('uui-menu-item').filter({ hasText: CULTURE_NAME[culture] })).first(), `Language ${culture}`);
  }

  /** Save and publish ask which languages to apply to; the one being edited is already ticked - confirm it ("Save and close", "Save and publish"). */
  protected async confirmVariantDialog(options: { allLanguages?: boolean } = {}): Promise<void> {
    await this.confirmDialog(/^(save and close|save and publish|publish|save)$/i, options);
  }

  /**
   * Confirms the dialog an action opened, if one opens (Save, Publish, Unpublish, Trash, Delete); a language list (with
   * "Select all") may come first. The dialog's content is slotted into `uui-modal-dialog` - it is not inside the inner
   * `<dialog>` element in the DOM, so the buttons are looked for under the component.
   */
  protected async confirmDialog(confirm: RegExp, options: { allLanguages?: boolean } = {}): Promise<void> {
    const dialog = this.page.locator('uui-modal-dialog');
    const button = dialog.getByRole('button', { name: confirm }).last();
    // The dialog can take several seconds to open on the slow back office; a confirm that is not waited for saves nothing
    if (!(await button.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false))) {
      return;
    }
    const everyLanguage = dialog.locator('uui-checkbox[label*="select all" i]');
    if (options.allLanguages && (await everyLanguage.count()) > 0) {
      await this.tick(everyLanguage.first(), 'Select all languages');
    }
    await actions.click(button, 'Confirm in the dialog');
  }

  /** Keeps the reasons the field check (…/document/<id>/validate) gave for the fields it refused. */
  private async rememberRefusals(response: Response): Promise<void> {
    if (response.status() !== 400 || !/\/document\/[0-9a-f-]{36}\/validate$/.test(new URL(response.url()).pathname)) {
      return;
    }
    const body = (await response.json().catch(() => undefined)) as { errors?: Record<string, unknown> } | undefined;
    for (const reasons of Object.values(body?.errors ?? {})) {
      this.refusals.push(...(Array.isArray(reasons) ? reasons.map(String) : [String(reasons)]));
    }
  }
}
