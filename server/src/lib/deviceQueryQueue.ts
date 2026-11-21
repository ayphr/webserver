type QueuedTask = {
  priority: number;
  sequence: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export type PriorityQueue = {
  /** Higher priority values run first; ties are FIFO. */
  run: <T>(priority: number, task: () => Promise<T> | T) => Promise<T>;
  readonly pending: number;
  readonly active: number;
};

export function createPriorityQueue(maxConcurrency = 2): PriorityQueue {
  const queue: QueuedTask[] = [];
  let active = 0;
  let sequence = 0;

  const pump = () => {
    while (active < maxConcurrency && queue.length > 0) {
      queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const item = queue.shift()!;
      active += 1;
      Promise.resolve()
        .then(item.run)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return {
    run<T>(priority: number, task: () => Promise<T> | T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          priority,
          sequence: sequence += 1,
          run: () => Promise.resolve().then(task),
          resolve: (value) => resolve(value as T),
          reject,
        });
        pump();
      });
    },
    get pending() {
      return queue.length;
    },
    get active() {
      return active;
    },
  };
}

/** Boost queries use priority 1; standard queries use priority 0. */
export const deviceQueryQueue = createPriorityQueue(2);
