import { EventEmitter } from 'node:events';
import { getLatest, setAuthor, shareWork, teamStatus, TeamError, type TeamStatus } from '../team/team-git.ts';

/** What the dashboard shows about the team copy on GitHub: where this copy stands, and the share or update going on. */
export type TeamState = TeamStatus & {
  /** "share" or "latest" while one is going on. */
  busy?: 'share' | 'latest';
  /** The step it is on ("Checking: lint"). */
  step?: string;
  /** Why the last share or update stopped, and the files it is about. */
  error?: { kind: 'share' | 'latest'; message: string; files: string[]; at: number };
  /** The last share or update that worked. */
  last?: { kind: 'share' | 'latest'; at: number; files: string[]; dashboardChanged?: boolean; packagesChanged?: boolean };
};

const LOCAL_EVERY = 20_000;
const GITHUB_EVERY = 3 * 60_000;

/**
 * The dashboard's "Get latest" and "Share my work" (see team-git.ts). Looks at the folder every 20 seconds (changes made
 * here) and asks GitHub every 3 minutes (changes from the team). Emits `change` when what it shows changes, and `log`.
 */
export class TeamJob extends EventEmitter {
  private state: TeamState = { connected: false, ahead: 0, behind: 0, changes: [], checkedAt: 0 };
  private timers: NodeJS.Timeout[] = [];
  private lastFetch = 0;

  private readonly cwd: string;

  constructor(cwd: string = process.cwd()) {
    super();
    this.cwd = cwd;
  }

  snapshot(): TeamState {
    return this.state;
  }

  get busy(): boolean {
    return this.state.busy !== undefined;
  }

  start(): void {
    void this.refresh(true);
    this.timers.push(setInterval(() => void this.refresh(Date.now() - this.lastFetch >= GITHUB_EVERY), LOCAL_EVERY));
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  async refresh(fetch = false): Promise<void> {
    if (this.busy) {
      return;
    }
    if (fetch) {
      this.lastFetch = Date.now();
    }
    const status = await teamStatus(this.cwd, fetch).catch((): TeamStatus => ({ connected: false, ahead: 0, behind: 0, changes: [], checkedAt: Date.now() }));
    const before = JSON.stringify({ ...this.state, checkedAt: 0 });
    this.state = { ...status, ...pick(this.state) };
    if (JSON.stringify({ ...this.state, checkedAt: 0 }) !== before) {
      this.emit('change');
    }
  }

  /** "Get latest". Resolves when done, true when it worked; what went wrong is in the state (error), not thrown. */
  async latest(): Promise<boolean> {
    return this.job('latest', async () => {
      const result = await getLatest(this.cwd);
      this.emit('log', `[team] took ${result.files.length} changed file(s) from GitHub`);
      return { files: result.files, dashboardChanged: result.dashboardChanged, packagesChanged: result.packagesChanged };
    });
  }

  /** "Share my work" with the person's message. */
  async share(message: string): Promise<boolean> {
    return this.job('share', async () => {
      const result = await shareWork(this.cwd, message, (step) => {
        this.state = { ...this.state, step };
        this.emit('log', `[team] ${step}`);
        this.emit('change');
      });
      this.emit('log', `[team] shared ${result.files.length} changed file(s)`);
      return { files: result.files };
    });
  }

  async author(name: string, email: string): Promise<void> {
    await setAuthor(this.cwd, name, email);
    await this.refresh(false);
  }

  private async job(kind: 'share' | 'latest', work: () => Promise<Omit<NonNullable<TeamState['last']>, 'kind' | 'at'>>): Promise<boolean> {
    if (this.busy) {
      throw new TeamError('A share or an update is already going on.');
    }
    const { error: _cleared, ...rest } = this.state;
    this.state = { ...rest, busy: kind, step: kind === 'latest' ? "Taking the team's changes" : 'Starting' };
    this.emit('change');
    try {
      const done = await work();
      this.state = { ...this.state, last: { kind, at: Date.now(), ...done } };
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = { ...this.state, error: { kind, message, files: error instanceof TeamError ? error.files : [], at: Date.now() } };
      this.emit('log', `[team] ${kind} stopped: ${message.split('\n')[0]}`);
      return false;
    } finally {
      const { busy: _busy, step: _step, ...settled } = this.state;
      this.state = settled;
      await this.refresh(false);
      this.emit('change');
    }
  }
}

/** What a status refresh keeps from the state before it: the last result and the last error. */
const pick = (state: TeamState): Pick<TeamState, 'busy' | 'step' | 'error' | 'last'> => ({
  ...(state.busy ? { busy: state.busy } : {}),
  ...(state.step ? { step: state.step } : {}),
  ...(state.error ? { error: state.error } : {}),
  ...(state.last ? { last: state.last } : {}),
});
