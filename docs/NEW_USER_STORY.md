# New user story: from the Excel sheet to an accurate first run

The aim: when a new story's tests are run for the first time, **every passed case really works and every failed case is a
real bug**. A failure caused by the test itself (a wrong locator, a misread case, a message worded differently, a slow page)
must be found and fixed *before* the story is handed over, not discovered in the first run.

Each phase below ends with a gate. Nothing moves on until the gate holds.

## Before anything: the team copy (GitHub)

The project is shared through GitHub (README section 11) and teammates' work arrives in the person's folder with
**Get latest**. So:

- Work starts from the person's folder **as it is now**: refresh any working copy from it first, and never copy an
  older file over a newer one (a teammate's change would be lost).
- Never commit or push for the person: everyone shares their own work with **Share my work**. When the work is ready,
  say so and that it goes to the team with that button.
- A share that stopped because the same lines changed on both sides is left half-shared on purpose (the person's
  commit is kept, nothing is pushed). Combine it: `git rebase origin/main` in the person's folder, resolve the files it
  names keeping both sides' intent, run the checks, then let the person press **Share my work** again.
- Verdicts (`review.json`) are local to the person; `not-applicable.json` is shared.
- Teammates without Claude share a new story as its sheet plus the `npm run story:new` skeleton (cases "Not automated
  yet"). When asked to "check" or "build the new cases", run `npm run story:check` in the person's folder: it lists every
  story with cases not built - build those stories with this guide, from Phase 1.

## A changed sheet (V2) of an existing story

The tests of a story always match its current sheet, word for word (`npm run test:unit` checks it: "Specs match their
story sheets"). When the person brings a new version of a sheet whose story already has tests:

1. Put it in `docs/test-cases` in place of the old one (the folder holds one sheet per story; keep the same file name, or
   update `"sheet"` in the page's `page.json` when the name changes).
2. Run `npm run test:unit`: the sheet check names every case whose text, priority or order changed, and any case added or
   removed.
3. Paste the new texts into the spec (same case ids, sheet order). A new case starts as `test.fixme(true, 'Not automated
   yet')`; a removed case is deleted with its not-applicable entry. Never renumber existing cases to make room.
4. Rebuild each changed case with the phases below (from Phase 2 for what the change touches), run it, and list for the
   person what changed: cases added, removed, and changed - with the new expectation.

## Before anything: what we already know
- [cms-model.md](cms-model.md) - every kind of page of the back office: where it is, its tabs and fields, aliases and the
  rules each field is configured with (`npx playwright test --config=playwright.tools.config.ts cms-model` writes it; run it again when the back office changed).
- [cms-rules.md](cms-rules.md) - what the server **really** refuses and the exact messages: empty required fields, one
  character over each limit, the server's own lower limits, unique names, too many pictures, picture sizes and formats
  (`npx playwright test --config=playwright.tools.config.ts cms-probe` writes it; `PROBE="AboutUS"` probes one kind of page, `PROBE="Home"` the home page).
- These tools are Claude's, not the user's: they are not npm scripts and the README does not list them. Leftover test
  data from an interrupted run: `npx playwright test --config=playwright.tools.config.ts cms-cleanup` (`CLEANUP_AGE_MIN`, `CLEANUP_LABEL`).
- [app-knowledge.md](app-knowledge.md) - what the back office and the portal really do (limits, messages, quirks).
- [accepted-differences.md](accepted-differences.md) - the team's rules (not applicable: HTTP codes and server errors;
  accepted wording; Umbraco's own messages; ...). A new story follows them from the start.
- `tests/pages/*/review.json` - the reviewer's verdicts from the dashboard ("Your verdict" next to each case): the result a
  case should give (`expected`: passed, failed, blocked) and why (`note`, e.g. "the maximum is now 200"). For every
  verdict without `done`: change the test, its data (limits, messages) or its hint so the case gives that result - a
  changed requirement goes into the data file and, when it is an accepted difference, into accepted-differences.md; run
  the case; then write `"done": { "at": "<ISO time>", "note": "<what was changed>" }` into its entry, which the dashboard
  shows on the case. Check them at the start of every piece of work, not only for new stories.
- Claude's own runs sign in as `CMS_SECOND` (`CMS_ACCOUNT=CMS_SECOND`), never as the dashboard's `CMS_CONTENT`: one account
  can be signed in from one place only, and a second sign-in signs the first out.

## Phase 1 - Read the sheet (no code yet)

1. Put the sheet in `docs/test-cases/` (`<STORY> - <name>.xlsx`) and scaffold the page:

   ```
   npm run story:new
   ```

   It adds every new sheet in the folder at once (only one: `npm run story:new -- PTL-09`). It writes `tests/pages/<page>/page.json` and a spec with **every scenario pasted from the sheet**, each one
   `test.fixme('Not automated yet')`, and prints the case list. Cases the standing rules settle (a server error) start as
   not applicable with the reason (`not-applicable.json`); cases that ask for an HTTP status code are listed to be decided.
   For a back-office story, Claude runs the cms-model and cms-probe tools for its kinds of page next.
2. Write the **case plan**: for each case, one line on what screen it uses, what it does, and what "pass" means, plus a verdict:

   | Verdict | Meaning | What happens to it |
   |---|---|---|
   | Automate | can be checked on the web portal / back office | written in phase 3 |
   | Not applicable | the feature is not in this build (removed, mobile app only, out of scope) | proposed for `not-applicable.json` with the reason |
   | Blocked | needs access we do not have (mobile app, e-mail inbox, payment gateway) | `test.fixme` with the reason |

3. Ask about ambiguous cases. Send the user **only** the cases that can be read two ways, each with the reading
   chosen. (Example: "CMS-06-06 Title = the news title field, the first field of the form, not the category title".)

**Gate:** every case has a verdict and an agreed reading.

## Phase 2 - Live audit of the real pages

Start from cms-model.md and cms-rules.md: they already give each field's alias, tab and limits and the server's messages,
so the audit in the browser only confirms the screens (what is drawn where, the dialogs, the portal) - it does not hunt
for limits by trial any more. A back-office form needs no page object of its own: give `CmsDocumentForm`
(src/pages/cms/document-form.page.ts) the list of its fields (name -> alias and tab, from cms-model.md).

4. Open each screen in the person's Chrome (Claude in Chrome). The back office needs a sign-in that **only the person
   types**: open the sign-in page in a tab and ask them to sign in there. Read the real page with the browser's JavaScript
   tool and screenshots - Umbraco draws inside open shadow DOM, so walk each element's `shadowRoot` (and read text with a
   deep text walker). **Only open dialogs and cancel them** (Escape / Cancel); never confirm Trash, Delete, Unpublish or
   Publish on existing content. Names in the app may differ from the sheet (English vs Arabic, "Trash" vs "Delete"):
   tolerate that and report only real behaviour gaps. Record, for every field, button, dialog and message the cases touch:
   - the real label in both languages, and the stable locator for it (role, label, `umb-property[data-mark=...]`, shadow host)
   - the **exact** validation and status messages: save an empty or invalid form and read them (inline and toast)
   - where an error appears (next to the field, toast, dialog), and when (as you type, or on Save)
   - the server calls behind save / publish / delete, so the tests can wait for them and not for time
   - what the public portal shows afterwards, and how long it takes to show it
   - real limits (lengths, file sizes, file types), by trying them, not by reading the story
   - Umbraco specifics: fields are `umb-property[data-mark="property:<alias>"]`; form tabs are role=tab; buttons "Save",
     "Save and publish" and the dialogs they open ("Save and close", "Save and publish", "Unpublish", "Trash", "Delete",
     "Restore"); pickers open in `umb-tree-picker-modal` / `uui-modal-sidebar`; row actions are the "Open actions menu"
     button and `uui-menu-item[label=...]` entries; the Recycle Bin lives in the content tree
   - language variants: the default language and the one the test uses, and what each dialog preselects
5. Write the findings into the code's own places: locators in the page object, messages and limits in
   `test-data/<area>/<page>.data.ts`. Note any place where the build differs from the sheet. That difference is a
   likely bug, and goes in the hand-over.

**Gate:** every locator the cases need has been seen on the live page. Nothing is guessed.

## Phase 3 - Write the tests

6. Reuse what exists (page objects, components, fixtures, API clients) and extend it. A new screen gets a page object.
   A control used on several screens gets a component.
7. Every case follows one shape:
   - **preparation** (creating an article, uploading, and - in a case about one missing or invalid field - filling every
     other required field) in `asSetup(...)`. It is retried
     with panel recovery, and if it still cannot be done the case shows **blocked**, not failed.
   - **one clear check** that is what the `Then` sentence says, with the message matched leniently (regex of the real wording)
   - **only its own data**, named `auto-test-...`, and removed afterwards
8. Do not retry or loosen the checks themselves: a retried check hides a real bug.
   Guard ids read from the address after a save (never take the parent node's id by mistake).

**Gate:** `npm run check` and `npm run test:unit` pass. `tests/unit/story-sheets.test.ts` proves the spec still says exactly
what the sheet says (same cases, order, priority, Given / When / Then).

## Phase 4 - Prove it before hand-over

9. Run one case of each kind (one per code path, and every case expected to fail) in Claude's own runs. Then the user
   queues the whole page on the dashboard - on their machine it is several times faster - and Claude reads that run
   with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/scripts/dashboard/print-results.ts <STORY> --failed` (it reads `test-output/dashboard/state.json` of the project folder), and
   triages it below. The failures are run again on their own.
10. Triage **every** failure:

    | Outcome | Action |
    |---|---|
    | Test fault (locator, timing, misread case) | fix the test, run the case again |
    | Passes on the second run only | find what was slow or shared and make it wait for the right thing. Never add a sleep. |
    | Real bug | reproduce it by hand in Chrome, keep the screenshot, check the bug report says it clearly |
    | Blocked | make sure the reason says what access is missing |

11. Check that no `auto-test-` data is left in the back office, its Recycle Bin, or Media.

**Gate:** every remaining failure has been reproduced by hand.

### Keeping the checks fast (without weakening them)
- Open a page by its address; go through the navigation bar only in the cases that are about the navigation.
- Read what "the CMS has configured" once per worker (the real pages do not change during a run); a case's own copy has its
  own id.
- A case that needs content the real page does not have works on its **own copy** of the page (`cmsApi.createCopy`,
  named auto-test-..., removed after) - never on the real page.
- In verification runs, run one case per code path (cases that differ only in data share it) and every case whose
  verdict is a failure; the full set runs from the dashboard.

## Phase 5 - Hand-over

12a. Add what the story taught to app-knowledge.md (a limit, a message, a quirk), so the next story starts from it.

12. Make sure the work is in the person's project folder (and nothing newer of a teammate's was overwritten), run the
    checks of CLAUDE.md, then send one table: passed / confirmed bugs (one line each, with what the system does
    instead) / not applicable (proposed, with reasons) / blocked (what access would unblock them), and anything the user
    has to do before running (restart the dashboard, sign in, VPN) - and that the work goes to the team with
    **↑ Share my work**.
