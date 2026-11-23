// Lint for correctness, not style: the rules below catch the mistakes that make a test pass when it should fail
// (an unawaited assertion or Playwright call, a Promise used where a value is expected) or that hide dead code.
// TypeScript is pinned to 6.0.x in package.json because typescript-eslint's type-aware rules need TypeScript's
// JavaScript API, which the native TypeScript 7 compiler does not ship yet.
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'test-output/**', 'runtime/**', '**/*.mjs', '**/*.cjs', '**/*.js'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, playwright },
    rules: {
      // A Promise that is not awaited, returned or voided: its failure is lost
      '@typescript-eslint/no-floating-promises': 'error',
      // A Promise passed where a value or a void callback is expected (if (promise), forEach(async ...))
      '@typescript-eslint/no-misused-promises': 'error',
      // await on something that is not a Promise - a sign the callee is not what the caller thinks
      '@typescript-eslint/await-thenable': 'error',
      // Dead code: unused imports and variables; a leading _ marks one kept on purpose
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Playwright: an unawaited expect(locator)/test.step, an expect with no matcher, fixed sleeps, debugging
      // leftovers and focused tests
      'playwright/missing-playwright-await': 'error',
      'playwright/valid-expect': 'error',
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-page-pause': 'error',
      'playwright/no-focused-test': 'error',
    },
  },
);
