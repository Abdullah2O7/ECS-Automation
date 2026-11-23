import { logger } from '../logger/logger';

export type RetryOptions = {
  /** How many times the step is tried in all (default 3). */
  attempts?: number;
  /** Puts the screen back in a usable state before the next try (closes a half-open panel, reloads a form, ...). */
  recover?: () => Promise<void>;
  /** Pause before the next try, in ms (default 1 000). */
  pause?: number;
};

/**
 * Runs a step again when it fails - for steps that only fail because the application was slow or a panel was still in the
 * way (choosing a category, ticking a box, clicking Save). The step is tried `attempts` times in all; the last failure is
 * the one reported. Never use it around a check: a check that fails is a result, not something to repeat until it passes.
 */
export const retrying = async <T>(what: string, step: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      logger.warn(`${what} failed (try ${attempt} of ${attempts}), trying again: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, options.pause ?? 1_000));
      await options.recover?.().catch(() => undefined);
    }
  }
  throw lastError;
};
