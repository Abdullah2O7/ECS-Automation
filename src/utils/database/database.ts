import { readFileSync } from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { envFlag, envInteger, requiredEnv } from '../core/env.ts';

/**
 * Direct access to the application's SQL Server database, for the work the application cannot do through
 * its own screens: putting a record into the state a test needs, and clearing away what a test left
 * behind.
 *
 * It is deliberately *not* a way to assert that the UI worked - a test that checks the database
 * instead of the page stops testing the application. Use it for preconditions and cleanup.
 *
 * Connection details come from the environment (`DB_*` in `.env`) and are resolved on demand, so a
 * run that never touches the database never needs them configured.
 */

export type QueryParameter = string | number | boolean | Date | Buffer | null;

/** Named parameters for a statement, bound as `@name` - never concatenated into the SQL. */
export type QueryParameters = Record<string, QueryParameter>;

const databaseConfig = (): sql.config => {
  // `DB_SERVER` may carry a named instance (`HOST\SQLEXPRESS`), which the driver wants split out.
  const [host, instanceName] = requiredEnv('DB_SERVER').split('\\');
  const port = envInteger('DB_PORT', 1433, 1);

  return {
    server: host,
    database: requiredEnv('DB_NAME'),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    // A named instance is resolved through the SQL Browser service, which is mutually exclusive with
    // a fixed port - so only one of the two is ever sent.
    ...(instanceName ? {} : { port }),
    options: {
      ...(instanceName ? { instanceName } : {}),
      // The driver encrypts by default, which an on-premise UAT server usually is not set up for.
      encrypt: envFlag('DB_ENCRYPT', false),
      // Same reasoning as `ignoreHTTPSErrors` in playwright.config.ts: these servers are on internal
      // addresses, with certificates this environment does not trust.
      trustServerCertificate: envFlag('DB_TRUST_SERVER_CERTIFICATE', true),
    },
    requestTimeout: envInteger('DB_REQUEST_TIMEOUT_MS', 30_000, 1),
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  };
};

/**
 * One pool for the whole process, opened on first use.
 *
 * The in-flight promise is cached rather than the pool itself, so two callers that ask at the same
 * time wait on one connection attempt instead of opening two.
 */
let connecting: Promise<sql.ConnectionPool> | undefined;

export const connect = async (): Promise<sql.ConnectionPool> => {
  connecting ??= new sql.ConnectionPool(databaseConfig()).connect();
  try {
    return await connecting;
  } catch (error) {
    // A failed attempt must not stay cached, or every later call replays the same failure.
    connecting = undefined;
    throw error;
  }
};

/** Closes the pool. Node keeps the process alive while it is open, so every runner must call this. */
export const disconnect = async (): Promise<void> => {
  const pending = connecting;
  connecting = undefined;
  await pending?.then((pool) => pool.close()).catch(() => {});
};

const bind = (request: sql.Request, parameters: QueryParameters): sql.Request => {
  for (const [name, value] of Object.entries(parameters)) {
    request.input(name, value);
  }
  return request;
};

/** SQL Server reports one count per statement; a script's total is the sum. */
const totalRowsAffected = (rowsAffected: number[]): number =>
  rowsAffected.reduce((total, count) => total + count, 0);

/**
 * Runs a SELECT and returns its rows.
 *
 * ```ts
 * const rows = await query<{ Id: number }>('SELECT Id FROM Orders WHERE Name = @name', { name });
 * ```
 */
export const query = async <TRow = Record<string, unknown>>(
  statement: string,
  parameters: QueryParameters = {},
): Promise<TRow[]> => {
  const pool = await connect();
  const result = await bind(pool.request(), parameters).query<TRow>(statement);
  return result.recordset ?? [];
};

/**
 * Runs an UPDATE, DELETE or INSERT and returns the number of rows it changed.
 *
 * ```ts
 * const removed = await execute('DELETE FROM Orders WHERE Name = @name', { name });
 * ```
 */
export const execute = async (
  statement: string,
  parameters: QueryParameters = {},
): Promise<number> => {
  const pool = await connect();
  const result = await bind(pool.request(), parameters).query(statement);
  return totalRowsAffected(result.rowsAffected);
};

/**
 * Splits a script on its `GO` batch separators.
 *
 * `GO` is not SQL - it is the signal SSMS and sqlcmd use to end one batch and start the next, and the
 * driver rejects it outright. Scripts are split the way those tools split them: on a line holding
 * nothing but `GO`. A `GO` alone on a line inside a string literal would be split too, exactly as it
 * would be in SSMS.
 */
const splitBatches = (script: string): string[] =>
  script
    .split(/^[ \t]*GO[ \t]*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter((batch) => batch.length > 0);

export type ScriptOptions = {
  /** Named parameters made available to every batch in the script. */
  parameters?: QueryParameters;
  /** Run the script, report what it would change, then roll it back. */
  dryRun?: boolean;
  /** Commit only if every batch succeeds. Implied by `dryRun`. */
  transactional?: boolean;
};

export type ScriptResult = {
  batches: number;
  rowsAffected: number;
  /** Rows from any SELECT in the script, in the order the batches produced them. */
  recordsets: Record<string, unknown>[][];
  /** True when the changes were undone - always the case for a dry run. */
  rolledBack: boolean;
};

const runBatches = async (
  batches: string[],
  makeRequest: () => sql.Request,
  parameters: QueryParameters,
): Promise<Pick<ScriptResult, 'rowsAffected' | 'recordsets'>> => {
  let rowsAffected = 0;
  const recordsets: Record<string, unknown>[][] = [];

  for (const batch of batches) {
    // `batch()` rather than `query()`: only it accepts the statements a script may open with, such as
    // CREATE VIEW, which SQL Server requires to be first in their batch.
    const result = await bind(makeRequest(), parameters).batch(batch);
    rowsAffected += totalRowsAffected(result.rowsAffected);
    for (const recordset of result.recordsets as Record<string, unknown>[][]) {
      if (recordset.length > 0) {
        recordsets.push(recordset);
      }
    }
  }

  return { rowsAffected, recordsets };
};

/**
 * Runs a `.sql` file, batch by batch.
 *
 * With `dryRun` the whole script runs inside a transaction that is always rolled back, which answers
 * "how many rows would this DELETE touch?" without touching them. `transactional` uses the same
 * transaction but commits once every batch has succeeded, so a half-applied script cannot be left
 * behind.
 *
 * Neither option can protect a script that manages its own transactions, or one containing statements
 * SQL Server refuses to run inside a transaction (CREATE DATABASE, ALTER FULLTEXT, backup, restore).
 */
export const runSqlFile = async (
  filePath: string,
  options: ScriptOptions = {},
): Promise<ScriptResult> => runSqlScript(readFileSync(path.resolve(filePath), 'utf8'), options);

/** As `runSqlFile`, for a script already in memory. */
export const runSqlScript = async (
  script: string,
  options: ScriptOptions = {},
): Promise<ScriptResult> => {
  const { parameters = {}, dryRun = false, transactional = false } = options;
  const batches = splitBatches(script);

  if (batches.length === 0) {
    return { batches: 0, rowsAffected: 0, recordsets: [], rolledBack: false };
  }

  const pool = await connect();

  if (!dryRun && !transactional) {
    const outcome = await runBatches(batches, () => pool.request(), parameters);
    return { batches: batches.length, ...outcome, rolledBack: false };
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const outcome = await runBatches(batches, () => new sql.Request(transaction), parameters);
    if (dryRun) {
      await transaction.rollback();
      return { batches: batches.length, ...outcome, rolledBack: true };
    }
    await transaction.commit();
    return { batches: batches.length, ...outcome, rolledBack: false };
  } catch (error) {
    // Best-effort rollback: when the failing batch has already aborted the transaction itself, rolling
    // back throws a second error that would otherwise bury the first one.
    await transaction.rollback().catch(() => {});
    throw error;
  }
};
