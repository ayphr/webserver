import { createLogger } from './logger';
import { redisFixedWindow } from './redis';
import { mongoFixedWindow } from './db/rateLimits';
import { rateLimitBackendTotal, rateLimitChecksTotal } from './metrics';

const log = createLogger('rate-limit');

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

export type RateLimiter = {
  check: (key: string) => Promise<RateLimitResult>;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const CLEANUP_INTERVAL_MS = 60_000;

const NAMESPACE = 'ayphr:cache:ratelimit';

export function createRateLimiter(windowMs: number, max: number, name = 'default'): RateLimiter {
  const buckets = new Map<string, Bucket>();
  // Include the limiter name so unrelated routes with the same window and
  // threshold never share a Redis bucket.
  const prefix = `${NAMESPACE}:${name}:${windowMs}:${max}`;

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);

  cleanup.unref?.();

  function checkLocal(key: string): RateLimitResult {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (bucket.count >= max) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }

    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    async check(key: string): Promise<RateLimitResult> {
      let result: RateLimitResult;
      let backend: 'redis' | 'mongo' | 'memory' = 'memory';

      try {
        const { count, retryAfterMs } = await redisFixedWindow(`${prefix}:${key}`, windowMs);
        backend = 'redis';
        result = count > max
          ? { allowed: false, retryAfterMs }
          : { allowed: true, retryAfterMs: 0 };
      } catch {
        try {
          const { count, retryAfterMs } = await mongoFixedWindow(`${prefix}:${key}`, windowMs, max);
          backend = 'mongo';
          result = count > max
            ? { allowed: false, retryAfterMs }
            : { allowed: true, retryAfterMs: 0 };
        } catch {
          result = checkLocal(key);
        }
      }

      rateLimitChecksTotal.inc({ limiter: name, result: result.allowed ? 'allowed' : 'blocked' });
      rateLimitBackendTotal.inc({ limiter: name, backend });
      return result;
    },
  };
}

export function tooManyRequests(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  log.warn({ retryAfterSeconds }, 'rate limit exceeded');

  const body = JSON.stringify({
    error: 'Too many requests, please try again later',
    retryAfterSeconds,
  });
  return new Response(body, {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
      'Retry-After': retryAfterSeconds.toString(),
    },
  });
}
