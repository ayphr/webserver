import { collections } from './mongoLifecycle';
import { trackMongoOperation } from './internal';
import { isDuplicateKeyError } from '../http';

/**
 * Shared fixed-window counter for deployments where Redis is unavailable.
 * Buckets are keyed by window start so expiry never needs a reset, and denied
 * requests are not counted because the update is guarded by `count < max`.
 */
export async function mongoFixedWindow(
  key: string,
  windowMs: number,
  max: number,
): Promise<{ count: number; retryAfterMs: number }> {
  // Only use Mongo when the server has already connected. Calling connect()
  // here would make every rate-limit check wait on a database handshake when
  // Mongo is unavailable.
  const collection = collections?.rateLimits;
  if (!collection) throw new Error('mongodb unavailable for rate limits');

  const now = new Date();
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const bucketId = `${key}:${windowStart}`;
  const resetAt = new Date(windowStart + windowMs);
  // Keep expired buckets briefly so TTL cleanup cannot race an in-flight check.
  const expiresAt = new Date(resetAt.getTime() + 60_000);

  let bucket = null;
  try {
    trackMongoOperation('findOneAndUpdate', 'rate_limits');
    bucket = await collection.findOneAndUpdate(
      { _id: bucketId, count: { $lt: max } },
      {
        $inc: { count: 1 },
        $setOnInsert: { createdAt: now, resetAt, expiresAt },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    // A denied check does not match the filter, so Mongo attempts an upsert
    // with the same _id. Read the existing bucket instead of treating it as an
    // infrastructure failure.
    if (!isDuplicateKeyError(error)) throw error;
  }

  if (!bucket) {
    trackMongoOperation('findOne', 'rate_limits');
    bucket = await collection.findOne({ _id: bucketId });
  }
  if (!bucket) throw new Error('rate limit bucket missing after update');

  return {
    count: bucket.count,
    retryAfterMs: Math.max(1, bucket.resetAt.getTime() - Date.now()),
  };
}
