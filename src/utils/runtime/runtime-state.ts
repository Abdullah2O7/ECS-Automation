import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

/**
 * Hand-off file between the test cases of one flow.
 *
 * E2E flows are chains: one test creates a record, the next reviews it, a third approves it. Each is
 * its own test case so it can be run and re-run on its own, which means the identifiers the first
 * one generated have to survive between runs. They are written to `runtime/<flow>.json`, which is
 * ignored by Git and treated as disposable.
 *
 * The store also enforces the order of the chain: a test declares the step it performs and the step
 * it requires, and gets a readable error instead of a mid-test failure when the chain is not where
 * it expects.
 *
 * Writes are safe against the two ways a JSON file loses data:
 * - a crash half-way through a write: the new content goes to a temporary file beside the state, which then
 *   replaces it in one rename - a reader sees the old state or the new one, never part of one;
 * - two writers at once (the workers of one test case): every change takes the state's lock, reads the file
 *   as it is now, merges only its own fields into it and writes it back - nothing another writer added is lost.
 * One chain runs per workspace: two runs side by side would share `runtime/` (see README, Runtime state).
 */

export type FlowState = {
  /** Steps already executed against this record, e.g. `["TC00", "TC01"]`. */
  completedSteps: string[];
  /** Flow-specific values - identifiers, names, amounts - added by the tests as they go. */
  [key: string]: unknown;
};

/** The fields a test case changes - never `completedSteps`, which only `markStepCompleted` adds to. */
export type StatePatch<TState extends FlowState> = Partial<Omit<TState, 'completedSteps'>>;

/**
 * Runs the part of a spec that builds its tests from test data, keeping any error for later.
 *
 * A spec that derives one test per country or team works the list out while Playwright collects
 * tests, and an error thrown then aborts the collection of every spec in the run - even `--list`.
 * Build that list from test data, never from runtime state: Playwright lists the tests once before
 * the run and again in the worker, and a step that runs in between changes the state.
 * With the error kept, the spec registers a single test that fails with it instead, so the case still
 * refuses to run with the same message while the rest of the suite loads.
 */
export const prepareFromState = <T>(prepare: () => T): { ready: true; value: T } | { ready: false; error: unknown } => {
  try {
    return { ready: true, value: prepare() };
  } catch (error) {
    return { ready: false, error };
  }
};

/**
 * Reads runtime state the first time a test asks for it, and keeps it for the other tests of the worker.
 *
 * For specs whose tests are listed from test data: the state is read inside the tests, when the step
 * before has run, rather than while Playwright lists the tests. An error is not kept - every test that
 * asks gets it again, with the same message.
 */
export const readOnce = <T>(read: () => T): (() => T) => {
  let value: { read: T } | undefined;
  return () => (value ??= { read: read() }).read;
};

/**
 * Progress that several workers of one test case record side by side, e.g. which customers have
 * submitted their requests.
 *
 * Each key is its own marker file under `runtime/<directory>/`, so workers never write the same file
 * and cannot overwrite each other's progress - which the single JSON state file cannot promise. Key
 * the directory by the record the progress belongs to (an order id, say), so markers left by a
 * run against an earlier record are never counted for a new one.
 *
 * @param directory - Folder under `runtime/`, e.g. `example/tc03-4581`
 * @param root - The runtime folder - `runtime/` of the working directory; a temporary one in the unit tests
 * @returns `mark(key)` to record one finished key, `marked()` for every key recorded so far by any
 * worker, and `claim(key)` / `release(key)` for work only one worker may do
 */
export const createProgressMarkers = (directory: string, root: string = path.resolve('runtime')) => {
  const markerDirectory = path.join(root, directory);
  const fileNameOf = (key: string) => `${encodeURIComponent(key)}.done`;
  const lockNameOf = (key: string) => `${encodeURIComponent(key)}.lock`;

  return {
    /**
     * Claims a piece of work for this worker, e.g. the checks that run once every key is marked.
     * The lock file is created only if it does not exist yet, so exactly one worker gets `true`.
     * @param {string} key - Names the work being claimed
     * @returns {boolean} `true` if this worker claimed it, `false` if another one already has
     * @example
     * if (markers.claim('dashboard-check')) { await checkDashboard(); }
     */
    claim: (key: string): boolean => {
      mkdirSync(markerDirectory, { recursive: true });
      try {
        writeFileSync(path.join(markerDirectory, lockNameOf(key)), `${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return false;
        }
        throw error;
      }
    },
    /**
     * Gives a claimed piece of work back, so a later run can claim it again - after the work failed, say.
     * @param {string} key - The key passed to `claim`
     * @returns {void}
     * @example
     * try { await checkDashboard(); } catch (error) { markers.release('dashboard-check'); throw error; }
     */
    release: (key: string): void => {
      rmSync(path.join(markerDirectory, lockNameOf(key)), { force: true });
    },
    mark: (key: string): void => {
      mkdirSync(markerDirectory, { recursive: true });
      writeFileSync(path.join(markerDirectory, fileNameOf(key)), `${new Date().toISOString()}\n`, 'utf8');
    },
    marked: (): Set<string> => {
      if (!existsSync(markerDirectory)) {
        return new Set();
      }
      return new Set(
        readdirSync(markerDirectory)
          .filter((fileName) => fileName.endsWith('.done'))
          .map((fileName) => decodeURIComponent(fileName.slice(0, -'.done'.length))),
      );
    },
  };
};

// ----------------------------------Atomic writes and the state lock----------------------------------

/** A state lock older than this is left over by a run that stopped while holding it - a change holds it for milliseconds. */
export const STATE_LOCK_STALE_MS = 30_000;
/** How long a change waits for the lock before it fails - longer than the stale age, so a left-over lock is taken over first. */
const STATE_LOCK_WAIT_MS = 45_000;

/** Who holds a state lock - written into the lock file, so a stuck lock can be told from a live one. */
export type StateLockOwner = { pid: number; host: string; token: string; acquiredAt: string };

const errorCodeOf = (error: unknown): string | undefined => (error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Blocks this worker for a moment: the state helpers are synchronous, like the tests that call them. */
const pause = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists, it is only not ours to signal
    return errorCodeOf(error) === 'EPERM';
  }
};

/** The owner a lock file names, or `undefined` while it is still being written (or was left unreadable). */
const readStateLockOwner = (lockPath: string): StateLockOwner | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (isRecord(value) && typeof value.pid === 'number' && typeof value.host === 'string' && typeof value.token === 'string' && typeof value.acquiredAt === 'string') {
      return { pid: value.pid, host: value.host, token: value.token, acquiredAt: value.acquiredAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether an error on the lock file means it is busy rather than broken: on Windows a file another process is
 * removing stays in place, refusing to be opened or created (EPERM/EACCES), until the last handle on it closes.
 */
const isBusy = (error: unknown): boolean => {
  const code = errorCodeOf(error);
  return code === 'ENOENT' || (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES'));
};

/** Which file the lock is now (its file id), or `undefined` when there is none, or it is being removed. */
const lockFileId = (lockPath: string): bigint | undefined => {
  try {
    return statSync(lockPath, { bigint: true }).ino;
  } catch (error) {
    if (isBusy(error)) {
      return undefined;
    }
    throw error;
  }
};

/**
 * The lock as it is now - which file it is, and whether it is left over rather than held: older than
 * `STATE_LOCK_STALE_MS`, or taken by a process of this machine that is no longer running. `undefined` when there is no
 * lock. The verdict holds only for the file it was made on: a lock released and taken by the next writer meanwhile -
 * its last holder having ended since - is that writer's, and not left over.
 */
const inspectStateLock = (lockPath: string, now: number): { fileId: bigint; stale: boolean } | undefined => {
  let fileId: bigint;
  let modifiedAt: number;
  try {
    const stat = statSync(lockPath, { bigint: true });
    fileId = stat.ino;
    modifiedAt = Number(stat.mtimeMs);
  } catch (error) {
    if (isBusy(error)) {
      return undefined;
    }
    throw error;
  }
  const owner = readStateLockOwner(lockPath);
  const takenAt = owner ? Date.parse(owner.acquiredAt) : Number.NaN;
  const stale = now - (Number.isNaN(takenAt) ? modifiedAt : takenAt) > STATE_LOCK_STALE_MS
    || (owner !== undefined && owner.host === hostname() && owner.pid !== process.pid && !isAlive(owner.pid));
  return { fileId, stale: stale && lockFileId(lockPath) === fileId };
};

/**
 * Takes a left-over lock away: moved aside - of two writers taking over the same lock only one rename succeeds - and
 * removed when it is the file judged left over. A lock another writer took in the moment since is given back.
 */
const takeOverStateLock = (lockPath: string, judged: bigint): void => {
  const movedAside = `${lockPath}.${randomUUID()}.stale`;
  try {
    renameSync(lockPath, movedAside);
  } catch (error) {
    if (isBusy(error)) {
      return;
    }
    throw error;
  }
  if (statSync(movedAside, { bigint: true }).ino !== judged) {
    try {
      linkSync(movedAside, lockPath);
    } catch {
      // A third writer holds the lock now: the one whose lock this was finds it gone before it writes (RUNTIME_STATE_LOCK_LOST)
    }
  }
  rmSync(movedAside, { force: true });
};

/**
 * Runs `change` holding the lock of `statePath` (`<state>.lock`, created only if absent), and gives the lock back.
 * `change` gets `stillHeld`, to check just before it writes that the lock was not taken over meanwhile.
 */
const withStateLock = <T>(statePath: string, change: (stillHeld: () => boolean) => T): T => {
  const lockPath = `${statePath}.lock`;
  const owner: StateLockOwner = { pid: process.pid, host: hostname(), token: randomUUID(), acquiredAt: '' };
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  mkdirSync(path.dirname(statePath), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify({ ...owner, acquiredAt: new Date().toISOString() }), { encoding: 'utf8', flag: 'wx' });
      break;
    } catch (error) {
      if (errorCodeOf(error) !== 'EEXIST' && !isBusy(error)) {
        throw new Error(`RUNTIME_STATE_LOCK_FAILED:${path.relative(process.cwd(), lockPath)}: ${messageOf(error)}`, { cause: error });
      }
    }
    const lock = inspectStateLock(lockPath, Date.now());
    if (lock?.stale) {
      takeOverStateLock(lockPath, lock.fileId);
      continue;
    }
    if (Date.now() > deadline) {
      const holder = readStateLockOwner(lockPath);
      throw new Error(`RUNTIME_STATE_LOCKED:${path.relative(process.cwd(), lockPath)}: held by ${holder ? `process ${holder.pid} on ${holder.host} since ${holder.acquiredAt}` : 'an unknown process'} for longer than ${STATE_LOCK_WAIT_MS / 1000}s - is another run using this workspace?`);
    }
    pause(Math.min(20 + attempt * 10, 200));
  }
  const stillHeld = () => readStateLockOwner(lockPath)?.token === owner.token;
  try {
    return change(stillHeld);
  } finally {
    // Only our own lock is removed - one taken over as left-over belongs to another writer now
    if (stillHeld()) {
      rmSync(lockPath, { force: true });
    }
  }
};

/**
 * Replaces `target` with `content` in one step: written in full to a temporary file of its own beside it, flushed to
 * disk, then renamed over it. A rename Windows refuses for a moment (a reader has the file open) is tried again.
 */
const writeFileAtomically = (target: string, content: string): void => {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', flush: true });
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(temporary, target);
        return;
      } catch (error) {
        const code = errorCodeOf(error);
        if (attempt >= 10 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
          throw error;
        }
        pause(attempt * 25);
      }
    }
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(`RUNTIME_STATE_WRITE_FAILED:${path.relative(process.cwd(), target)}: ${messageOf(error)}`, { cause: error });
  }
};

// ----------------------------------The state store----------------------------------

/**
 * @param stateFileName - The state file under `runtime/`, e.g. `example/state.json`
 * @param identityOf - What tells one chain's record from the next one's (its generated name): a change made by a test
 * case of an earlier chain is refused rather than written into the new chain's state
 * @param root - The runtime folder - `runtime/` of the working directory; a temporary one in the unit tests
 */
export const createStateStore = <TState extends FlowState>(stateFileName: string, identityOf: (state: TState) => string, root: string = path.resolve('runtime')) => {
  const statePath = path.join(root, stateFileName);

  const readOrNull = (): TState | null => {
    let text: string;
    try {
      text = readFileSync(statePath, 'utf8');
    } catch (error) {
      if (errorCodeOf(error) === 'ENOENT') {
        return null;
      }
      throw new Error(`RUNTIME_STATE_UNREADABLE:${stateFileName}: ${messageOf(error)}`, { cause: error });
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      // Writes are atomic, so this is a file edited or damaged by hand - never guessed at, never treated as no state
      throw new Error(`RUNTIME_STATE_UNREADABLE:${stateFileName}: it is not valid JSON (${messageOf(error)}) - fix or remove it`, { cause: error });
    }
    if (!isRecord(value) || (value.completedSteps !== undefined && !Array.isArray(value.completedSteps))) {
      throw new Error(`RUNTIME_STATE_UNREADABLE:${stateFileName}: it is not a state object with a completedSteps list - fix or remove it`);
    }
    // A state written before completedSteps was recorded reads as having none
    return { ...value, completedSteps: Array.isArray(value.completedSteps) ? value.completedSteps.map(String) : [] } as TState;
  };

  const serialize = (state: TState): string => `${JSON.stringify(state, null, 2)}\n`;

  /**
   * Writes the state while the lock is still this writer's: one taken over meanwhile (as left-over) means another
   * writer may be changing the state too, so nothing is written - the change fails rather than being lost.
   */
  const commit = (state: TState, stillHeld: () => boolean): void => {
    if (!stillHeld()) {
      throw new Error(`RUNTIME_STATE_LOCK_LOST:${stateFileName}: the state's lock was taken over while this change was being made - nothing was written; rerun the test case.`);
    }
    writeFileAtomically(statePath, serialize(state));
  };

  /**
   * One change to the state as it is on disk now, under its lock: `patch` merged over the current file (worked out
   * from it when a function), `step` added to its completed steps. Returns the state as written.
   */
  const change = (state: TState, patch: StatePatch<TState> | ((current: Readonly<TState>) => StatePatch<TState>), step?: string): TState =>
    withStateLock(statePath, (stillHeld) => {
      const current = readOrNull();
      if (!current) {
        throw new Error(`RUNTIME_STATE_MISSING:${stateFileName}: it was removed while the test case was running - rerun the flow from its first test case.`);
      }
      if (identityOf(current) !== identityOf(state)) {
        throw new Error(`RUNTIME_STATE_REPLACED:${stateFileName}: it now holds "${identityOf(current)}", not "${identityOf(state)}" this test case started on - another chain was started in this workspace meanwhile.`);
      }
      const fields = typeof patch === 'function' ? patch(current) : patch;
      const next = { ...current, ...fields, completedSteps: [...new Set([...current.completedSteps, ...(step ? [step] : [])])] } as TState;
      commit(next, stillHeld);
      return next;
    });

  /** Starts a fresh chain. Called by the first test case of the flow, replacing any previous state. */
  const createState = (state: TState): void =>
    withStateLock(statePath, (stillHeld) => commit({ ...state, completedSteps: [] }, stillHeld));

  /**
   * Stores generated values without marking a step as completed: `patch` is merged into the state as it is on disk
   * now, so fields other test cases or workers wrote meanwhile are kept. Pass a function to work the fields out from
   * that current state - to add to a list rather than replace it. Returns the state as written.
   */
  const updateState = (state: TState, patch: StatePatch<TState> | ((current: Readonly<TState>) => StatePatch<TState>)): TState => change(state, patch);

  /**
   * Reads the state a later test case continues from, and refuses to run when the chain is not ready:
   * no state at all, the previous step missing, or this step already done against this record.
   */
  const readState = (options: {
    /** The test case asking, used in the error messages. */
    testCase: string;
    /** The step that must already be recorded, e.g. `TC00`. */
    requiredStep?: string;
    /** The step this test case performs, recorded on success. */
    currentStep: string;
    /** Steps that may legitimately run again on the same record (a reprint, say). */
    repeatable?: boolean;
  }): TState => {
    const state = readOrNull();
    if (!state) {
      throw new Error(
        `RUNTIME_STATE_MISSING:${stateFileName}: run the first test case of this flow before ${options.testCase}.`,
      );
    }

    const completedSteps = state.completedSteps;
    if (options.requiredStep && !completedSteps.includes(options.requiredStep)) {
      throw new Error(
        `PREREQUISITE_STEP_MISSING:${options.requiredStep}: run it before ${options.testCase}.`,
      );
    }
    if (!options.repeatable && completedSteps.includes(options.currentStep)) {
      throw new Error(
        `${options.testCase}_ALREADY_COMPLETED_FOR_THIS_STATE: rerun the flow from its first test case to create a new record.`,
      );
    }

    return state;
  };

  /**
   * Records `step` as done, with the values it hands on (`patch`), merged into the state as it is on disk now.
   * Repeatable steps are recorded once rather than appended on every run. Returns the state as written.
   */
  const markStepCompleted = (state: TState, step: string, patch: StatePatch<TState> = {}): TState => change(state, patch, step);

  return { statePath, createState, updateState, readState, markStepCompleted };
};
