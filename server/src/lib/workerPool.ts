import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';

export function createWorkerPool(workerCount: number, workerUrl: URL, onRecord: (record: unknown) => void) {
  const workers: Worker[] = [];

  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(workerUrl, { type: 'module' } as WorkerOptions);
    worker.on('message', (message: any) => {
      if (message?.action === 'record' && message.record) {
        onRecord(message.record);
      }
    });
    workers.push(worker);
  }

  let roundRobinIndex = 0;

  function post(message: Uint8Array<ArrayBufferLike>) {
    if (workers.length === 0) return;
    const worker = workers[roundRobinIndex % workers.length]!;
    roundRobinIndex += 1;
    worker.postMessage(message);
  }

  async function shutdown() {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  return { workers, post, shutdown };
}
