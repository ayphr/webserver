/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Filter } from 'mongodb';
import * as internal from './internal';
import type { Collections, DataPointDocument, DeviceClaim, DeviceDocument, StoredAvatar } from './internal';
const {
  USER_CACHE,
  USER_CACHE_TTL_SECONDS,
  getCols,
  invalidateUserCache,
  normalizeDateValues,
  trackMongoOperation,
  userCacheKey,
  STRIPE_EVENTS_COLLECTION,
  USERS_COLLECTION
} = internal;

import type {
  DataPoint, Device, Punishment, Session, User, UserRole, AttachedSubscription, PaidSubscription, App, OAuthAuthorizationCode, OAuthAccessToken, Connection, UserCredits
} from '@common';
import { cacheDel, cacheGet, cacheSet, cacheIncr, cacheReadCounter } from '../cache';
import { invalidateAuthEntries } from '../authCache';
import { deletePunishmentsForUserUuid } from './punishments';
import { deleteDevicesForOwnerUuid } from './devices';
import { deleteSessionsForUserUuid } from './sessions';
import { deleteAvatar } from './avatars';

export async function createUser(user: User) {
  const { users } = await getCols();
  const normalizedUser = normalizeDateValues(user);
  trackMongoOperation('insertOne', USERS_COLLECTION);
  await users.insertOne(normalizedUser);
  return normalizedUser;
}


export async function deleteUser(uuid: string) {
  const { users } = await getCols();
  trackMongoOperation('deleteOne', USERS_COLLECTION);
  await users.deleteOne({ uuid });
  await invalidateUserCache(uuid);
  await invalidateAuthEntries();
}


export async function getUserFromUuid(uuid: string) {
  const cached = await cacheGet<User>(USER_CACHE, userCacheKey(uuid));
  if (cached) return cached;

  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid }, { projection: { _id: 0 } });
  if (user) {
    await cacheSet(USER_CACHE, userCacheKey(uuid), user, USER_CACHE_TTL_SECONDS);
  }
  return user;
}


export async function getUserFromUsername(username: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  return users.findOne({ username }, { projection: { _id: 0 } });
}


export async function getUsers() {
  const { users } = await getCols();
  trackMongoOperation('find', USERS_COLLECTION);
  return users.find({}).sort({ createdAt: -1 }).toArray();
}


export type UserListFilter = {
  search?: string;
  role?: UserRole;
};


export type UserListOptions = {
  skip?: number;
  limit?: number;
};

function buildUserListQuery(filter: UserListFilter): Filter<User> {
  const query: Filter<User> = {};

  if (filter.role) {
    query.role = filter.role;
  }

  const search = filter.search?.trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    query.$or = [{ username: regex }, { uuid: regex }];
  }

  return query;
}


export async function listUsers(filter: UserListFilter = {}, options: UserListOptions = {}) {
  const { users } = await getCols();
  const query = buildUserListQuery(filter);
  let cursor = users.find(query).sort({ createdAt: -1 });

  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);

  trackMongoOperation('find', USERS_COLLECTION);
  return cursor.toArray();
}


export async function countUsers(filter: UserListFilter = {}) {
  const { users } = await getCols();
  trackMongoOperation('countDocuments', USERS_COLLECTION);
  return users.countDocuments(buildUserListQuery(filter));
}


export async function getUsersByRole(role: UserRole) {
  const { users } = await getCols();
  trackMongoOperation('find', USERS_COLLECTION);
  return users.find({ role }).sort({ createdAt: -1 }).toArray();
}


export async function getUserCount() {
  const { users } = await getCols();
  trackMongoOperation('countDocuments', USERS_COLLECTION);
  return users.countDocuments({});
}


export async function updateUser(user: User, unsetKeys: string[] = []) {
  const { users } = await getCols();
  const normalizedUser = normalizeDateValues(user);
  // Mongo documents carry an immutable `_id`; including it in $set makes the
  // update fail with "would modify the immutable field '_id'".
  const settableFields: Record<string, unknown> = { ...normalizedUser };
  delete settableFields._id;
  const update: Record<string, unknown> = { $set: settableFields };

  if (unsetKeys.length > 0) {
    update.$unset = Object.fromEntries(unsetKeys.map((key) => [key, '']));
  }

  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid: user.uuid }, update);
  // Profile/role/password mutations must be visible to every instance at once.
  await invalidateUserCache(user.uuid);
  await invalidateAuthEntries();
  return normalizedUser;
}


export async function getGameBests(userUuid: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid: userUuid }, { projection: { _id: 0, gameBests: 1 } });
  return (user?.gameBests as Record<string, unknown> | undefined) ?? {};
}

export async function updateGameBest(userUuid: string, game: 'memory' | 'minesweeper', value: number) {
  const { users } = await getCols();
  trackMongoOperation('findOneAndUpdate', USERS_COLLECTION);
  const result = await users.findOneAndUpdate(
    {
      uuid: userUuid,
      $or: [
        { [`gameBests.${game}`]: { $exists: false } },
        { [`gameBests.${game}.value`]: { $gt: value } },
      ],
    },
    { $set: { [`gameBests.${game}`]: { value, achievedAt: new Date() } } },
    { returnDocument: 'after', projection: { _id: 0, gameBests: 1 } },
  );
  const updated = result !== null;
  const bests = (result?.gameBests as Record<string, unknown> | undefined) ?? (await getGameBests(userUuid));
  if (updated) {
    await invalidateUserCache(userUuid);
    await invalidateAuthEntries();
  }
  return { updated, bests };
}

export async function updateUserLastActive(uuid: string, when: Date) {
  const { users } = await getCols();
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid }, { $set: { lastActive: when } });
  // Hot path (once per user per minute): refresh only that user's cached copy,
  // never the global auth generation.
  await invalidateUserCache(uuid);
}


export async function updateUserCredits(userUuid: string, credits: UserCredits) {
  const { users } = await getCols();
  const normalizedCredits = normalizeDateValues(credits);

  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid: userUuid }, { $set: { credits: normalizedCredits } });

  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();

  return normalizedCredits;
}


export async function updateUserRole(userUuid: string, role: UserRole) {
  const { users } = await getCols();
  trackMongoOperation('findOneAndUpdate', USERS_COLLECTION);
  const result = await users.findOneAndUpdate(
    { uuid: userUuid },
    { $set: { role } },
    { returnDocument: 'after' }
  );
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
  return result;
}


export async function getPaidSubscriptionsForUserUuid(userUuid: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid: userUuid }, { projection: { paidSubscriptions: 1 } });
  return user?.paidSubscriptions ?? [];
}


export async function getAttachedSubscriptionsForUserUuid(userUuid: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid: userUuid }, { projection: { attachedSubscriptions: 1 } });
  return user?.attachedSubscriptions ?? [];
}


export async function getUserUuidByStripeCustomerId(stripeCustomerId: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne(
    { stripeCustomerId },
    { projection: { uuid: 1 } }
  );
  return user?.uuid ?? null;
}


export async function getUserByStripeCustomerId(stripeCustomerId: string) {
  const { users } = await getCols();
  trackMongoOperation('findOne', USERS_COLLECTION);
  return users.findOne({ stripeCustomerId });
}


export async function setUserStripeCustomerId(userUuid: string, stripeCustomerId: string) {
  const { users } = await getCols();
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid: userUuid }, { $set: { stripeCustomerId } });
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}


export async function recordStripeEvent(eventId: string, type: string) {
  const { stripeEvents } = await getCols();
  trackMongoOperation('updateOne', STRIPE_EVENTS_COLLECTION);

  const result = await stripeEvents.updateOne(
    { id: eventId },
    { $setOnInsert: { id: eventId, type, createdAt: new Date() } },
    { upsert: true }
  );

  return result.upsertedCount > 0;
}


export async function upsertPaidSubscription(userUuid: string, subscription: PaidSubscription) {
  const { users } = await getCols();
  const normalizedSubscription = normalizeDateValues(subscription);

  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne(
    { uuid: userUuid },
    { $pull: { paidSubscriptions: { stripeSubscriptionId: subscription.stripeSubscriptionId } } }
  );

  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne(
    { uuid: userUuid },
    { $push: { paidSubscriptions: normalizedSubscription } }
  );

  await invalidateUserCache(userUuid);

  return normalizedSubscription;
}


export async function removePaidSubscription(userUuid: string, stripeSubscriptionId: string) {
  const { users } = await getCols();
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne(
    { uuid: userUuid },
    { $pull: { paidSubscriptions: { stripeSubscriptionId } } }
  );
  await invalidateUserCache(userUuid);
}


export async function addAttachedSubscription(userUuid: string, subscription: AttachedSubscription) {
  const { users } = await getCols();
  const normalizedSubscription = normalizeDateValues(subscription);

  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne(
    { uuid: userUuid },
    { $push: { attachedSubscriptions: normalizedSubscription } }
  );

  await invalidateUserCache(userUuid);

  return normalizedSubscription;
}


export async function removeAttachedSubscription(userUuid: string, subscriptionId: string) {
  const { users } = await getCols();
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne(
    { uuid: userUuid },
    { $pull: { attachedSubscriptions: { id: subscriptionId } } }
  );
  await invalidateUserCache(userUuid);
}


export async function updateAttachedSubscription(userUuid: string, subscription: AttachedSubscription) {
  const { users } = await getCols();
  const normalizedSubscription = normalizeDateValues(subscription);

  trackMongoOperation('updateOne', USERS_COLLECTION);
  const result = await users.updateOne(
    {
      uuid: userUuid,
      'attachedSubscriptions.id': subscription.id,
    },
    { $set: { 'attachedSubscriptions.$': normalizedSubscription } }
  );

  if (result.matchedCount > 0) {
    await invalidateUserCache(userUuid);
    return normalizedSubscription;
  }

  return null;
}


