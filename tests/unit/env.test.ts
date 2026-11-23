import { expect, test } from '@playwright/test';
import { envChoice, envFlag, envInteger, requiredEnv, runFolderName } from '../../src/utils/core/env';

// These tests change process.env, so they run one after the other and put it back.
test.describe.configure({ mode: 'serial' });

const NAMES = ['UNIT_VAR', 'RUN_LABEL', 'PW_RUN_ID'];
const saved = new Map<string, string | undefined>();

test.beforeEach(() => {
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

test.afterEach(() => {
  for (const name of NAMES) {
    const value = saved.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test.describe('requiredEnv', () => {
  test('returns the value as it is, spaces included', () => {
    process.env.UNIT_VAR = ' pass word ';
    expect(requiredEnv('UNIT_VAR')).toBe(' pass word ');
  });

  test('names the missing variable', () => {
    expect(() => requiredEnv('UNIT_VAR')).toThrow('MISSING_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
  });

  test('treats an empty value as missing', () => {
    process.env.UNIT_VAR = '';
    expect(() => requiredEnv('UNIT_VAR')).toThrow('MISSING_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
  });
});

test.describe('envFlag', () => {
  for (const [text, expected] of [['true', true], ['1', true], ['YES', true], ['false', false], ['0', false], [' No ', false]] as const) {
    test(`reads "${text}" as ${expected}`, () => {
      process.env.UNIT_VAR = text;
      expect(envFlag('UNIT_VAR')).toBe(expected);
    });
  }

  test('uses the fallback when unset or empty', () => {
    expect(envFlag('UNIT_VAR')).toBe(false);
    expect(envFlag('UNIT_VAR', true)).toBe(true);
    process.env.UNIT_VAR = '';
    expect(envFlag('UNIT_VAR', true)).toBe(true);
  });

  test('refuses anything else', () => {
    process.env.UNIT_VAR = 'maybe';
    expect(() => envFlag('UNIT_VAR')).toThrow('INVALID_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
  });
});

test.describe('envInteger', () => {
  test('reads a whole number and falls back when unset', () => {
    expect(envInteger('UNIT_VAR', 5)).toBe(5);
    process.env.UNIT_VAR = ' 42 ';
    expect(envInteger('UNIT_VAR', 5)).toBe(42);
  });

  test('refuses text, decimals and numbers below the minimum', () => {
    for (const text of ['abc', '1.5']) {
      process.env.UNIT_VAR = text;
      expect(() => envInteger('UNIT_VAR', 5)).toThrow('INVALID_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
    }
    process.env.UNIT_VAR = '0';
    expect(() => envInteger('UNIT_VAR', 5, 1)).toThrow('INVALID_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
  });
});

test.describe('envChoice', () => {
  test('returns a listed choice, undefined when unset, and refuses others', () => {
    expect(envChoice('UNIT_VAR', ['a', 'b'] as const)).toBeUndefined();
    process.env.UNIT_VAR = 'b';
    expect(envChoice('UNIT_VAR', ['a', 'b'] as const)).toBe('b');
    process.env.UNIT_VAR = 'c';
    expect(() => envChoice('UNIT_VAR', ['a', 'b'] as const)).toThrow('INVALID_ENVIRONMENT_CONFIGURATION:UNIT_VAR');
  });
});

test.describe('runFolderName', () => {
  test('is undefined for an unlabelled run', () => {
    expect(runFolderName()).toBeUndefined();
  });

  test('joins the label and the run id', () => {
    process.env.RUN_LABEL = 'TC02';
    expect(runFolderName()).toBe('TC02');
    process.env.PW_RUN_ID = '123';
    expect(runFolderName()).toBe('TC02-123');
  });

  test('refuses a label that could write outside test-output', () => {
    process.env.RUN_LABEL = '../../x';
    expect(() => runFolderName()).toThrow('UNSAFE_RUN_LABEL');
  });
});
