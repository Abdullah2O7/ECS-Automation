# What the ECS applications really do

Read before writing the tests of a new user story; add to it whenever a run or a check shows something new. Each line was
seen on the live system. When a sheet says something different, the sheet is checked and the case fails with a hint,
unless the difference is in [accepted-differences.md](accepted-differences.md).

> **New project.** Nothing below has been checked on the live ECS system yet. The first story's live audit fills this in:
> the addresses, how sign-in works, the forms, their limits and messages. Lines marked *(to confirm)* come from the
> Hawar project, which is built on the same Umbraco back office, and hold only once seen on ECS.

## Back office (Umbraco, address: to fill in - `CMS_BASE_URL` in `.env`)

### Signing in and sessions
- *(to confirm)* One account can be signed in from one place at a time: a second sign-in with the same account signs the
  first one out. The dashboard uses `CMS_CONTENT`; Claude's own checks use `CMS_SECOND` (`CMS_ACCOUNT=CMS_SECOND`).
- *(to confirm)* After the password, Umbraco goes through `/umbraco/oauth_complete?code=…`; when it hangs, opening
  `/umbraco/` again finishes the sign-in (done automatically).
- *(to confirm)* Whether the back office needs the VPN.
- *(to confirm)* Whether accounts come from Active Directory (story CMS_03.1 "Active Directory User Sync Authentication").

### Forms
- *(to confirm)* The box at the top ("Enter a name...") is the **node name**, not a title. A sheet's "Title" / "Name" is
  the form's own field further down.
- *(to confirm)* The default and mandatory language, and so the language the tests write in.
- *(to confirm)* Validation happens when saving: inline messages under the field and red pop-ups that close by themselves.
- Checkboxes and switches (`uui-checkbox`, `uui-toggle`) hide the real input: click the component itself.
- Dialogs open inside `uui-modal-dialog`; side panels (pickers) inside `uui-modal-sidebar`.

### Content model
- Run the cms-model tool once the back office is reachable: it writes every page type with its fields to
  `docs/cms-model.md`; the cms-probe tool writes what the server really refuses to `docs/cms-rules.md`.

## Public portal (address: to fill in - `PORTAL_BASE_URL` in `.env`)
- *(to confirm)* The site's languages and their paths, and whether a visitor signs in.

## Test data rules
- Everything a test creates is named `auto-test-<run>-<label>-<n>` and removed when the case ends, pass or fail - and
  only that. Leftovers of an interrupted run (older than 90 min) are removed at the start of the next run (under Home;
  add other lists to `leftoverParents` in src/fixtures/cms.fixture.ts).
- Setup is made through the back office's own API: faster and steadier than the screens. The screens are used for what
  the case checks.
