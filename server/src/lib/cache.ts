import { redisDel, redisGet, redisIncr, redisSet } from './redis';
import { cacheOperationsTotal } from './metrics';

export function encodeCacheValue(value: unknown): string {
  return JSON.stringify(value, function replacer(this: unknown, key, currentValue) {
    const original = (this as Record<string, unknown>)[key];
    if (original instanceof Date) return { $d: original.getTime() };
    return currentValue;
  });
}

export function decodeCacheValue<T>(raw: string): T | null {
  try {
    return JSON.parse(raw, function reviver(_key, value) {
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.$d === 'number' &&
        Object.keys(value).length === 1
      ) {
        return new Date(value.$d);
      }
      return value;
    }) as T;
  } catch {
    return null;
  }
}

export async function cacheGet<T>(cache: string, key: string): Promise<T | null> {
  try {
    const raw = await redisGet(key);

    if (raw === null) {
      cacheOperationsTotal.inc({ cache, result: 'miss' });
      return null;
    }

    const value = decodeCacheValue<T>(raw);
    if (value === null) {
      cacheOperationsTotal.inc({ cache, result: 'miss' });
      return null;
    }

    cacheOperationsTotal.inc({ cache, result: 'hit' });
    return value;
  } catch {
    cacheOperationsTotal.inc({ cache, result: 'error' });
    return null;
  }
}

export async function cacheSet(cache: string, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redisSet(key, encodeCacheValue(value), ttlSeconds);
    cacheOperationsTotal.inc({ cache, result: 'set' });
  } catch {
    cacheOperationsTotal.inc({ cache, result: 'error' });
  }
}

export async function cacheDel(cache: string, ...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redisDel(...keys);
    cacheOperationsTotal.inc({ cache, result: 'del' });
  } catch {
    cacheOperationsTotal.inc({ cache, result: 'error' });
  }
}

export async function cacheIncr(cache: string, key: string): Promise<number | null> {
  try {
    const value = await redisIncr(key);
    cacheOperationsTotal.inc({ cache, result: 'set' });
    return value;
  } catch {
    cacheOperationsTotal.inc({ cache, result: 'error' });
    return null;
  }
}

export async function cacheReadCounter(cache: string, key: string, fallback: number): Promise<number | null> {
  try {
    const raw = await redisGet(key);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    cacheOperationsTotal.inc({ cache, result: 'error' });
    return null;
  }
}
