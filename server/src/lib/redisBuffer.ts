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

const drainScript = `
  local items = redis.call('LRANGE', KEYS[1], 0, -1)
  if #items > 0 then
    redis.call('DEL', KEYS[1])
  end
  return items
`;

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
    connectPromise = client.connect().then(() => client!);
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
    telemetryRecordsBufferedTotal.inc();
  } catch (error) {
    telemetryEnqueueErrorsTotal.inc();
    log.error({ error }, 'failed to enqueue telemetry record');
  }
}

export async function drainTelemetryBuffer() {
  try {
    const redis = await getClient();
    const rawRecords = (await redis.eval(drainScript, {
      keys: [REDIS_BUFFER_KEY]
    })) as string[] | null;

    const records = (rawRecords || []).map(parseRecord);

    // The script drains atomically, so this is the backlog depth that built up
    // since the previous flush. Non-zero over time means the sink is behind.
    telemetryBufferLength.set(records.length);

    return records;
  } catch (error) {
    telemetryDrainErrorsTotal.inc();
    log.error({ error }, 'failed to drain telemetry buffer');
    return [];
  }
}

export async function closeTelemetryBuffer() {
  if (!client?.isOpen) return;

  await client.quit();
  client = null;
  connectPromise = null;
}
