import { test as sessionTest, expect } from './session';
import {
  disconnect,
  execute,
  query,
  runSqlFile,
  type QueryParameters,
  type ScriptOptions,
  type ScriptResult,
} from '../utils/database/database';

/**
 * The session fixtures plus a `db` handle, for the tests that have to reach past the UI - to set up a
 * precondition the portal cannot create, or to clear away what the test left behind.
 *
 * A spec opts in by importing from here instead of `./session`; everything `./session` provides
 * (`role`, `page`) works exactly as before.
 *
 * ```ts
 * import { expect, test } from '../../fixtures/database';
 *
 * test.use({ role: 'ADMIN' });
 *
 * test('TC02 - create an order', async ({ page, db }) => {
 *   await db.execute('DELETE FROM Orders WHERE Name = @name', { name });
 *   // ... UI steps ...
 * });
 * ```
 *
 * The connection is opened by the first query and closed once the worker is done, so a spec file that
 * imports this but never touches `db` still never connects.
 */

export type Database = {
  /** Rows of a SELECT. */
  query: typeof query;
  /** Rows changed by an UPDATE, DELETE or INSERT. */
  execute: typeof execute;
  /** Runs a `.sql` file from the `sql/` folder, batch by batch. */
  runFile: (filePath: string, options?: ScriptOptions) => Promise<ScriptResult>;
};

type DatabaseWorkerFixtures = {
  db: Database;
};

export const test = sessionTest.extend<{}, DatabaseWorkerFixtures>({
  db: [
    async ({ }, use) => {
      await use({ query, execute, runFile: runSqlFile });

      // Worker-scoped so the pool is shared by every test in the worker and closed once, at the end -
      // opening and closing a connection per test would cost more than the queries themselves.
      await disconnect();
    },
    { scope: 'worker' },
  ],
});

export { expect };
export type { QueryParameters, ScriptOptions, ScriptResult };
