import type { Locator, Page } from '@playwright/test';

/**
 * Locators of the Umbraco back office controls every CMS screen shares. The back office is made of web components with an
 * open shadow DOM; Playwright's role and CSS locators see through it, so these read like ordinary locators.
 */

/** The languages of the content (the section names differ in each). ECS: to confirm on the live back office. */
export type Culture = 'en-US' | 'ar-EG';

/** The back office's default (mandatory) language, which the tests write in. ECS: to confirm on the live back office. */
export const CONTENT_CULTURE: Culture = 'ar-EG';

/**
 * The editor's fields by the name the sheet and the screen use, and the alias the back office tags them with
 * (`<umb-property data-mark="property:body">`). The sheet's "Featured Image" is the editor's "Main Image" (alias thumbnail):
 * the cases use the screen's names, and this is the one place that knows the aliases.
 */
const PROPERTY_ALIAS: Readonly<Record<string, string>> = {
  Title: 'title',
  'Header Image': 'headerImage',
  Category: 'category',
  Body: 'body',
  'Main Image': 'thumbnail',
  'Gallery Images': 'galleryImages',
  'Summary Override': 'summaryOverride',
  'sharing location': 'sharingLocation',
  'Share In Facebook': 'shareInFacebook',
  'Share via Instagram': 'shareInInstegram',
  'Publish Date': 'publishDate',
  'Is Event': 'isEvent',
  // A news category (CMS-07): its Name field (alias title - not the node name at the top of the form) and its Is Active switch
  Name: 'title',
  'Is Active': 'isActive',
  // The Contact US page (CMS-02); its Contact Form Configuration has a Title and a Description of its own (aliases title, description)
  Address: 'address',
  Email: 'email',
  'Working Hours': 'workingHours',
  'Phone Numbers': 'phoneNumbers',
  'Facebook URL': 'facebookUrl',
  'Instagram URL': 'instagramUrl',
  'Twitter/X URL': 'twitterXUrl',
  'YouTube URL': 'youTubeUrl',
  Description: 'description',
  'Auto-Reply': 'autoReply',
  'Email Message': 'emailMessage',
};

/**
 * The field of an editor with this name (`Title`, `Category`, ...): its label, its control and the validation message under it.
 * A name the screen does not have (a field the sheet expects but the back office lacks) finds nothing, so the case can say so.
 */
export const propertyOf = (page: Page, label: string): Locator => {
  const alias = PROPERTY_ALIAS[label];
  return alias ? propertyWithAlias(page, alias) : page.locator('umb-property').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\b`, 'i') });
};

/** A field by the alias the back office tags it with - for a form whose labels repeat (the President page's two "Name" fields). */
export const propertyWithAlias = (page: Page, alias: string): Locator => page.locator(`umb-property[data-mark="property:${alias}"]`);

/** The pop-up message at the corner of the screen ("Content saved", ...). */
export const notifications = (page: Page): Locator => page.locator('uui-toast-notification');

/** An entry of the menu that is open (row actions, Actions menu, a tree item's actions panel): the Umbraco menu items carry their text as `label`. */
export const menuEntry = (page: Page, label: string): Locator => page.locator(`uui-menu-item[label="${label.replace(/"/g, '\\"')}"]:visible`).first();

/**
 * The text an element shows, including the text inside its components' shadow DOM (`innerText` and `textContent` stop at a
 * shadow root, so a status tag or a label drawn by a component reads as empty).
 */
export const shownText = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => {
    let text = '';
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += `${node.textContent ?? ''} `;
      }
      if (node instanceof Element && ['STYLE', 'SCRIPT'].includes(node.tagName)) {
        return;
      }
      const shadow = (node as Element).shadowRoot;
      if (shadow) {
        walk(shadow);
      }
      node.childNodes.forEach(walk);
    };
    walk(element);
    return text.replace(/\s+/g, ' ').trim();
  });

/**
 * Waits for a screen to be ready - or for Umbraco's "Your session has timed out" sign-in panel, which it shows inside the
 * page instead of going to the sign-in form. In that case the stale session is dropped, so the next visit lands on the
 * sign-in form, where the tab signs in again by itself. Returns whether the screen has to be visited again.
 */
export const sessionTimedOut = async (page: Page, ready: Locator, timeout: number): Promise<boolean> => {
  const timedOut = page.getByRole('heading', { name: /sign in to umbraco/i });
  await ready.or(timedOut).first().waitFor({ state: 'visible', timeout }).catch(() => undefined);
  if (!(await timedOut.isVisible().catch(() => false))) {
    return false;
  }
  await page.evaluate(() => localStorage.removeItem('umb:userAuthTokenResponse')).catch(() => undefined);
  return true;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every element of a kind (tag name) inside the page's shadow DOMs, as their visible labels: the menu entries of an actions menu. */
export const labelsOfElements = (page: Page, tags: readonly string[]): Promise<string[]> =>
  page.evaluate((wanted) => {
    const found: string[] = [];
    const visit = (root: Document | ShadowRoot | Element): void => {
      root.querySelectorAll('*').forEach((element) => {
        if (wanted.includes(element.tagName.toLowerCase())) {
          const label = (element.getAttribute('label') ?? element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ');
          if (label) {
            found.push(label);
          }
        }
        if (element.shadowRoot) {
          visit(element.shadowRoot);
        }
      });
    };
    visit(document);
    return found;
  }, tags);
