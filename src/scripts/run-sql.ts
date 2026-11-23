import path from 'node:path';
import dotenv from 'dotenv';
import { disconnect, runSqlFile, runSqlScript, type ScriptResult } from '../utils/database/database.ts';
import { logger } from '../utils/logger/logger.ts';

/**
 * Runs a `.sql` file - or a statement typed on the command line - against the database configured in
 * `.env`, outside of any test.
 *
 * ```
 * npm run sql -- src/scripts/sql/example-cleanup.sql
 * npm run sql -- --dry-run src/scripts/sql/example-cleanup.sql
 * npm run sql -- --query "UPDATE Orders SET IsArchived = 1 WHERE Id = 42"
 * npm run sql -- --param name="E2E Order" src/scripts/sql/example-cleanup.sql
 * ```
 *
 * `--dry-run` is the reason this exists in this shape: an UPDATE or a DELETE written against a shared
 * UAT database is worth running once as a rehearsal, to see the row count before the rows are gone.
 */

// Playwright loads this itself, but nothing does when the script is run straight from the terminal.
dotenv.config({ path: '.env' });

type Arguments = {
  filePath?: string;
  statement?: string;
  parameters: Record<string, string>;
  dryRun: boolean;
  transactional: boolean;
};

const usage = [
  'Usage: npm run sql -- [options] <file.sql>',
  '       npm run sql -- [options] --query "<statement>"',
  '',
  'Options:',
  '  --dry-run            Run inside a transaction and always roll back, reporting what would change.',
  '  --transaction        Commit only if every batch succeeds.',
  '  --param name=value   Bind @name in the script. Repeatable.',
  '  --query <statement>  Run the statement given here instead of a file.',
].join('\n');

const parseArguments = (argv: string[]): Arguments => {
  const parsed: Arguments = { parameters: {}, dryRun: false, transactional: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--dry-run') {
      parsed.dryRun = true;
    } else if (argument === '--transaction') {
      parsed.transactional = true;
    } else if (argument === '--query') {
      parsed.statement = argv[++index];
    } else if (argument === '--param') {
      const pair = argv[++index] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 1) {
        throw new Error(`--param expects name=value, received: ${pair}`);
      }
      parsed.parameters[pair.slice(0, separator)] = pair.slice(separator + 1);
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      parsed.filePath = argument;
    }
  }

  if (!parsed.filePath && !parsed.statement) {
    throw new Error(usage);
  }
  if (parsed.filePath && parsed.statement) {
    throw new Error('Pass a file or --query, not both.');
  }

  return parsed;
};

const report = (result: ScriptResult): void => {
  for (const recordset of result.recordsets) {
    console.table(recordset);
  }

  const summary = `${result.rowsAffected} row(s) affected across ${result.batches} batch(es)`;
  logger.info(result.rolledBack ? `DRY RUN - rolled back. ${summary} would have changed.` : summary);
};

const main = async (): Promise<void> => {
  const { filePath, statement, parameters, dryRun, transactional } = parseArguments(
    process.argv.slice(2),
  );

  const source = filePath ? path.resolve(filePath) : '--query';
  logger.info(`${dryRun ? 'Dry run' : 'Running'}: ${source}`);

  const options = { parameters, dryRun, transactional };
  const result = filePath
    ? await runSqlFile(filePath, options)
    : await runSqlScript(statement as string, options);

  report(result);
};

main()
  .catch((error: unknown) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  // The pool holds the event loop open, so the process only ends once it is closed - whether the
  // script succeeded or not.
  .finally(disconnect);
