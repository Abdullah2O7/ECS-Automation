import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import { NOT_APPLICABLE_FILE, PAGES_FOLDER } from '../../config/test-pages.ts';
import { EXPECTED_RESULTS, REVIEW_FILE } from '../../config/reviews.ts';
import { Runner } from './runner.ts';
import { GuideJob } from './guide-job.ts';
import { TeamJob } from './team-job.ts';
import { casesOfPriorities, parsePriorities, priorityScope } from './priorities.ts';
import { MAX_SHEET_BYTES, saveSheet, startStory, UploadError } from '../story/story-upload.ts';
import { browserCommand, chosenBrowser } from './browser.ts';

/**
 * The test dashboard: a local web page that lists the pages under test, shows how their test cases went (passed,
 * failed, blocked with the reason) and runs them on a click - one page, or several one after another (the queue).
 *
 *   npm run dashboard                 opens http://127.0.0.1:4400
 *   npm run dashboard -- --no-open    does not open the browser
 *   DASHBOARD_PORT=5000 npm run dashboard
 *
 * It only listens on this machine, and only answers requests that really come from it.
 */
const PORT = Number(process.env.DASHBOARD_PORT) || 4400;
const HOST = '127.0.0.1';
const UI_DIR = path.resolve('src/scripts/dashboard/ui');
const OUTPUT_DIR = path.resolve('test-output');
const HTML_REPORT_DIR = path.resolve('test-output/reports/Playwright-Report');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

const runner = new Runner();
const guide = new GuideJob();
const team = new TeamJob();

/**
 * Started by "Start dashboard.cmd": it starts the dashboard again when it ends with RESTART (and installs the packages
 * first with RESTART_AFTER_INSTALL), so a teammate's new version can be taken without a terminal.
 */
const LAUNCHER = process.env.DASHBOARD_LAUNCHER === '1';
const RESTART = 75;
const RESTART_AFTER_INSTALL = 76;

/** What the page shows: the runs, the user guide and where this copy stands against the team's on GitHub. */
const snapshot = () => ({ ...runner.snapshot(), guide: guide.snapshot(), team: team.snapshot(), launcher: LAUNCHER });

/** Getting or sharing the team's work changes the project's files: never in the middle of a run or a guide. */
const TEAM_BUSY = 'Your work is being shared or updated - run the tests when it has finished.';
const RUN_BUSY = 'A test run or the user guide is going on - share or update when it has finished.';

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** Serves a file when it really lies under `root` (no `..` tricks). */
const sendFileUnder = (res: ServerResponse, root: string, requested: string): void => {
  const file = path.resolve(root, requested);
  if ((file !== root && !file.startsWith(root + path.sep)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
};

/** The Word bug report of a page, as a download. */
const sendBugReport = (res: ServerResponse, pageId: string): void => {
  const file = runner.bugReportFile(pageId);
  if (!file || !existsSync(file)) {
    res.writeHead(404).end('There is no bug report for this page: run it first - a report is written when a case fails.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="bug-report.docx"; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(file));
};

/** The raw bytes of a request (an uploaded file), refused above `limit` bytes. */
const readBytes = (req: IncomingMessage, limit: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new UploadError('That file is larger than 10 MB - a test-case sheet is much smaller.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
      if (text.length > 100_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('The request body is not JSON'));
      }
    });
  });

/** How long a run waits to hear from GitHub whether the team shared something newer (offline: it just runs). */
const GITHUB_CHECK_WAIT = 10_000;

/**
 * Before a run starts (not one that waits in the queue behind another), asks GitHub whether the team shared newer
 * tests. When it did: with `team` "latest" they are taken first, with "skip" the run goes on with this copy, and
 * otherwise the answer is a refusal with `needsLatest` (how many changes), so the page asks the person which.
 * Returns the refusal to send, or null to go on with the run.
 */
const teamFirst = async (choice: unknown): Promise<{ status: number; body: object } | null> => {
  if (choice === 'skip' || runner.busy() || !team.snapshot().connected) {
    return null;
  }
  const checked = await Promise.race([team.refresh(true).then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), GITHUB_CHECK_WAIT))]);
  const { behind } = team.snapshot();
  if (!checked || behind === 0) {
    return null;
  }
  if (choice !== 'latest') {
    return { status: 409, body: { needsLatest: behind } };
  }
  if (!(await team.latest())) {
    return { status: 409, body: { error: "Your teammates' changes could not be taken - see the message at the top. Nothing was run." } };
  }
  await runner.refreshList();
  return null;
};

type RunRequest = { pageId?: unknown; caseIds?: unknown; priorities?: unknown; headless?: unknown; team?: unknown };

const NO_CASE_OF_PRIORITY = (scope: string) => `No ${scope.replace(/ cases$/, '')} case to run here - every case of that priority is marked not applicable, or there is none`;

/** The guide signs in with the same back-office account: a run during it would sign one of them out. */
const GUIDE_BUSY = 'The user guide is being created - run the tests when it has finished.';

/** Runs a page (or some of its cases) now - or, while another run is in progress, after it (it is queued). */
const handleRun = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as RunRequest;
  if (!runner.snapshot().pages.some((candidate) => candidate.id === body.pageId)) {
    sendJson(res, 404, { error: 'Unknown page' });
    return;
  }
  if (guide.running || team.busy) {
    sendJson(res, 409, { error: team.busy ? TEAM_BUSY : GUIDE_BUSY });
    return;
  }
  const refused = await teamFirst(body.team);
  if (refused) {
    sendJson(res, refused.status, refused.body);
    return;
  }
  // Read again: getting the latest may have changed the page's cases
  const page = runner.snapshot().pages.find((candidate) => candidate.id === body.pageId);
  if (!page) {
    sendJson(res, 404, { error: 'This page is not in the latest tests any more' });
    return;
  }
  // A run of some priorities runs their cases; otherwise the cases asked for, or the whole page
  const priorities = parsePriorities(body.priorities);
  const scope = priorities.length ? priorityScope(priorities) : undefined;
  const caseIds = scope ? casesOfPriorities(page.tests, priorities) : Array.isArray(body.caseIds) ? body.caseIds.filter((id): id is string => typeof id === 'string') : [];
  if (scope && caseIds.length === 0) {
    sendJson(res, 400, { error: NO_CASE_OF_PRIORITY(scope) });
    return;
  }
  sendJson(res, 202, runner.enqueue([{ pageId: page.id, pageTitle: page.title, project: page.project, caseIds, headless: body.headless !== false, ...(scope ? { scope } : {}) }]));
};

type QueueRequest = { pageIds?: unknown; priorities?: unknown; headless?: unknown; team?: unknown };

/**
 * Runs several pages one after another, in the order given: every applicable case of each, or only the cases of the
 * priorities chosen. A page with no case of those priorities is left out (and named in the answer).
 */
const handleQueue = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as QueueRequest;
  const pageIds = Array.isArray(body.pageIds) ? body.pageIds : [];
  const chosenOf = () => pageIds.map((id) => runner.snapshot().pages.find((page) => page.id === id)).filter((page) => page !== undefined);
  if (chosenOf().length === 0) {
    sendJson(res, 400, { error: 'Choose at least one page to run' });
    return;
  }
  if (guide.running || team.busy) {
    sendJson(res, 409, { error: team.busy ? TEAM_BUSY : GUIDE_BUSY });
    return;
  }
  const refused = await teamFirst(body.team);
  if (refused) {
    sendJson(res, refused.status, refused.body);
    return;
  }
  // Read again: getting the latest may have changed the pages' cases
  const chosen = chosenOf();
  const headless = body.headless !== false;
  const priorities = parsePriorities(body.priorities);
  const scope = priorities.length ? priorityScope(priorities) : undefined;
  const runs = chosen.map((page) => ({ page, caseIds: scope ? casesOfPriorities(page.tests, priorities) : [] }));
  const runnable = runs.filter((run) => !scope || run.caseIds.length > 0);
  const leftOut = runs.filter((run) => !runnable.includes(run)).map((run) => run.page.title);
  if (runnable.length === 0) {
    sendJson(res, 400, { error: `None of the chosen pages has ${scope ?? 'a case'} to run` });
    return;
  }
  const answer = runner.enqueue(runnable.map(({ page, caseIds }) => ({ pageId: page.id, pageTitle: page.title, project: page.project, caseIds, headless, ...(scope ? { scope } : {}) })));
  sendJson(res, 202, { ...answer, leftOut });
};

type NotApplicableRequest = { pageId?: unknown; caseIds?: unknown; reason?: unknown };

type ReviewRequest = { pageId?: unknown; caseId?: unknown; expected?: unknown; note?: unknown; result?: unknown };

/** The reviewer's verdict on a case: the result it should give (passed, failed, blocked) and why - or null to take it back. */
const handleReview = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as ReviewRequest;
  const page = runner.snapshot().pages.find((candidate) => candidate.id === body.pageId);
  if (!page || typeof body.caseId !== 'string') {
    sendJson(res, 404, { error: 'Unknown page or test case' });
    return;
  }
  const expected = EXPECTED_RESULTS.find((result) => result === body.expected) ?? null;
  try {
    runner.review(page.id, body.caseId, expected, typeof body.note === 'string' ? body.note : '', typeof body.result === 'string' ? body.result : undefined);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message.replace(/^[A-Z_]+: /, '') : String(error) });
  }
};

/** Marks test cases not applicable (a `reason` text) or applicable again (`reason` null). */
const handleNotApplicable = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as NotApplicableRequest;
  const page = runner.snapshot().pages.find((candidate) => candidate.id === body.pageId);
  if (!page) {
    sendJson(res, 404, { error: 'Unknown page' });
    return;
  }
  const caseIds = Array.isArray(body.caseIds) ? body.caseIds.filter((id): id is string => typeof id === 'string') : [];
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
  try {
    runner.markNotApplicable(page.id, caseIds, reason);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
};

/** Starts the user guide (language ar or en); refused while a test run is in progress. */
const handleGuide = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as { language?: unknown; headless?: unknown };
  if (runner.busy()) {
    sendJson(res, 409, { error: 'A test run is in progress - create the guide when it has finished (both use the same back-office account).' });
    return;
  }
  try {
    guide.start(body.language === 'en' ? 'en' : 'ar', body.headless !== false);
    sendJson(res, 202, { ok: true });
  } catch (error) {
    sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
  }
};

/** The last user guide, as a download. */
const sendGuide = (res: ServerResponse): void => {
  const file = guide.latestFile();
  if (!file || !existsSync(file)) {
    res.writeHead(404).end('No user guide yet: create one first.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="user-guide.docx"; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(file));
};

/**
 * "Add user story": the picked Excel file (the request body, its name in X-File-Name, the story id the person typed in
 * X-Story-Id) is saved in docs/test-cases and its tests are started (story:new). Never during a run, the user guide or a
 * share: they read or change the same files.
 */
const handleAddStory = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (runner.busy() || guide.running || team.busy) {
    req.resume();
    sendJson(res, 409, { error: 'A test run, the user guide or a share is going on - add the story when it has finished.' });
    return;
  }
  const header = (name: string): string => {
    const value = req.headers[name];
    return decodeURIComponent(typeof value === 'string' ? value : '');
  };
  try {
    const bytes = await readBytes(req, MAX_SHEET_BYTES);
    const { file, story } = saveSheet(process.cwd(), header('x-file-name'), bytes, header('x-story-id'));
    const started = await startStory(process.cwd(), file);
    if (!started.ok) {
      sendJson(res, 400, { error: `The sheet could not be added (nothing was kept):\n${started.output}` });
      return;
    }
    await runner.refreshList();
    sendJson(res, 200, { ok: true, story, output: started.output });
  } catch (error) {
    const needsId = error instanceof UploadError && error.needsId;
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error), ...(needsId ? { needsId } : {}) });
  }
};

/** Restarts the dashboard (with the packages installed first when `install`) - only when "Start dashboard.cmd" started it. */
const handleRestart = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = (await readBody(req)) as { install?: unknown };
  if (!LAUNCHER) {
    sendJson(res, 409, { error: 'Close the dashboard and start it again (Start dashboard.cmd, or npm run dashboard).' });
    return;
  }
  if (runner.busy() || guide.running || team.busy) {
    sendJson(res, 409, { error: 'A test run, the user guide or a share is going on - restart when it has finished.' });
    return;
  }
  sendJson(res, 202, { ok: true });
  setTimeout(() => {
    runner.stop(true);
    guide.stop();
    team.stop();
    process.exit(body.install === true ? RESTART_AFTER_INSTALL : RESTART);
  }, 300);
};

type TeamRequest = { message?: unknown; name?: unknown; email?: unknown };

/**
 * The team copy on GitHub: `latest` (Get latest), `share` (Share my work, with the person's message), `author` (the name
 * and e-mail their shares carry) and `refresh` (ask GitHub now). Share and latest answer at once; their progress and
 * result come with the state.
 */
const handleTeam = async (req: IncomingMessage, res: ServerResponse, action: string): Promise<void> => {
  const body = (await readBody(req)) as TeamRequest;
  if ((action === 'latest' || action === 'share') && (runner.busy() || guide.running)) {
    sendJson(res, 409, { error: RUN_BUSY });
    return;
  }
  if ((action === 'latest' || action === 'share') && team.busy) {
    sendJson(res, 409, { error: TEAM_BUSY });
    return;
  }
  try {
    if (action === 'latest') {
      void team.latest().then(() => runner.refreshList());
    } else if (action === 'share') {
      void team.share(typeof body.message === 'string' ? body.message : '');
    } else if (action === 'author') {
      await team.author(typeof body.name === 'string' ? body.name : '', typeof body.email === 'string' ? body.email : '');
    } else if (action === 'refresh') {
      await team.refresh(true);
    } else {
      sendJson(res, 404, { error: 'Unknown team action' });
      return;
    }
    sendJson(res, 202, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
};

const handleEvents = (req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('state', snapshot());
  send('log-history', runner.recentLog());

  let pending: NodeJS.Timeout | undefined;
  const onChange = () => {
    // A burst of changes (several tests ending together) becomes one update
    pending ??= setTimeout(() => {
      pending = undefined;
      send('state', snapshot());
    }, 120);
  };
  const onLog = (line: string) => send('log', line);
  runner.on('change', onChange);
  runner.on('log', onLog);
  guide.on('change', onChange);
  guide.on('log', onLog);
  team.on('change', onChange);
  team.on('log', onLog);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    clearTimeout(pending);
    runner.off('change', onChange);
    runner.off('log', onLog);
    guide.off('change', onChange);
    guide.off('log', onLog);
    team.off('change', onChange);
    team.off('log', onLog);
  });
};

/** The dashboard answers only to this machine: a web page open in the browser must not be able to start test runs. */
const isLocalRequest = (req: IncomingMessage): boolean => {
  const allowed = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  if (!allowed.has(req.headers.host ?? '')) {
    return false;
  }
  const origin = req.headers.origin;
  return origin === undefined || [...allowed].some((host) => origin === `http://${host}`);
};

const server = createServer((req, res) => {
  void (async () => {
    if (!isLocalRequest(req)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        sendFileUnder(res, UI_DIR, 'index.html');
      } else if (req.method === 'GET' && url.pathname === '/api/events') {
        handleEvents(req, res);
      } else if (req.method === 'GET' && url.pathname === '/api/state') {
        sendJson(res, 200, snapshot());
      } else if (req.method === 'GET' && url.pathname === '/api/file') {
        // Screenshots and the like that a run produced - only from under test-output
        sendFileUnder(res, OUTPUT_DIR, path.relative(OUTPUT_DIR, path.resolve(url.searchParams.get('path') ?? '')));
      } else if (req.method === 'GET' && url.pathname.startsWith('/bug-report/')) {
        sendBugReport(res, decodeURIComponent(url.pathname.slice('/bug-report/'.length)));
      } else if (req.method === 'GET' && url.pathname.startsWith('/report/')) {
        sendFileUnder(res, HTML_REPORT_DIR, decodeURIComponent(url.pathname.slice('/report/'.length)) || 'index.html');
      } else if (req.method === 'GET' && url.pathname === '/api/guide/file') {
        sendGuide(res);
      } else if (req.method === 'POST' && url.pathname === '/api/guide') {
        await handleGuide(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/guide/stop') {
        guide.stop();
        sendJson(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/api/run') {
        await handleRun(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/queue') {
        await handleQueue(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/queue/resume') {
        const { resume } = (await readBody(req)) as { resume?: unknown };
        if (resume === true && guide.running) {
          sendJson(res, 409, { error: GUIDE_BUSY });
        } else {
          sendJson(res, 202, runner.settlePausedQueue(resume === true));
        }
      } else if (req.method === 'POST' && url.pathname === '/api/queue/remove') {
        const { index } = (await readBody(req)) as { index?: unknown };
        runner.unqueue(typeof index === 'number' ? index : -1);
        sendJson(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/api/not-applicable') {
        await handleNotApplicable(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/review') {
        await handleReview(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/stop') {
        const { skip } = (await readBody(req)) as { skip?: unknown };
        runner.stop(false, { skipOnly: skip === true });
        sendJson(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname.startsWith('/api/team/')) {
        await handleTeam(req, res, url.pathname.slice('/api/team/'.length));
      } else if (req.method === 'POST' && url.pathname === '/api/story') {
        await handleAddStory(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/restart') {
        await handleRestart(req, res);
      } else if (req.method === 'POST' && url.pathname === '/api/reload') {
        void runner.refreshList();
        sendJson(res, 202, { ok: true });
      } else {
        res.writeHead(404).end('Not found');
      }
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

/** Opens the dashboard in the browser the person chose in their .env (DASHBOARD_BROWSER), or the default one. */
const openBrowser = (url: string): void => {
  const { command, args, note } = browserCommand(url, chosenBrowser());
  if (note) {
    console.log(`[dashboard] ${note}`);
  }
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
};

server.on('error', (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `[dashboard] port ${PORT} is already in use - is the dashboard already running? Use DASHBOARD_PORT=<another port> to start a second one.`
      : `[dashboard] ${error.message}`,
  );
  process.exit(1);
});

/** A spec file or page.json added, renamed or removed under tests/pages shows up on the dashboard by itself. */
const watchPages = (): void => {
  const folder = path.resolve(PAGES_FOLDER);
  if (!existsSync(folder)) {
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    watch(folder, { recursive: true }, (_event, name) => {
      if (name && !/\.(spec\.ts|json)$/.test(name) && path.extname(name) !== '') {
        return;
      }
      clearTimeout(timer);
      // Only the not-applicable list changed: no need to ask Playwright for the tests again
      const onlyNotApplicable = name !== null && [NOT_APPLICABLE_FILE, REVIEW_FILE].includes(path.basename(name));
      timer = setTimeout(() => (onlyNotApplicable ? runner.reloadPages() : void runner.refreshList()), 800);
    }).on('error', () => undefined);
  } catch {
    // Without a watcher the "Reload tests" button does the same
  }
};

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`[dashboard] ${url}   (Ctrl+C to stop)`);
  if (!process.argv.includes('--no-open')) {
    openBrowser(url);
  }
  void runner.refreshList();
  watchPages();
  team.start();
});

process.on('SIGINT', () => {
  runner.stop(true);
  guide.stop();
  team.stop();
  process.exit(0);
});
