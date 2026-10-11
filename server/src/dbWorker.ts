import { parentPort } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import { drainMongoOperations, flushRecords } from './workers/dbWriter';

const log = createLogger('db-worker-entry');

if (!parentPort) throw new Error('db worker must be run as worker thread');

function forwardMongoOperations() {
  const drained = drainMongoOperations();

  if (drained.length > 0) {
    parentPort!.postMessage({ action: 'mongoOperations', operations: drained });
  }
}

parentPort.on('message', async (message) => {
  if (message?.action !== 'flush' || !Array.isArray(message.records)) return;

  try {
    const insertedCount = await flushRecords(message.records);
    parentPort!.postMessage({ action: 'flushResult', id: message.id, ok: true, insertedCount });
  } catch (error) {
    log.error({ error }, 'failed to flush records');
    parentPort!.postMessage({ action: 'flushResult', id: message.id, ok: false, error: String(error) });
  } finally {
    forwardMongoOperations();
  }
});

parentPort.on('error', (error) => {
  log.error({ error }, 'database worker thread error');
});
