import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProgressMarkers, createStateStore, prepareFromState, readOnce, type FlowState } from '../../src/utils/runtime/runtime-state';

type DemoState = FlowState & { name: string; recordId?: string };

let root: string;
const newStore = () => createStateStore<DemoState>('demo/state.json', (state) => state.name, root);

test.beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'runtime-state-'));
});

test.afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test.describe('state store', () => {
  test('a new chain starts with no completed steps and can be read back', () => {
    const store = newStore();
    store.createState({ name: 'chain-1', completedSteps: [] });
    const state = store.readState({ testCase: 'TC02', currentStep: 'TC02' });
    expect(state).toMatchObject({ name: 'chain-1', completedSteps: [] });
  });

  test('refuses to read when no first test case has run', () => {
    expect(() => newStore().readState({ testCase: 'TC03', currentStep: 'TC03' })).toThrow('RUNTIME_STATE_MISSING');
  });

  test('enforces the order of the chain', () => {
    const store = newStore();
    store.createState({ name: 'chain-1', completedSteps: [] });
    const state = store.readState({ testCase: 'TC03', currentStep: 'TC03' });
    expect(() => store.readState({ testCase: 'TC03', requiredStep: 'TC02', currentStep: 'TC03' })).toThrow('PREREQUISITE_STEP_MISSING:TC02');

    store.markStepCompleted(state, 'TC02', { recordId: '7' });
    expect(store.readState({ testCase: 'TC03', requiredStep: 'TC02', currentStep: 'TC03' }).recordId).toBe('7');
  });

  test('refuses to repeat a step on the same record unless it is repeatable', () => {
    const store = newStore();
    store.createState({ name: 'chain-1', completedSteps: [] });
    const state = store.readState({ testCase: 'TC02', currentStep: 'TC02' });
    store.markStepCompleted(state, 'TC02');

    expect(() => store.readState({ testCase: 'TC02', currentStep: 'TC02' })).toThrow('TC02_ALREADY_COMPLETED_FOR_THIS_STATE');
    expect(store.readState({ testCase: 'TC02', currentStep: 'TC02', repeatable: true }).completedSteps).toEqual(['TC02']);
  });

  test('records a step once and keeps fields written meanwhile', () => {
    const store = newStore();
    store.createState({ name: 'chain-1', completedSteps: [] });
    const state = store.readState({ testCase: 'TC02', currentStep: 'TC02' });

    store.updateState(state, { recordId: '9' });
    store.markStepCompleted(state, 'TC02');
    const final = store.markStepCompleted(state, 'TC02');

    expect(final.completedSteps).toEqual(['TC02']);
    expect(final.recordId).toBe('9');
  });

  test('refuses a change from an earlier chain once a new chain replaced the state', () => {
    const store = newStore();
    store.createState({ name: 'old-chain', completedSteps: [] });
    const oldState = store.readState({ testCase: 'TC02', currentStep: 'TC02' });

    store.createState({ name: 'new-chain', completedSteps: [] });
    expect(() => store.markStepCompleted(oldState, 'TC02')).toThrow('RUNTIME_STATE_REPLACED');
  });

  test('reports a damaged file instead of treating it as no state', () => {
    const store = newStore();
    store.createState({ name: 'chain-1', completedSteps: [] });
    writeFileSync(store.statePath, '{ not json', 'utf8');
    expect(() => store.readState({ testCase: 'TC02', currentStep: 'TC02' })).toThrow('RUNTIME_STATE_UNREADABLE');
  });
});

test.describe('progress markers', () => {
  test('marks keys and lists every one recorded', () => {
    const markers = createProgressMarkers('demo/progress', root);
    expect(markers.marked().size).toBe(0);
    markers.mark('customer a/1');
    markers.mark('customer b');
    expect([...markers.marked()].sort()).toEqual(['customer a/1', 'customer b']);
  });

  test('a piece of work is claimed by one worker until it is released', () => {
    const markers = createProgressMarkers('demo/progress', root);
    expect(markers.claim('dashboard-check')).toBe(true);
    expect(markers.claim('dashboard-check')).toBe(false);
    markers.release('dashboard-check');
    expect(markers.claim('dashboard-check')).toBe(true);
  });
});

test.describe('spec helpers', () => {
  test('prepareFromState keeps the error instead of throwing while tests are collected', () => {
    expect(prepareFromState(() => 5)).toEqual({ ready: true, value: 5 });
    const failed = prepareFromState(() => {
      throw new Error('boom');
    });
    expect(failed.ready).toBe(false);
  });

  test('readOnce reads once and keeps the value, but does not keep an error', () => {
    let reads = 0;
    const read = readOnce(() => ++reads);
    expect(read()).toBe(1);
    expect(read()).toBe(1);

    let attempts = 0;
    const flaky = readOnce(() => {
      if (++attempts === 1) {
        throw new Error('not ready');
      }
      return 'ok';
    });
    expect(() => flaky()).toThrow('not ready');
    expect(flaky()).toBe('ok');
  });
});
