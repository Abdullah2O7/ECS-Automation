import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Clears the runtime state, so the next run starts every flow from its first test case.
 *
 *   npm run clean:runtime               removes everything under runtime/ except .gitkeep
 *   npm run clean:runtime -- --dry-run  lists what would be removed
 *
 * The Excel registries under test-registries/ are never touched - they are the permanent record.
 */

const RUNTIME = path.resolve('runtime');
const dryRun = process.argv.slice(2).includes('--dry-run');

const entries = existsSync(RUNTIME) ? readdirSync(RUNTIME).filter((name) => name !== '.gitkeep') : [];
if (entries.length === 0) {
  console.log('[clean:runtime] nothing to remove');
} else {
  for (const name of entries) {
    console.log(`[clean:runtime] ${dryRun ? 'would remove' : 'removing'} runtime/${name}`);
    if (!dryRun) {
      rmSync(path.join(RUNTIME, name), { recursive: true, force: true });
    }
  }
}
