import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Bucket = {
  _id: string;
  count: number;
  resetAt: Date;
  expiresAt: Date;
};

const buckets = new Map<string, Bucket>();

const collection = {
  findOneAndUpdate: async (
    filter: { _id: string; count: { $lt: number } },
    update: { $inc: { count: number }; $setOnInsert: Omit<Bucket, '_id' | 'count'>; $set: { updatedAt: Date } },
  ) => {
    const existing = buckets.get(filter._id);
    if (existing && existing.count >= filter.count.$lt) {
      throw Object.assign(new Error('duplicate key'), { code: 11000 });
    }
    const next: Bucket = existing
      ? { ...existing, count: existing.count + update.$inc.count }
      : {
          _id: filter._id,
          count: update.$inc.count,
          ...update.$setOnInsert,
        };
    buckets.set(filter._id, next);
    return next;
  },
  findOne: async (filter: { _id: string }) => buckets.get(filter._id) ?? null,
};

mock.module('./mongoLifecycle', () => ({
  collections: { rateLimits: collection },
}));
mock.module('./internal', () => ({
  trackMongoOperation: () => {},
}));

const { consumeQueryBoostAllowance, queryBoostBucketId } = await import('./queryBoostUsage');

describe('consumeQueryBoostAllowance', () => {
  beforeEach(() => buckets.clear());

  it('denies Boost outright when the plan limit is zero', async () => {
    const result = await consumeQueryBoostAllowance('user-1', 0);
    expect(result.allowed).toBe(false);
    expect(buckets.size).toBe(0);
  });

  it('allows requests up to the monthly limit and denies the next', async () => {
    const now = new Date('2026-11-15T12:00:00.000Z');
    expect((await consumeQueryBoostAllowance('user-1', 2, now)).allowed).toBe(true);
    expect((await consumeQueryBoostAllowance('user-1', 2, now)).allowed).toBe(true);
    expect((await consumeQueryBoostAllowance('user-1', 2, now)).allowed).toBe(false);

    const bucket = buckets.get(queryBoostBucketId('user-1', now));
    expect(bucket?.count).toBe(2);
    expect(bucket?.resetAt.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('uses a fresh bucket next month', async () => {
    const november = new Date('2026-11-30T23:59:00.000Z');
    const december = new Date('2026-12-01T00:01:00.000Z');

    expect((await consumeQueryBoostAllowance('user-1', 1, november)).allowed).toBe(true);
    expect((await consumeQueryBoostAllowance('user-1', 1, november)).allowed).toBe(false);
    expect((await consumeQueryBoostAllowance('user-1', 1, december)).allowed).toBe(true);
  });
});
