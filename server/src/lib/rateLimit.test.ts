import { describe, expect, test } from 'bun:test';
import { createRateLimiter, tooManyRequests } from './rateLimit';

describe('rateLimit', () => {
  test('allows up to max then blocks (local fallback)', async () => {
    // REDIS_URL unset in tests, so it falls back to in-memory buckets
    const limiter = createRateLimiter(60_000, 2, 'test');
    const r1 = await limiter.check('key');
    const r2 = await limiter.check('key');
    const r3 = await limiter.check('key');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterMs).toBeGreaterThan(0);
  });

  test('separate keys are independent', async () => {
    const limiter = createRateLimiter(60_000, 1, 'test2');
    expect((await limiter.check('a')).allowed).toBe(true);
    expect((await limiter.check('b')).allowed).toBe(true);
    expect((await limiter.check('a')).allowed).toBe(false);
  });

  test('tooManyRequests returns 429 with Retry-After', () => {
    const res = tooManyRequests(1500);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('2');
  });
});