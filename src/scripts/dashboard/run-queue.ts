/**
 * The dashboard's queue of runs: pages (or some of their cases) waiting to run one after another, after the run in
 * progress. Also counts the batch they belong to, so the dashboard can say "page 2 of 4". Plain state, no processes:
 * the Runner starts each run when the one before has ended.
 */
export type QueuedRun = {
  pageId: string;
  pageTitle: string;
  project: string;
  /** Empty: the whole page. */
  caseIds: string[];
  headless: boolean;
  /** What part of the page runs, when it was chosen by priority: "P1 cases". */
  scope?: string;
};

/** Where the run in progress is in its batch; `total` 1 for a run on its own. */
export type BatchPosition = { position: number; total: number };

/** The same page with the same cases is the same run: it is not queued twice. */
const keyOf = (run: Pick<QueuedRun, 'pageId' | 'caseIds'>): string => `${run.pageId}|${[...run.caseIds].sort().join(',')}`;

export class RunQueue {
  private waiting: QueuedRun[] = [];
  /** Runs of the current batch that have ended. */
  private ended = 0;
  /** Runs in the current batch: ended, in progress and waiting. */
  private size = 0;

  /** The runs waiting, in the order they will run. */
  items(): readonly QueuedRun[] {
    return this.waiting;
  }

  /**
   * Adds runs at the end of the queue, leaving out any that is waiting already or is the one in progress (`running`).
   * Returns those added. `running` undefined: nothing is running, so a new batch starts with these runs.
   */
  add(runs: readonly QueuedRun[], running?: Pick<QueuedRun, 'pageId' | 'caseIds'>): QueuedRun[] {
    const taken = new Set([...this.waiting.map(keyOf), ...(running ? [keyOf(running)] : [])]);
    const added: QueuedRun[] = [];
    for (const run of runs) {
      if (!taken.has(keyOf(run))) {
        taken.add(keyOf(run));
        added.push({ ...run, caseIds: [...run.caseIds] });
      }
    }
    if (!running) {
      this.ended = 0;
      this.size = 0;
    } else if (this.size === 0) {
      this.size = 1; // the run in progress started on its own: it becomes the first of the batch
    }
    this.waiting.push(...added);
    this.size += added.length;
    return added;
  }

  /** Takes the next run out of the queue (the Runner starts it). */
  next(): QueuedRun | undefined {
    return this.waiting.shift();
  }

  /** A run of the batch has ended; when nothing is waiting any more, the batch is over. */
  runEnded(): void {
    this.ended += 1;
    if (this.waiting.length === 0) {
      this.ended = 0;
      this.size = 0;
    }
  }

  /** Takes a waiting run out of the queue, by its place in it. */
  remove(index: number): QueuedRun | undefined {
    const [removed] = index >= 0 && index < this.waiting.length ? this.waiting.splice(index, 1) : [];
    if (removed) {
      this.size -= 1;
    }
    return removed;
  }

  /** Empties the queue (Stop all): the run in progress stays the last of its batch. */
  clear(): void {
    this.size -= this.waiting.length;
    this.waiting = [];
  }

  /** Where the run in progress is in its batch. */
  position(): BatchPosition {
    return this.size === 0 ? { position: 1, total: 1 } : { position: this.ended + 1, total: this.size };
  }
}
