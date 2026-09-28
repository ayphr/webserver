import net from 'node:net';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import { closeTelemetryBuffer, drainTelemetryBuffer, enqueueTelemetryRecord } from './lib/redisBuffer';
import { appendChunk, parseIncomingBuffer } from './lib/socketFraming';
import type { TelemetryRecord } from './lib/telemetry';
import { createWorkerPool } from './lib/workerPool';
import { setupServer } from './api/server';
import { API_PORT, ENABLE_TLS, TCP_PORT } from './env';
import {
  packetsReceivedTotal,
  recordActiveDevices,
  recordMongoOperation,
  tcpBytesReceivedTotal,
  tcpConnectionDuration,
  tcpConnectionErrorsTotal,
  tcpConnectionsTotal,
  telemetryFlushBatchSize,
  telemetryFlushDuration,
  telemetryRecordsFlushedTotal,
} from './lib/metrics';

const log = createLogger('server');
const WORKER_COUNT = 4;
const FLUSH_INTERVAL_MS = 15_000;
let flushInProgress = false;

const workerPool = createWorkerPool(WORKER_COUNT, new URL('./worker.ts', import.meta.url), (record) => {
  void enqueueTelemetryRecord(record as TelemetryRecord);
});

const dbWorker = new Worker(new URL('./dbWorker.ts', import.meta.url), { type: 'module' } as WorkerOptions);
dbWorker.on('message', (message: { action: string; msg?: string; error?: unknown; operations?: Array<{ operation: string; collection: string; count: number }> }) => {
  if (message?.action === 'log') log.info({ component: 'db' }, message.msg);
  if (message?.action === 'error') log.error({ component: 'db', error: message.error }, 'database worker error');
  if (message?.action === 'mongoOperations' && Array.isArray(message.operations)) {
    for (const tally of message.operations) {
      recordMongoOperation(tally.operation, tally.collection, tally.count);
    }
  }
});
dbWorker.on('error', (error) => log.error({ error }, 'database worker crashed'));

setInterval(() => {
  if (flushInProgress) return;

  flushInProgress = true;
  void (async () => {
    const endTimer = telemetryFlushDuration.startTimer();

    try {
      const toFlush = await drainTelemetryBuffer();
      if (toFlush.length === 0) return;

      dbWorker.postMessage({ action: 'flush', records: toFlush });
      telemetryRecordsFlushedTotal.inc(toFlush.length);
      telemetryFlushBatchSize.observe(toFlush.length);
      log.info({ flushed: toFlush.length }, 'flushed buffered records to database worker');
    } finally {
      flushInProgress = false;
      endTimer();
    }
  })();
}, FLUSH_INTERVAL_MS);

const tcpServer = net.createServer((socket) => {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  const connectedAt = process.hrtime.bigint();

  tcpConnectionsTotal.inc();
  recordActiveDevices(1);
  socket.once('close', () => {
    const seconds = Number(process.hrtime.bigint() - connectedAt) / 1e9;
    tcpConnectionDuration.observe(seconds);
    recordActiveDevices(-1);
  });

  socket.on('data', (chunk: Uint8Array<ArrayBufferLike>) => {
    tcpBytesReceivedTotal.inc(chunk.byteLength);

    buffer = appendChunk(buffer, chunk);
    const { frames, remainder } = parseIncomingBuffer(buffer);
    buffer = remainder;

    for (const frame of frames) {
      packetsReceivedTotal.inc();
      workerPool.post(frame);
    }
  });

  socket.on('error', (error) => {
    tcpConnectionErrorsTotal.inc();
    log.error({ error }, 'socket error');
  });
});

tcpServer.listen(TCP_PORT, () => log.info({ port: TCP_PORT }, 'TCP server listening'));
const httpServer = await setupServer(API_PORT, ENABLE_TLS, () => log.info({ port: API_PORT }, 'API server listening'));

process.once('SIGINT', async () => {
  log.info('shutting down');

  tcpServer.close();
  await httpServer.stop();

  await workerPool.shutdown();
  await closeTelemetryBuffer();
  await dbWorker.terminate();

  process.exit(0);
});
