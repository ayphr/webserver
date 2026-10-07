import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import { createLogger } from './logger';

const log = createLogger('worker-pool');

export function createWorkerPool(workerCount: number, workerUrl: URL, onRecord: (record: unknown) => void) {
  const workers: Worker[] = [];
  let shuttingDown = false;

  function spawn() {
    const worker = new Worker(workerUrl, { type: 'module' } as WorkerOptions);

    worker.on('message', (message: { action: string; record: unknown }) => {
      if (message?.action === 'record' && message.record) {
        onRecord(message.record);
      }
    });

    worker.on('error', (error) => {
      log.error({ error }, 'packet worker error');
    });

    worker.on('exit', (code) => {
      if (shuttingDown || code === 0) return;

      const index = workers.indexOf(worker);
      if (index === -1) return;

      log.warn({ code }, 'packet worker exited unexpectedly, restarting');
      workers[index] = spawn();
    });

    return worker;
  }

  for (let i = 0; i < workerCount; i++) {
    workers.push(spawn());
  }

  let roundRobinIndex = 0;

  function post(message: Uint8Array<ArrayBufferLike>) {
    if (workers.length === 0) return;
    const worker = workers[roundRobinIndex % workers.length]!;
    roundRobinIndex += 1;
    worker.postMessage(message);
  }

  async function shutdown() {
    shuttingDown = true;
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  return { workers, post, shutdown };
}
