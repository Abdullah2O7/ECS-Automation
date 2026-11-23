/**
 * Reading the environment (`.env`, the CI variable group) with one shape of error everywhere: a value that is missing
 * or cannot be read fails where it is read, naming the variable - never NaN, an accidental `false` or `undefined`
 * deep in a run. Values are used as they are (no trimming): a password may hold spaces.
 *
 * No imports, so the plain-Node scripts (`npm run sql`, `npm run clean:runtime`) can use it too.
 */

/** A variable that must be set and not empty. */
export const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`MISSING_ENVIRONMENT_CONFIGURATION:${name}`);
  }
  return value;
};

const TRUE = ['true', '1', 'yes'];
const FALSE = ['false', '0', 'no'];

/** A yes/no variable: true/false, 1/0 or yes/no in any case; `fallback` when it is not set or empty. */
export const envFlag = (name: string, fallback = false): boolean => {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (TRUE.includes(value)) {
    return true;
  }
  if (FALSE.includes(value)) {
    return false;
  }
  throw new Error(`INVALID_ENVIRONMENT_CONFIGURATION:${name}="${process.env[name]}": expected true or false.`);
};

/** A whole-number variable of at least `min`; `fallback` when it is not set or empty. */
export const envInteger = (name: string, fallback: number, min = 0): number => {
  const text = process.env[name]?.trim();
  if (!text) {
    return fallback;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`INVALID_ENVIRONMENT_CONFIGURATION:${name}="${text}": expected a whole number of at least ${min}.`);
  }
  return value;
};

/** A variable that names one of `choices`, exactly as listed; undefined when it is not set or empty. */
export const envChoice = <T extends string>(name: string, choices: readonly T[]): T | undefined => {
  const text = process.env[name]?.trim();
  if (!text) {
    return undefined;
  }
  if (!(choices as readonly string[]).includes(text)) {
    throw new Error(`INVALID_ENVIRONMENT_CONFIGURATION:${name}="${text}": expected one of ${choices.join(', ')}.`);
  }
  return text as T;
};

/**
 * The folder name of a labelled run - `<RUN_LABEL>-<PW_RUN_ID>` - its results, HTML report, JUnit file and log go
 * under; undefined for an unlabelled run. The label names folders under `test-output`, so it is refused unless it is
 * letters, digits, ".", "_" and "-" - a label such as `../../x` would write outside it.
 */
export const runFolderName = (): string | undefined => {
  const label = process.env.RUN_LABEL;
  if (!label) {
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) {
    throw new Error(`UNSAFE_RUN_LABEL:"${label}": use letters, digits, ".", "_" and "-" only - it names folders under test-output.`);
  }
  return process.env.PW_RUN_ID ? `${label}-${process.env.PW_RUN_ID}` : label;
};
