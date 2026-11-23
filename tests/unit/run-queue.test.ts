import { expect, test } from '@playwright/test';
import { RunQueue, type QueuedRun } from '../../src/scripts/dashboard/run-queue';

const page = (pageId: string, caseIds: string[] = []): QueuedRun => ({ pageId, pageTitle: pageId, project: pageId, caseIds, headless: true });

test.describe('The dashboard run queue', () => {
  test('pages run in the order they were chosen, and the batch is counted', () => {
    const queue = new RunQueue();
    queue.add([page('b'), page('c')], page('a')); // a was started on its own; b and c wait
    expect(queue.items().map((run) => run.pageId)).toEqual(['b', 'c']);
    expect(queue.position()).toEqual({ position: 1, total: 3 });
    queue.runEnded();
    expect(queue.next()?.pageId).toBe('b');
    expect(queue.position()).toEqual({ position: 2, total: 3 });
    queue.runEnded();
    expect(queue.next()?.pageId).toBe('c');
    expect(queue.position()).toEqual({ position: 3, total: 3 });
    queue.runEnded();
    expect(queue.next()).toBeUndefined();
    expect(queue.position()).toEqual({ position: 1, total: 1 });
  });

  test('a run that is waiting or running is not queued twice; other cases of the same page are', () => {
    const queue = new RunQueue();
    const added = queue.add([page('a'), page('b'), page('b'), page('a', ['A-01'])], page('a'));
    expect(added.map((run) => `${run.pageId}${run.caseIds.join()}`)).toEqual(['b', 'aA-01']);
  });

  test('a new batch starts when nothing is running', () => {
    const queue = new RunQueue();
    queue.add([page('a'), page('b')]);
    expect(queue.next()?.pageId).toBe('a');
    expect(queue.position()).toEqual({ position: 1, total: 2 });
  });

  test('removing a waiting run or clearing the queue shrinks the batch', () => {
    const queue = new RunQueue();
    queue.add([page('b'), page('c'), page('d')], page('a'));
    expect(queue.remove(1)?.pageId).toBe('c');
    expect(queue.remove(9)).toBeUndefined();
    expect(queue.position()).toEqual({ position: 1, total: 3 });
    queue.clear();
    expect(queue.items()).toEqual([]);
    expect(queue.position()).toEqual({ position: 1, total: 1 });
  });
});
