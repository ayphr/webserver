import Redis from 'ioredis';
import { REDIS_URL } from '../env';
import { createLogger } from './logger';

const log = createLogger('redis');

const COMMAND_TIMEOUT_MS = 1_000;

let client: Redis | null = null;
let connecting = false;
let closed = false;

export function getRedis(): Redis | null {
  if (closed || !REDIS_URL) return null;

  if (!client) {
    if (connecting) return null;
    connecting = true;

    client = new Redis(REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS,
      connectTimeout: COMMAND_TIMEOUT_MS,
      retryStrategy: (times) => Math.min(30_000, 200 * 2 ** Math.min(times, 8)),
    });

    client.on('ready', () => {
      connecting = false;
      log.info({}, 'connected');
    });
    client.on('error', (error) => {
      connecting = false;
      // Logged once per disconnect; ioredis retries on its own schedule.
      log.warn({ error }, 'connection error (requests fall back to MongoDB)');
    });
    client.on('end', () => {
      connecting = false;
    });
  }

  return client;
}

export async function redisGet(key: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) throw new Error('redis unavailable');
  return redis.get(key);
}

export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) throw new Error('redis unavailable');
  await redis.set(key, value, 'EX', ttlSeconds);
}

export async function redisDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const redis = getRedis();
  if (!redis) throw new Error('redis unavailable');
  await redis.del(...keys);
}

export async function redisIncr(key: string): Promise<number> {
  const redis = getRedis();
  if (!redis) throw new Error('redis unavailable');
  return redis.incr(key);
}

export async function redisFixedWindow(
  key: string,
  windowMs: number,
): Promise<{ count: number; retryAfterMs: number }> {
  const redis = getRedis();
  if (!redis) throw new Error('redis unavailable');

  const result = (await redis.eval(
    `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('PTTL', KEYS[1])
    return {count, ttl}
    `,
    1,
    key,
    String(windowMs),
  )) as [number, number];

  const [count, ttl] = result;
  return {
    count,
    retryAfterMs: ttl > 0 ? ttl : windowMs,
  };
}

/** Closes the connection during graceful shutdown. Safe to call more than once. */
export async function closeRedis(): Promise<void> {
  closed = true;
  const redis = client;
  client = null;
  if (!redis) return;

  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
