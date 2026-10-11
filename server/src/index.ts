import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { createLogger } from './lib/logger';
import {
  ackTelemetryBatch,
  closeTelemetryBuffer,
  enqueueTelemetryRecord,
  readTelemetryBatch,
} from './lib/redisBuffer';
import { appendChunk, parseIncomingBuffer } from './lib/socketFraming';
import type { TelemetryRecord } from './lib/telemetry';
import { createWorkerPool } from './lib/workerPool';
import { setupMetricsServer, setupServer } from './api/server';
import { API_PORT, METRICS_PORT, TCP_PORT } from './env';
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
const FLUSH_BATCH_LIMIT = 5_000;
const FLUSH_TIMEOUT_MS = 30_000;
let flushInProgress = false;

type FlushResult = { ok: boolean; insertedCount?: number; error?: string };
const pendingFlushes = new Map<string, (result: FlushResult) => void>();

const workerPool = createWorkerPool(WORKER_COUNT, new URL('./worker.ts', import.meta.url), (record) => {
  void enqueueTelemetryRecord(record as TelemetryRecord);
});

const dbWorker = new Worker(new URL('./dbWorker.ts', import.meta.url), { type: 'module' } as WorkerOptions);
dbWorker.on('message', (message: { action: string; id?: string; msg?: string; ok?: boolean; insertedCount?: number; error?: unknown; operations?: Array<{ operation: string; collection: string; count: number }> }) => {
  if (message?.action === 'log') log.info({ component: 'db' }, message.msg);
  if (message?.action === 'error') log.error({ component: 'db', error: message.error }, 'database worker error');
  if (message?.action === 'flushResult' && message.id) {
    pendingFlushes.get(message.id)?.({
      ok: message.ok === true,
      insertedCount: message.insertedCount,
      error: typeof message.error === 'string' ? message.error : undefined,
    });
    pendingFlushes.delete(message.id);
    return;
  }
  if (message?.action === 'mongoOperations' && Array.isArray(message.operations)) {
    for (const tally of message.operations) {
      recordMongoOperation(tally.operation, tally.collection, tally.count);
    }
  }
});
dbWorker.on('error', (error) => log.error({ error }, 'database worker crashed'));

function flushToDatabase(records: TelemetryRecord[]): Promise<FlushResult> {
  return new Promise((resolve) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      if (pendingFlushes.delete(id)) resolve({ ok: false, error: 'timed out waiting for database worker' });
    }, FLUSH_TIMEOUT_MS);

    pendingFlushes.set(id, (result) => {
      clearTimeout(timeout);
      resolve(result);
    });

    dbWorker.postMessage({ action: 'flush', id, records });
  });
}

setInterval(() => {
  if (flushInProgress) return;

  flushInProgress = true;
  void (async () => {
    const endTimer = telemetryFlushDuration.startTimer();

    try {
      const { records, rawCount } = await readTelemetryBatch(FLUSH_BATCH_LIMIT);
      if (rawCount === 0) return;

      if (records.length === 0) {
        await ackTelemetryBatch(rawCount);
        return;
      }

      const result = await flushToDatabase(records);
      if (!result.ok) {
        log.error({ error: result.error, retained: rawCount }, 'telemetry flush failed; records retained for retry');
        return;
      }

      await ackTelemetryBatch(rawCount);
      telemetryRecordsFlushedTotal.inc(result.insertedCount ?? records.length);
      telemetryFlushBatchSize.observe(records.length);
      log.info({ flushed: records.length }, 'flushed buffered records to database worker');
    } finally {
      flushInProgress = false;
      endTimer();
    }
  })();
}, FLUSH_INTERVAL_MS);

const sockets = new Set<net.Socket>();

const tcpServer = net.createServer((socket) => {
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  const connectedAt = process.hrtime.bigint();

  sockets.add(socket);
  tcpConnectionsTotal.inc();
  recordActiveDevices(1);
  socket.once('close', () => {
    sockets.delete(socket);
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
const httpServer = setupServer(API_PORT, () => log.info({ port: API_PORT }, 'API server listening'));
const metricsServer = setupMetricsServer(METRICS_PORT, () => log.info({ port: METRICS_PORT }, 'metrics server listening'));

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutting down');

  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
  await httpServer.stop();
  await metricsServer.stop();

  await workerPool.shutdown();
  await closeTelemetryBuffer();
  await dbWorker.terminate();

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
