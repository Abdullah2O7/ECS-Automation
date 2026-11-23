# ECS.Automation - read this first

You are helping a QA team member with the automated tests of the **ECS** website. Several people share this project
through GitHub (https://github.com/Abdullah2O7/ECS-Automation), each with their own Claude
account. Nothing you learned in another chat reaches this one: **everything Claude needs is in this project's files**, and
every Claude on the team reads the same ones. Keep them current (see "Keep the team's Claude in sync" below).

This project was started on 2026-11-23 as a copy of the Hawar.Automation framework (same dashboard, story tools, sign-in
and Umbraco helpers), without Hawar's stories, page objects or knowledge. Nothing about ECS has been checked live yet.

- Public portal: address to fill in (`PORTAL_BASE_URL` in `.env`) - stories `PTL-*`
- Back office: Umbraco at `<address>/umbraco/` (`CMS_BASE_URL` in `.env`), **Content section only** - stories `CMS-*`
  (a story called "Manage ..." is a back-office story). VPN: to confirm.
- Playwright + TypeScript. Tests are run by the person from a **dashboard** (http://localhost:4400), started by
  double-clicking `Start dashboard.cmd` (or `npm run dashboard`); `Setup.cmd` sets up a new computer. People need no VS
  Code or terminal: the dashboard adds a story (**＋ Add user story** saves the sheet and runs story:new -
  `src/scripts/story/story-upload.ts`), runs, shares and restarts itself after a teammate's update.

## Read before any work

| File | What it gives you |
|---|---|
| [docs/NEW_USER_STORY.md](docs/NEW_USER_STORY.md) | **The process** for a new story (sheet → live audit → tests → proof → hand-over), verdicts, team rules |
| [docs/app-knowledge.md](docs/app-knowledge.md) | What the back office and the portal really do: sign-in, forms, limits, messages, quirks |
| [docs/accepted-differences.md](docs/accepted-differences.md) | The team's decisions: what is not applicable, accepted wording, every verdict turned into a rule |
| docs/cms-model.md, docs/cms-rules.md | Every back-office page type with its fields, and what the server really refuses (with the messages). **Not written yet:** run the cms-model and cms-probe tools (docs/NEW_USER_STORY.md) once the ECS back office is reachable |
| [README.md](README.md) | What the person sees and does: setup, dashboard, adding a story, working as a team |
| [docs/CLAUDE_START_PROMPT.md](docs/CLAUDE_START_PROMPT.md) | The first message teammates give you: what they expect at the start of a chat |
| `tests/pages/*/review.json` | The person's verdicts waiting for you (local to their computer) |

Then run `npm run story:check`: it lists stories a teammate shared with cases **not built yet** - build them with
docs/NEW_USER_STORY.md when the person asks to "check" or "build the new cases".

## Rules that are never broken

**Safety**
- Never type, print, log or commit a password, token or anything from `.env`. Back-office sign-in in a browser is done
  **by the person**, in their own browser tab. `.env` stays on their computer.
- Each person uses **their own** back-office account (`CMS_CONTENT_*` in their `.env`). One account can be signed in from
  one place only: a second sign-in signs the first out. Your own verification runs use a second account
  (`CMS_ACCOUNT=CMS_SECOND`) when the person's `.env` has one; without it, run only while the person is not running.
- Test only the **Content** section of the back office.
- Tests may create data but must remove it: everything a test creates is named `auto-test-...`, tracked and deleted when
  the case ends - **only what the tests created, nothing else**. A case that needs to change a real page works on its
  own copy (`cmsApi.createCopy`). In a live audit, open dialogs and cancel them; never confirm Trash / Delete / Unpublish
  / Publish on existing content.

**Standing rules for every story** (details in accepted-differences.md)
- A case that needs a server error (HTTP 500) is **not applicable**; so is one that checks a specific HTTP status code,
  unless the person's verdict says otherwise.
- A step that does not go through (or a slow server) is tried 3 times; then the case is **blocked** with the reason.
- Wording that differs from the sheet but means the same is accepted: match messages leniently (regex of the real text).
- The box at the top of an Umbraco form is the **node name**; a sheet's "Title" / "Name" is the form's own field.
- *To confirm on ECS* (true on the Hawar back office, the same Umbraco): Arabic (ar-EG) is the default and required
  language, so tests write in Arabic (`CONTENT_CULTURE` in `src/pages/cms/umbraco-ui.ts`); pictures are compressed and
  kept when ≤ 512 KB after compression (`src/domain/picture-rule.ts`). Check both in the first live audit and write the
  answer into docs/app-knowledge.md and here.

**Team and GitHub**
- Work in the person's own project folder **as it is now** - never copy an older file over a newer one.
- **Never commit or push.** Everyone shares their own work with the dashboard's **↑ Share my work** (it runs the checks,
  combines with the team's work and pushes). When your work is done, say it is ready to share. Teammates' work arrives
  with **↓ Get latest**; suggest it before starting. `npm run dashboard` gets the latest by itself first
  (`predashboard` → `src/scripts/team/latest-on-start.ts`), and a Run asks "Get latest and run / Run anyway" when the
  team shared something newer (`teamFirst` in the dashboard server).
- A share that stopped because the same lines changed on both sides keeps the person's work as a local commit. Combine it:
  `git rebase origin/main`, resolve the named files keeping both sides' intent, run the checks; the person shares again.
- `review.json` (verdicts) is local to the person; `not-applicable.json` and everything else in the project is shared.
- A new sheet is only shared together with its `npm run story:new` skeleton; its cases may still be "Not automated yet".
- **Story ids:** a sheet's file name starts with the story's real id (`PTL-94 - Events.xlsx`, `CR-02 - ...`). When it does
  not, ask the person for the id and rename the sheet before `npm run story:new`: the stand-in ids it gives otherwise
  (90 and up) can collide when two teammates add stories on the same day.
- **One story, one builder:** before building, `git fetch` and check that no teammate already shared that story
  (`git log origin/main --oneline -- docs/test-cases tests/pages`). If one did, tell the person and work from theirs.
- **A changed sheet (V2) of an existing story:** replace the old sheet in `docs/test-cases` (one sheet per story), paste the
  new scenario texts into the spec, keeping the case ids, and rebuild the cases whose text changed - see "A changed sheet"
  in docs/NEW_USER_STORY.md.

## Stories on hold

- None yet. A story whose cases would change live content that cannot be copied (the Home page, say) waits here until
  the team decides how to test it; ask the person before writing any of its cases.

## Verdicts from the dashboard

`tests/pages/<page>/review.json`: what a case **should** give (`expected`: passed / failed / blocked) and why (`note`).
For each entry without `done`: translate the reason into the test - its data (`test-data/...`), its check or its hint -
and **verify it against the live system** (do not follow a verdict blindly: if the system disagrees, the case fails with a
hint saying so). A changed requirement that is a team decision also goes into accepted-differences.md. Run the case, then
write `"done": { "at": "<ISO time>", "note": "<what you changed>" }` - the dashboard then shows the note and empties the
verdict list for the next one.

## Before you hand over

```
npm run check        # type check (incl. the scripts that run in Node) + lint
npm run test:unit    # unit tests, incl. "every spec matches its sheet"
npm run story:check  # every sheet has its tests
npx playwright test --list
```

Run the cases you wrote (one per code path, and every expected failure) with your own account; then the person runs the
page from the dashboard. Hand over in plain words: what passed, the real bugs (what the system does instead), what is not
applicable and why, what is blocked and what would unblock it, and what the person must do (restart the dashboard, share).

## Where things live

```
tests/pages/<page>/       one folder per user story: <STORY>-*.spec.ts, page.json, not-applicable.json, review.json (local)
tests/unit/               browserless unit tests (npm run test:unit)
src/pages/cms|portal/     page objects (back office / portal);   src/components/  controls used on several pages
src/api/                  API clients (back office management API)
src/fixtures/             Playwright fixtures: sign-in (session.ts), back office (cms.fixture.ts), portal (portal.fixture.ts)
src/domain/               pure rules (picture rule, standing rules, related articles...) - no Playwright
src/utils/                generic helpers (actions, assertions, text, files, logger, runtime)
src/scripts/dashboard/    the dashboard (server + ui/index.html; runs straight in Node - no TypeScript-only syntax)
src/scripts/team/         Get latest / Share my work / team:setup
src/scripts/story/        story:new, story:check, the sheet reader
src/scripts/cms-tools/    YOUR tools (not for the person): cms-model, cms-probe, cms-cleanup - see NEW_USER_STORY.md
test-data/                static inputs and expected values (limits, messages) per area
docs/test-cases/          the Excel sheets, one per story
```

## Keep the team's Claude in sync

What you learn must land in the files, or the next Claude (on another account) repeats the mistake:
- a fact about the applications (a limit, a message, a quirk) → docs/app-knowledge.md
- a team decision or an accepted verdict → docs/accepted-differences.md
- a change to how the work is done → docs/NEW_USER_STORY.md (and this file when it is a rule)
- something the person does differently → README.md

The person keeps things simple: they use the dashboard and two commands (`npm run dashboard`, `npm run story:new`).
Tools and checks are yours to run; do not ask them to learn more commands. Speak to them in plain words.
