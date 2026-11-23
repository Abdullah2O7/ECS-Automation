# First message to Claude

Copy everything below the line into a new Claude chat, after giving Claude access to **your own copy** of the project
folder (in the Claude desktop app: connect the folder). Use it again whenever you start a new chat about the project.

---

I work on **ECS.Automation**, our team's Playwright + TypeScript tests for the ECS website (public portal and the
Umbraco back office). My copy of the project is in the folder I connected. Our team shares it through GitHub, each with
their own Claude account, so you have no history with me: the project files are our shared memory.

**Before anything else:**
1. Read `CLAUDE.md` in the project folder, then every file it lists under "Read before any work":
   `docs/NEW_USER_STORY.md`, `docs/app-knowledge.md`, `docs/accepted-differences.md`, `docs/cms-model.md`,
   `docs/cms-rules.md` and `README.md`. Follow them exactly - they are the team's decisions and what we know about the
   system.
2. Check where my copy stands:
   - `git status` and `git fetch` - tell me if I should press **Get latest** or **Share my work** on the dashboard first
   - `npm run story:check` - any story a teammate shared with cases not built yet
   - `tests/pages/*/review.json` - any of my verdicts without `"done"`
3. Then tell me in a few lines what you will follow and what is waiting, and wait for my request.

**When I give you a user story (an Excel sheet of test cases):**
1. Make sure my copy is up to date first (Get latest, as above), and that no teammate already shared this story.
2. The sheet goes in `docs/test-cases/` of my project folder, its name starting with the story's id
   (`PTL-94 - Events.xlsx`). If I attached it here, copy it there; if its name has no id, ask me for it and rename it.
3. A new story: run `npm run story:new` for it, then build every case by `docs/NEW_USER_STORY.md`, phase by phase -
   read the sheet, check every screen, field and message on the live site first, write the tests, run them with your own
   account and fix anything the test itself got wrong. A new version of a story that already has tests: follow
   "A changed sheet" in that guide - update the cases in place and tell me what changed.
4. Write the code straight into my project folder (the one I open in VS Code), so I see it there, and keep the team's
   conventions: page objects in `src/pages`, data in `test-data`, the case text exactly as the sheet has it.
5. Add what you learned about the system to the docs, run the checks, and finish with a short table: what passes, what
   fails and why (each failure says what the site does instead), what is blocked or not applicable. Then tell me to run
   the page on the dashboard and to press **Share my work**, so the whole team gets it.

**How I work with you:**
- Speak to me in plain words. I use the dashboard and `npm run story:new`; the tools and checks are yours to run.
- Never type, print or ask for my passwords. I sign in to the back office myself, in my own browser tab, when you need it.
- Never commit or push. I share my work myself with **Share my work** on the dashboard; tell me when something is ready.
- My runs use my own back-office account from `.env`. For your own checks use the second account (`CMS_ACCOUNT=CMS_SECOND`)
  if my `.env` has one; if not, run only when I am not running.
- Test only the Content section of the back office. Tests may create data only named `auto-test-...` and must delete
  exactly what they created - nothing else. Never confirm Trash, Delete, Unpublish or Publish on real content.
- When I give a verdict, turn my reason into the test and check it against the live system - do not just follow it.
- When you learn something new about the system or we agree on a difference, write it into the docs (as CLAUDE.md says),
  so every teammate's Claude knows it after they press **Get latest**.
