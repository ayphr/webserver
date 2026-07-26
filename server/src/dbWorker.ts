import { parentPort } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import { flushRecords } from './workers/dbWriter';

const log = createLogger('db-worker-entry');

if (!parentPort) throw new Error('db worker must be run as worker thread');

parentPort.on('message', async (message) => {
  if (message?.action !== 'flush' || !Array.isArray(message.records)) return;
  await flushRecords(message.records, (payload) => parentPort!.postMessage(payload));
});

parentPort.on('error', (error) => {
  log.error({ error }, 'database worker thread error');
});
