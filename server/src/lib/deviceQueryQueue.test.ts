import { describe, expect, test } from 'bun:test';
import { createPriorityQueue } from './deviceQueryQueue';

describe('priority queue', () => {
  test('runs boost tasks before queued standard tasks and keeps FIFO order', async () => {
    const queue = createPriorityQueue(1);
    const order: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.run(0, async () => {
      order.push('standard-1:start');
      await blocker;
      order.push('standard-1:end');
    });

    // Let the first task occupy the only worker before more work is queued.
    await Promise.resolve();
    const second = queue.run(0, () => order.push('standard-2'));
    const boost = queue.run(1, () => order.push('boost'));

    expect(queue.pending).toBe(2);
    expect(queue.active).toBe(1);

    release();
    await Promise.all([first, second, boost]);

    expect(order).toEqual(['standard-1:start', 'standard-1:end', 'boost', 'standard-2']);
    expect(queue.pending).toBe(0);
    expect(queue.active).toBe(0);
  });
});
