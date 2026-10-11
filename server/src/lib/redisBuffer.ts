import { createClient, type RedisClientType } from 'redis';
import { createLogger } from './logger';
import {
  telemetryBufferLength,
  telemetryDrainErrorsTotal,
  telemetryEnqueueErrorsTotal,
  telemetryRecordsBufferedTotal,
} from './metrics';
import type { TelemetryRecord } from './telemetry';
import { REDIS_BUFFER_KEY, REDIS_URL } from '../env';

const log = createLogger('redis-buffer');

const MAX_BUFFER_LENGTH = 100_000;

let client: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

function attachClientHandlers(instance: RedisClientType) {
  instance.on('error', (error) => {
    log.error({ error }, 'redis client error');
  });
}

async function getClient() {
  if (client?.isOpen) return client;

  if (!connectPromise) {
    client = createClient({ url: REDIS_URL });
    attachClientHandlers(client);
    connectPromise = client.connect()
      .then(() => client!)
      .catch((error) => {
        // Reset so the next caller retries instead of reusing a poisoned promise.
        connectPromise = null;
        client = null;
        throw error;
      });
  }

  return connectPromise;
}

function parseRecord(payload: string): TelemetryRecord {
  const record = JSON.parse(payload) as Omit<TelemetryRecord, 'timestamp'> & { timestamp: string };
  return {
    ...record,
    timestamp: new Date(record.timestamp),
  };
}

export async function enqueueTelemetryRecord(record: TelemetryRecord) {
  try {
    const redis = await getClient();
    await redis.rPush(REDIS_BUFFER_KEY, JSON.stringify(record));
    await redis.lTrim(REDIS_BUFFER_KEY, -MAX_BUFFER_LENGTH, -1);
    telemetryRecordsBufferedTotal.inc();
  } catch (error) {
    telemetryEnqueueErrorsTotal.inc();
    log.error({ error }, 'failed to enqueue telemetry record');
  }
}

export type TelemetryBatch = {
  records: TelemetryRecord[];
  rawCount: number;
};

export async function readTelemetryBatch(limit: number): Promise<TelemetryBatch> {
  try {
    const redis = await getClient();
    const rawRecords = (await redis.lRange(REDIS_BUFFER_KEY, 0, limit - 1)) as string[];

    const records: TelemetryRecord[] = [];
    for (const payload of rawRecords) {
      try {
        records.push(parseRecord(payload));
      } catch (error) {
        log.warn({ error, payload }, 'skipping malformed telemetry record');
      }
    }

    telemetryBufferLength.set(rawRecords.length);

    return { records, rawCount: rawRecords.length };
  } catch (error) {
    telemetryDrainErrorsTotal.inc();
    log.error({ error }, 'failed to read telemetry buffer');
    return { records: [], rawCount: 0 };
  }
}

export async function ackTelemetryBatch(count: number) {
  if (count <= 0) return;

  try {
    const redis = await getClient();
    await redis.lTrim(REDIS_BUFFER_KEY, count, -1);
    telemetryBufferLength.set(0);
  } catch (error) {
    telemetryDrainErrorsTotal.inc();
    log.error({ error }, 'failed to acknowledge telemetry batch');
  }
}

export async function closeTelemetryBuffer() {
  if (!client?.isOpen) return;

  await client.quit();
  client = null;
  connectPromise = null;
}
