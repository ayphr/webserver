import type { PushSubscriptionInput } from '@common';
import {
  PUSH_SUBSCRIPTIONS_COLLECTION,
  getCollection,
  trackMongoOperation,
  type PushSubscriptionDocument,
} from './internal';

/** Bound storage so a single account cannot accumulate unlimited endpoints. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 20;

/** Repeated transient failures remove a stale endpoint; 404/410 removes it immediately. */
export const MAX_PUSH_SUBSCRIPTION_FAILURES = 5;

export async function listPushSubscriptions(userUuid: string): Promise<PushSubscriptionDocument[]> {
  const subscriptions = await getCollection('pushSubscriptions');
  trackMongoOperation('find', PUSH_SUBSCRIPTIONS_COLLECTION);
  return subscriptions
    .find({ userUuid })
    .project<PushSubscriptionDocument>({ _id: 0 })
    .toArray();
}

export async function countPushSubscriptions(userUuid: string): Promise<number> {
  const subscriptions = await getCollection('pushSubscriptions');
  trackMongoOperation('countDocuments', PUSH_SUBSCRIPTIONS_COLLECTION);
  return subscriptions.countDocuments({ userUuid });
}

/** One record per endpoint per user; subscribing again refreshes its keys. */
export async function savePushSubscription(
  userUuid: string,
  input: PushSubscriptionInput,
): Promise<void> {
  const subscriptions = await getCollection('pushSubscriptions');
  const now = new Date();
  trackMongoOperation('updateOne', PUSH_SUBSCRIPTIONS_COLLECTION);
  await subscriptions.updateOne(
    { userUuid, endpoint: input.endpoint },
    {
      $set: { keys: input.keys, updatedAt: now },
      $setOnInsert: {
        id: crypto.randomUUID(),
        userUuid,
        endpoint: input.endpoint,
        createdAt: now,
        failureCount: 0,
      },
    },
    { upsert: true },
  );
}

export async function deletePushSubscription(userUuid: string, endpoint: string): Promise<boolean> {
  const subscriptions = await getCollection('pushSubscriptions');
  trackMongoOperation('deleteOne', PUSH_SUBSCRIPTIONS_COLLECTION);
  const result = await subscriptions.deleteOne({ userUuid, endpoint });
  return result.deletedCount > 0;
}

export async function deleteAllPushSubscriptions(userUuid: string): Promise<number> {
  const subscriptions = await getCollection('pushSubscriptions');
  trackMongoOperation('deleteMany', PUSH_SUBSCRIPTIONS_COLLECTION);
  const result = await subscriptions.deleteMany({ userUuid });
  return result.deletedCount;
}

/** Used during account deletion and when a push service reports a dead endpoint. */
export async function deletePushSubscriptionsForUserUuid(userUuid: string): Promise<void> {
  await deleteAllPushSubscriptions(userUuid);
}

/**
 * Removes permanently invalid endpoints (404/410) right away and retires
 * endpoints that keep failing after several transient errors.
 */
export async function recordPushSubscriptionFailure(
  userUuid: string,
  endpoint: string,
  permanent = false,
): Promise<void> {
  if (permanent) {
    await deletePushSubscription(userUuid, endpoint);
    return;
  }

  const subscriptions = await getCollection('pushSubscriptions');
  trackMongoOperation('findOneAndUpdate', PUSH_SUBSCRIPTIONS_COLLECTION);
  const result = await subscriptions.findOneAndUpdate(
    { userUuid, endpoint },
    { $inc: { failureCount: 1 } },
    { returnDocument: 'after', projection: { _id: 0, failureCount: 1 } },
  );

  if ((result?.failureCount ?? 0) >= MAX_PUSH_SUBSCRIPTION_FAILURES) {
    await deletePushSubscription(userUuid, endpoint);
  }
}
