# ECS.Automation

Automated tests for the ECS website, written with Playwright and TypeScript:

- the **public portal** - its address is `PORTAL_BASE_URL` in `.env` (no sign-in)
- the **back office** - Umbraco at `/umbraco/`, Content section only (needs the VPN)

You run the tests, read the results and download the reports from a **dashboard** in your browser. The same dashboard
also creates a **user guide** of the back office as a Word file.

**No VS Code and no terminal needed.** Everything is done with two files you double-click in the project folder -
**Setup.cmd** once, **Start dashboard.cmd** every day - and the dashboard's buttons (run, add a user story, get the team's
latest, share your work). The commands in [section 4](#4-commands) are there for whoever prefers a terminal.

---

## 1. Set up (once)

1. Install **Node.js LTS** (22.18 or newer), **Git for Windows** (git-scm.com, default options) and **Google Chrome**.
   Connect to the **VPN**.
2. Get the project - the team's copy is on GitHub (ask to be invited to it first). In a terminal, in the folder where it
   should go:

   ```
   git clone https://github.com/Abdullah2O7/ECS-Automation.git
   ```

   The first time, a GitHub window asks you to sign in. (This is the only command ever needed. Without a terminal:
   GitHub Desktop > File > Clone repository does the same.)
3. In the project folder, double-click **Setup.cmd**. It installs what the tests need (a few minutes) and creates your
   `.env`, opening it in Notepad: fill in **your own** back-office account (see [section 7](#7-env)) - everyone on the
   team uses their own, because two people on one account sign each other out mid-run. Save, close Notepad, and let it
   start the dashboard. Fill in `PORTAL_BASE_URL` and `CMS_BASE_URL` too (the ECS addresses). Setup.cmd can be run again at any time.

> PowerShell says *"running scripts is disabled"*? Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`
> once and open a new terminal (or type `npm.cmd` instead of `npm`).

## 2. Run the tests: the dashboard

```
npm run dashboard
```

Or, without a terminal: double-click **`Start dashboard.cmd`** in the project folder (for a desktop icon: right-click
it > Show more options > Send to > Desktop). Either way it gets the team's latest first, then opens
**http://localhost:4400**. Leave its window open; closing it (or `Ctrl + C`) stops the dashboard. When a teammate updated
the dashboard, a **↻ Restart the dashboard** button appears on it (with Start dashboard.cmd it restarts by itself).

| On the dashboard | What it does |
|---|---|
| **↓ Get latest** / **↑ Share my work** (top right) | the team's copy on GitHub: take what your teammates shared, send what you changed - see [section 11](#11-working-as-a-team) |
| **All pages** | one card per user story: its pass rate, its counts and a **Run** button; the latest runs below |
| "N cases not built yet" (yellow, on a card) | a teammate shared a new story before its cases were written: ask Claude to build them (section 5) |
| a page in the sidebar | its test cases. Filter (Failed, Blocked ...), search, open a row for the error and the screenshot |
| **Run all / Re-run failed / Run selected** | runs the page, only its failures, or the cases you ticked |
| tick boxes in the sidebar → **Run in order** | runs several pages one after another, in the order you ticked them (**Select all** ticks a group) |
| **All priorities / P1 / P2 / P3…** | runs and shows only the cases of the priorities you pick (pick more than one to combine them). It applies to the Run buttons of a page, the page cards and **Run in order**; a ticked page with no case of those priorities is left out. The choice is remembered |
| **＋ Queue** | while a run is going, every Run button adds to the queue instead; the run banner shows **Up next** (× takes one out) |
| **Show browser** | on: watch Chrome while it runs; off: it runs in the background |
| time left | the run banner says about how long the page and the whole queue still need (from the last runs) |
| **New failure** / **Fixed** | marks on a case whose result changed since the run before; **Changed since last run** shows only those |
| when it ends | a message on the page and in the tab title, and a desktop notification if you allowed it |
| **Run them** / **Forget them** | runs that were waiting when the dashboard was closed are offered again - never started by themselves |
| **Stop** / **Skip to next** / **Stop all** | Stop lets the running case finish and skips the rest (**Stop now** ends at once). With pages queued: **Skip to next** ends this page and goes on, **Stop all** also empties the queue |
| **⬇ Bug report** | the Word bug report of the page's last run |
| **Mark not applicable** | skips the ticked cases from now on, with your reason (left out of the pass rate) |
| **Your verdict** (next to each case) | what the case should give - **Should pass**, **Should fail** (a real bug), **Should be blocked** or **Not applicable** - and why ("the maximum is now 200"). Claude updates the test before the next run; the case then shows what Claude changed and the list is empty again, ready for your next verdict. Not applicable skips the case at once |
| **User guide** | creates the back-office user guide (see section 3) |

What a result means:

| Result | Meaning |
|---|---|
| **Passed** | the application does what the sheet says |
| **Failed** | the application differs from the sheet - a bug, or a difference the team has to decide on. A **Hint** line says what the application does instead |
| **Blocked** | the case could not reach its check (no mailbox, no access, the back office did not answer). The reason is shown |
| **Not applicable** | skipped on purpose, with the reason |

A case whose steps do not go through (a slow server) is tried **3 times**, then blocked with what happened. A case that found a
bug is not run again - its result stands.

## 3. Create the user guide

Open **User guide** in the dashboard's sidebar, choose **Arabic** (right to left) or **English**, and press
**Create user guide**. After a few minutes **⬇ Download** gives you the Word file.

The guide covers the **whole content tree** of the back office, made live with the CMS account: signing in, the Content
section, the home page, then **one chapter per section** in the tree's order - its fields, and for a list (News, categories,
partners ...) how to open it, add an item, edit an item, the other actions on an item (Unpublish, Trash, Rollback ...) and
change the order of the items - and finally saving and publishing. Every step is numbered on a screenshot. It only
looks - nothing is saved, published or deleted - and it is not created while a test run is in progress (both use the same
account). From the terminal: `npm run guide` (Arabic) or `npm run guide:en`; the file goes to `test-output/user-guide/`.

## 4. Commands

You need two - everything else is a button on the dashboard:

| Command | What it does |
|---|---|
| `npm run dashboard` | opens the dashboard: run the tests, read the results, download the reports and the user guide |
| `npm run story:new` | adds the new Excel sheets of `docs/test-cases/` as pages (see section 5) |

<details>
<summary>Other commands (for developers - not needed day to day)</summary>

| Command | What it does |
|---|---|
| `npx playwright test --project=news` | run one page from the terminal (its folder name under `tests/pages`) |
| `npx playwright test --project=news -g "PTL-07-16"` | run one test case from the terminal |
| `npm test` / `npm run test:headed` | run everything, then build the Allure report |
| `npm run test:unit` | fast checks of the helper code - and that every spec still matches its Excel sheet |
| `npm run check` | type check + lint, after changing code |
| `npm run story:check` | every sheet in `docs/test-cases` has its tests; lists the cases not built yet |
| `npm run guide` / `npm run guide:en` | the user guide from the terminal, Arabic / English |
| `npm run report` / `npm run report:open` | build / open the Allure report |
| `npm run clean` / `npm run clean:runtime` | clear old reports / the hand-off state between dependent tests |
| `npm run sql` / `npm run sql:dry` | run a SQL script against the database (see `src/scripts/sql/README.md`) |

</details>

## 5. Add a user story

When you get a new test-case sheet:

1. **Get the latest.** Open the dashboard - it gets the team's newest copy by itself as it starts.
2. **Add the sheet.** On the dashboard, press **＋ Add user story** (top right) and choose the Excel file. If its name does
   not start with the story's id (`PTL-94 - Events.xlsx`), type the id in the box next to it. Press **Add**: the sheet is
   saved in `docs/test-cases/`, the story's page is created with every scenario of the sheet, word for word, and it shows
   on the dashboard with its cases not built yet. Cases that need a server error start as not applicable, with the reason.
   (Terminal way: copy the file into `docs/test-cases/` and run `npm run story:new`.) A new version of a sheet whose story
   is already there is refused here: give it to Claude, which updates the story's cases.
3. **Tell Claude.** "I added the sheet X to test-cases" (or attach the Excel file in the chat). Claude follows
   [docs/NEW_USER_STORY.md](docs/NEW_USER_STORY.md): reads and classifies the cases, checks the live pages, writes the
   tests, runs them and sorts out every failure **before** you run them. It then says what passes, what fails because of
   a real bug, and what is not applicable and why.
4. **Run it yourself.** On the dashboard, open the new page and press **Run** (or pick a priority first). Disagree with a
   result? Give **Your verdict** on that case with a reason; Claude updates the test, and the verdict list resets once
   it is done.
5. **Share it.** When you are happy, press **↑ Share my work**, write one line ("Added the CMS-12 cases") and press
   **Share**. It runs the checks (about a minute) and sends it to GitHub; your teammates get it with **↓ Get latest**.
   Sharing is always yours to do - Claude never shares for you.

**No Claude?** Do steps 1, 2 and 5: add the story with **＋ Add user story**, and share. (A sheet put in `docs/test-cases`
by hand without its page is refused when you share.) The story shows on everyone's dashboard with "N cases not built yet"; a teammate who works with
Claude gets it with **Get latest**, tells Claude "build the new cases", runs them and shares.

You can also skip step 2 and only give Claude the sheet: it does that step for you.

A spec keeps each scenario exactly as the sheet has it, and the code under it does what each Given / When / Then says:

```ts
test(...scenario('PTL-07-02', `
  @Priority=1
  Scenario: Verify that the Latest News banner displays exactly the 5 most recent published articles
  Given There are published news articles in the system
  When The user visits the News listing page
  Then The Latest News banner displays the 5 most recently published articles
`), async ({ newsListPage, newsApi }) => {
  const published = await given(() => newsApi.readPage(1, 6));
  await when(() => newsListPage.open());
  await then(() => newsListPage.expectBannerIsLatest(published.items, 5));
});
```

`npm run test:unit` fails when a spec no longer matches its sheet (a dropped case, an edited expected result).

## 6. Where things live

```
ECS.Automation/
├── CLAUDE.md               what every teammate's Claude reads first: the rules, the process, where things are
├── Start dashboard.cmd     double-click to open the dashboard (the same as npm run dashboard)
├── Setup.cmd               double-click once on a new computer: installs what is needed, creates .env
├── .github/workflows/      the checks GitHub runs on every share
├── tests/
│   ├── pages/<page>/       one folder per user story: the spec, page.json, not-applicable.json, review.json
│   └── unit/               fast checks without a browser
├── src/
│   ├── pages/portal/       page objects of the public portal (one per page under test)
│   ├── pages/cms/          page objects of the back office forms and lists
│   ├── components/         controls shared by several pages (the portal's navigation bar)
│   ├── api/                the back office's and the portal's own data, to compare with the screen
│   ├── domain/             business rules as plain functions (no browser)
│   ├── fixtures/           what a test receives: guest pages, the signed-in back office, the test data it may create
│   ├── config/             portals, accounts, timeouts, how pages are found
│   ├── reporters/          the Word bug report
│   ├── utils/              generic helpers: actions, assertions, waits, text, logger, run memory
│   └── scripts/            tools: dashboard, story (new, check), team (Get latest, Share my work, setup),
│                           user-guide, sql, and the back-office tools Claude uses
├── test-data/              fixed inputs and expected messages per area (*.data.ts)
├── docs/                   the Excel sheets, how a story is added, what the application really does, accepted differences
├── runtime/                hand-off state between dependent tests (not committed)
└── test-output/            everything generated: reports, screenshots, logs, bug reports, user guides (not committed)
```

Useful documents: [CLAUDE.md](CLAUDE.md) (the rules every Claude follows), [NEW_USER_STORY.md](docs/NEW_USER_STORY.md)
(how a story is built), [app-knowledge.md](docs/app-knowledge.md) (what the portal and the back office really do),
[accepted-differences.md](docs/accepted-differences.md) (differences from the sheets the team accepted).

## 7. `.env`

| Variable | Used for |
|---|---|
| `PORTAL_BASE_URL` | the public portal (already set) |
| `CMS_BASE_URL`, `CMS_CONTENT_USERNAME`, `CMS_CONTENT_PASSWORD` | the back office cases and the user guide |
| `CMS_SECOND_USERNAME`, `CMS_SECOND_PASSWORD` | optional: a second account for Claude's own checks, so they never sign your runs out |
| `HEADLESS=true` | no browser window when running from the terminal |
| `DASHBOARD_BROWSER` | optional: the browser the dashboard opens in - `brave`, `chrome`, `edge`, `firefox` or the full path of its .exe (empty: your default browser) |
| `ENVIRONMENT` | a label shown in the reports |
| `API_BASE_URL`, `DB_*` | only for runs that call a separate backend or the database |
| `KEEP_SIGN_IN_FILE` | only for Claude's one-at-a-time checks: keeps the sign-in between runs (a file outside the project) |

Passwords go in your local `.env` only - never in chat, code or the repository. A missing value stops the run with
`MISSING_ENVIRONMENT_CONFIGURATION:<NAME>`.

## 8. Reports and output

| What | Where |
|---|---|
| Bug report (Word), one per user story with a failed case | `test-output/bug-reports/` - or **⬇ Bug report** on the dashboard |
| User guide (Word) | `test-output/user-guide/` - or **⬇ Download** on the dashboard |
| Playwright HTML report | **Playwright report** on the dashboard (`test-output/reports/Playwright-Report`) |
| Allure report | `npm run report`, then `npm run report:open` |
| Screenshots, traces, videos | `test-output/dashboard/results/<page>/` (terminal runs: `test-output/reports/test-results/`) |
| Log | `test-output/logs/logs.log` |

The bug report has a page per bug: the case, its severity, what the sheet expects, what the system did, the steps and a
screenshot with the problem framed. Cases that could not reach their check are listed apart - they are not confirmed bugs.

## 9. Rules of this project

- **A spec tells the story**: prepare, open, act, check. Clicks and locators live in page objects; generic helpers know
  nothing about ECS.
- **Locators by role, label or text first**; wait for states, never fixed sleeps (`waitForTimeout` fails lint).
- **No addresses or passwords in code** - they come from `.env`.
- **The tests only remove what they create.** Everything a test creates in the back office is named `auto-test-...` and
  deleted when the case ends, pass or fail. Real content is only read; a case that needs to change a page works on its own
  copy. Leftovers of an interrupted run are removed by the next run.
- **Back office content is written in Arabic**, its default and required language.
- After a change: `npm run check`, `npm run test:unit`, then run the page you changed.

## 10. Problems

| You see | Do this |
|---|---|
| `node` / `npm` not recognised | install Node.js LTS, then reopen the terminal |
| every test fails in a second with `ffmpeg ... doesn't exist` | `npx playwright install ffmpeg` |
| back office cases blocked with "check the VPN" | connect the VPN and run again |
| `Cannot find package 'docx'` | `npm ci` (the user guide needs it) |
| `MISSING_ENVIRONMENT_CONFIGURATION:<NAME>` | fill that value in `.env` |
| "port 4400 is already in use" | close the other dashboard, or `set DASHBOARD_PORT=5000` then `npm run dashboard` |
| a new page is not on the dashboard | press **Reload tests** |
| "Your work was not shared" - a check failed | ask Claude to fix what the message names, then share again |
| "...changes the same lines as a teammate's work" | your work is safe on your computer; ask Claude to combine it, then share again |

## 11. Working as a team

The team's copy of the project is on GitHub: **https://github.com/Abdullah2O7/ECS-Automation** (private). Everyone works
in their own copy on their own computer and **shares their own work**. You never need git commands - the dashboard does it:

| Button (top right) | When | What it does |
|---|---|---|
| **↓ Get latest (n)** | your teammates shared something since the dashboard started | takes their new tests and changes. It never touches work you have not shared |
| **↑ Share my work (n)** | you (or Claude, for you) changed something | checks the code, combines it with the team's latest work, and sends it to GitHub with a line saying what you changed |
| ✓ Up to date with the team | nothing to take or send | - |

**A day of work**

1. Open the dashboard (`npm run dashboard`). **It gets the latest by itself as it starts** - the terminal says
   "Got N changed files from your teammates" or "You are up to date with the team".
2. Run the cases you want - your runs, results and reports are yours alone; nobody else sees or disturbs them.
3. New test sheet? Give it to Claude, as before. When Claude has added the cases, press **Share my work**: from then on
   every teammate gets them with **Get latest**.
4. Your verdicts and "not applicable" marks: Claude acts on your verdicts and you share the result. Not applicable marks
   are part of your work, so they reach the team when you share.

**What is shared, and what is never shared**

| Shared (on GitHub) | Only on your computer |
|---|---|
| the tests, page objects, test data, test-case sheets, docs | your `.env` - your own back-office account and password |
| the not-applicable decisions | your runs, results, screenshots and reports (`test-output/`) |
| | your verdicts (`review.json`) - requests to Claude |

**Safety**

- Before anything is sent, the same checks run as on GitHub (every sheet has its tests, type check, lint, unit tests,
  every test found). If one fails, nothing is sent.
- **A new sheet goes with its tests.** A sheet in `docs/test-cases` whose `npm run story:new` was not run stops the share
  and says which. Its cases do not have to be built yet: the story appears on everyone's dashboard with "N cases not
  built yet", and a teammate who works with Claude asks Claude to build them, then shares. `npm run story:check` lists
  both.
- Nothing private is ever sent: `.env` and keys are refused, and a share stops if your changes contain any user name or
  password from your `.env`.
- If you and a teammate changed the same lines, the share stops and **your work stays safe on your computer** - ask
  Claude to combine the two, then share again.
- **You always run the newest tests.** The dashboard gets the latest when it starts. And when you press Run and a
  teammate has shared something since, it asks first: **Get latest and run**, or **Run anyway** (to test your own
  unshared change, say). If it cannot get the latest - you have unshared changes in the same files, or GitHub cannot be
  reached - it says why and starts with what is on your computer.
- Get latest and Share wait while a test run is going on.
- Each person uses **their own back-office account** in `.env`: two people on one account sign each other out.

**Working with Claude**

Each person uses their own Claude account; chats and Claude's memory are not shared between accounts. What every Claude
needs is in the project itself: [CLAUDE.md](CLAUDE.md) (read first, automatically) and the files it points to
(docs/NEW_USER_STORY.md, app-knowledge.md, accepted-differences.md). Give Claude access to **your own copy** of the
project folder (in the desktop app, connect the folder) and start the chat with the message in
[docs/CLAUDE_START_PROMPT.md](docs/CLAUDE_START_PROMPT.md) - copy it as it is. When Claude learns something new
about the applications or the team agrees on a difference, it writes it into those files - share it, and every
teammate's Claude knows it after **Get latest**.

**First upload (done once, by the owner of the repository)**

```
npm run team:setup -- https://github.com/Abdullah2O7/ECS-Automation
```

The repository must be new: empty, or with only the README, licence or .gitignore GitHub offered to create (the project goes on top of them). It asks your name and e-mail, runs the checks and uploads the project. Then invite your
teammates on GitHub (**Settings → Collaborators**); they start at [section 1](#1-set-up-once).
