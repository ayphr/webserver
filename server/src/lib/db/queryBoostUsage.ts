import { isDuplicateKeyError } from '../http';
import { collections } from './mongoLifecycle';
import { trackMongoOperation } from './internal';

type QueryBoostBucket = {
  count: number;
  resetAt: Date;
  expiresAt: Date;
};

export type QueryBoostUsageResult = {
  allowed: boolean;
  resetAt: Date;
};

/** Calendar-month bucket ID, kept separate from short-lived request rate limits. */
export const queryBoostBucketId = (userUuid: string, now: Date = new Date()): string =>
  `ayphr:query-boost:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}:${userUuid}`;

/**
 * Atomically consumes one monthly Boost query allowance for a user. The plan
 * limit is passed in because team seats change the effective allowance.
 */
export async function consumeQueryBoostAllowance(
  userUuid: string,
  limit: number,
  now: Date = new Date(),
): Promise<QueryBoostUsageResult> {
  const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: false, resetAt };
  }

  const collection = collections?.rateLimits;
  if (!collection) throw new Error('mongodb unavailable for query boost limits');

  const bucketId = queryBoostBucketId(userUuid, now);
  const expiresAt = new Date(resetAt.getTime() + 60_000);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      trackMongoOperation('findOneAndUpdate', 'rate_limits');
      const bucket = await collection.findOneAndUpdate(
        { _id: bucketId, count: { $lt: limit } },
        {
          $inc: { count: 1 },
          $setOnInsert: { createdAt: now, resetAt, expiresAt },
          $set: { updatedAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      ) as QueryBoostBucket | null;
      if (bucket) return { allowed: true, resetAt };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }

    // A duplicate-key error means another request inserted the bucket first.
    // Read it once; deny only when its count has reached the plan limit.
    trackMongoOperation('findOne', 'rate_limits');
    const existing = await collection.findOne({ _id: bucketId }) as QueryBoostBucket | null;
    if (!existing || existing.count >= limit) {
      return { allowed: false, resetAt };
    }
  }

  throw new Error('query boost allowance could not be consumed');
}
