import { createClient, type RedisClientType } from 'redis';
import { createLogger } from './logger';
import type { TelemetryRecord } from './telemetry';

const log = createLogger('redis-buffer');
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_BUFFER_KEY = process.env.REDIS_BUFFER_KEY || 'ayphr:telemetry:buffer';

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
  } catch (error) {
    log.error({ error }, 'failed to enqueue telemetry record');
  }
}

export async function drainTelemetryBuffer() {
  try {
    const redis = await getClient();
    const rawRecords = (await redis.eval(drainScript, {
      keys: [REDIS_BUFFER_KEY]
    })) as string[] | null;

    return (rawRecords || []).map(parseRecord);
  } catch (error) {
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
