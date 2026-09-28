import { parentPort } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import { drainMongoOperations, flushRecords } from './workers/dbWriter';

const log = createLogger('db-worker-entry');

if (!parentPort) throw new Error('db worker must be run as worker thread');

/**
 * This thread's prom-client registry is never scraped, so replay the operation
 * tallies into the main thread's registry that `/metrics` actually serves.
 */
function forwardMongoOperations() {
  const drained = drainMongoOperations();

  if (drained.length > 0) {
    parentPort!.postMessage({ action: 'mongoOperations', operations: drained });
  }
}

parentPort.on('message', async (message) => {
  if (message?.action !== 'flush' || !Array.isArray(message.records)) return;
  await flushRecords(message.records, (payload) => parentPort!.postMessage(payload));
  forwardMongoOperations();
});

parentPort.on('error', (error) => {
  log.error({ error }, 'database worker thread error');
});
