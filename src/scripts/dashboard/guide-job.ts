import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { GUIDE_FOLDER, LATEST_GUIDE_FILE, type GuideResult } from '../user-guide/guide-files.ts';
import type { GuideLanguage } from '../user-guide/guide-model.ts';

const PLAYWRIGHT_CLI = path.resolve('node_modules/@playwright/test/cli.js');
const GUIDE_CONFIG = 'playwright.guide.config.ts';

/** What the dashboard shows about the user guide: the run in progress (with its last step) and the last guide made. */
export type GuideState = {
  running: boolean;
  language?: GuideLanguage;
  startedAt?: number;
  /** The step the builder is on ("chapter: الأخبار"). */
  progress?: string;
  /** Why the last run did not produce a guide. */
  error?: string;
  latest?: GuideResult & { name: string; size: number };
};

/**
 * Creates the back-office user guide for the dashboard ("Create user guide"): runs the guide builder
 * (src/scripts/user-guide, its own Playwright config) and keeps the last guide it made for download.
 * Emits `change` when its state changes and `log` with each line the builder prints.
 */
export class GuideJob extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: GuideState = { running: false };

  snapshot(): GuideState {
    return { ...this.state, latest: latestGuide() };
  }

  /** The Word file of the last guide, when there is one. */
  latestFile(): string | undefined {
    return latestGuide()?.file;
  }

  start(language: GuideLanguage, headless: boolean): void {
    if (this.child) {
      throw new Error('A user guide is already being created.');
    }
    const startedAt = Date.now();
    this.state = { running: true, language, startedAt, progress: 'starting the browser' };
    const lines: string[] = [];
    const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'test', `--config=${GUIDE_CONFIG}`, '--reporter=line'], {
      env: { ...process.env, GUIDE_LANGUAGE: language, GUIDE_HEADED: headless ? '' : 'true', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    const onOutput = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split(/\r?\n/).filter((text) => text.trim())) {
        lines.push(line);
        this.emit('log', `[user guide] ${line}`);
        const step = /\[guide\] (.+)/.exec(line)?.[1];
        if (step) {
          this.state = { ...this.state, progress: step };
          this.emit('change');
        }
      }
    };
    child.stdout?.on('data', onOutput);
    child.stderr?.on('data', onOutput);
    child.on('close', (code) => {
      this.child = null;
      const made = latestGuide();
      const ok = code === 0 && made !== undefined && made.createdAt >= startedAt;
      this.state = { running: false, language, ...(ok ? {} : { error: failureOf(lines, code) }) };
      this.emit('change');
    });
    child.on('error', (error) => {
      this.child = null;
      this.state = { running: false, language, error: `The guide builder could not start: ${error.message}` };
      this.emit('change');
    });
    this.emit('change');
  }

  stop(): void {
    if (!this.child?.pid) {
      return;
    }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(this.child.pid), '/t', '/f']);
    } else {
      this.child.kill('SIGTERM');
    }
  }

  get running(): boolean {
    return this.child !== null;
  }
}

/** The last guide written (test-output/user-guide/latest.json), when its file still exists. */
const latestGuide = (): (GuideResult & { name: string; size: number }) | undefined => {
  const latest = path.resolve(GUIDE_FOLDER, LATEST_GUIDE_FILE);
  if (!existsSync(latest)) {
    return undefined;
  }
  try {
    const result = JSON.parse(readFileSync(latest, 'utf8')) as GuideResult;
    return existsSync(result.file) ? { ...result, name: path.basename(result.file), size: statSync(result.file).size } : undefined;
  } catch {
    return undefined;
  }
};

/** The reason a run made no guide: the error lines Playwright printed (no stack), or the exit code. */
const failureOf = (lines: readonly string[], code: number | null): string => {
  const errors = lines.filter((line) => /error|SETUP_FAILED|MISSING_ENVIRONMENT|timeout/i.test(line) && !/^\s+at /.test(line));
  return errors.slice(0, 6).join('\n') || `The guide builder stopped (exit code ${code ?? 'unknown'}).`;
};
