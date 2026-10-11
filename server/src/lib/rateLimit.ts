import { createLogger } from './logger';

const log = createLogger('rate-limit');

export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const CLEANUP_INTERVAL_MS = 60_000;

export function createRateLimiter(windowMs: number, max: number): RateLimiter {
  const buckets = new Map<string, Bucket>();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);

  cleanup.unref?.();

  return {
    check(key: string): RateLimitResult {
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
    },
  };
}

export function tooManyRequests(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  log.warn({ retryAfterSeconds }, 'rate limit exceeded');

  return Response.json(
    { error: 'Too many requests, please try again later' },
    { status: 429, headers: { 'Retry-After': retryAfterSeconds.toString() } },
  );
}
