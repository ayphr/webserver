import { parentPort } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import { handlePacketMessage } from './workers/packetProcessor';

const log = createLogger('packet-worker-entry');

if (!parentPort) throw new Error('worker must be run as worker thread');

parentPort.on('message', (message) => {
  handlePacketMessage(message, (payload) => parentPort!.postMessage(payload));
});

parentPort.on('error', (error) => {
  log.error({ error }, 'worker thread error');
});
