import type { Filter } from 'mongodb';
import {
  USER_CACHE,
  USER_CACHE_TTL_SECONDS,
  getCollection,
  invalidateUserCache,
  normalizeDateValues,
  trackMongoOperation,
  userCacheKey,
  STRIPE_EVENTS_COLLECTION,
  USERS_COLLECTION
} from './internal';

import type {
  User, UserRole
} from '@common';
import { cacheGet, cacheSet } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export async function createUser(user: User) {
  const users = await getCollection('users');
  const normalizedUser = normalizeDateValues(user);
  trackMongoOperation('insertOne', USERS_COLLECTION);
  await users.insertOne(normalizedUser);
  return normalizedUser;
}


export async function deleteUser(uuid: string) {
  const users = await getCollection('users');
  trackMongoOperation('deleteOne', USERS_COLLECTION);
  await users.deleteOne({ uuid });
  await invalidateUserCache(uuid);
  await invalidateAuthEntries();
}


export async function getUserFromUuid(uuid: string) {
  const cached = await cacheGet<User>(USER_CACHE, userCacheKey(uuid));
  if (cached) return cached;

  const users = await getCollection('users');
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid }, { projection: { _id: 0 } });
  if (user) {
    await cacheSet(USER_CACHE, userCacheKey(uuid), user, USER_CACHE_TTL_SECONDS);
  }
  return user;
}


export async function getUserByEmail(email: string) {
  const users = await getCollection('users');
  trackMongoOperation('findOne', USERS_COLLECTION);
  return users.findOne({ email }, { projection: { _id: 0 } });
}

export async function getUserFromUsername(username: string) {
  const users = await getCollection('users');
  trackMongoOperation('findOne', USERS_COLLECTION);
  return users.findOne({ username }, { projection: { _id: 0 } });
}


export async function getUsers() {
  const users = await getCollection('users');
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
  const users = await getCollection('users');
  const query = buildUserListQuery(filter);
  let cursor = users.find(query).sort({ createdAt: -1 });

  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);

  trackMongoOperation('find', USERS_COLLECTION);
  return cursor.toArray();
}


export async function countUsers(filter: UserListFilter = {}) {
  const users = await getCollection('users');
  trackMongoOperation('countDocuments', USERS_COLLECTION);
  return users.countDocuments(buildUserListQuery(filter));
}


export async function getUsersByRole(role: UserRole) {
  const users = await getCollection('users');
  trackMongoOperation('find', USERS_COLLECTION);
  return users.find({ role }).sort({ createdAt: -1 }).toArray();
}


export async function getUserCount() {
  const users = await getCollection('users');
  trackMongoOperation('countDocuments', USERS_COLLECTION);
  return users.countDocuments({});
}


export async function updateUser(user: User, unsetKeys: string[] = []) {
  const users = await getCollection('users');
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
  const users = await getCollection('users');
  trackMongoOperation('findOne', USERS_COLLECTION);
  const user = await users.findOne({ uuid: userUuid }, { projection: { _id: 0, gameBests: 1 } });
  return (user?.gameBests as Record<string, unknown> | undefined) ?? {};
}

export async function updateGameBest(userUuid: string, game: 'memory' | 'minesweeper', value: number) {
  const users = await getCollection('users');
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
  const users = await getCollection('users');
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid }, { $set: { lastActive: when } });
  // Hot path (once per user per minute): refresh only that user's cached copy,
  // never the global auth generation.
  await invalidateUserCache(uuid);
}




export async function updateUserRole(userUuid: string, role: UserRole) {
  const users = await getCollection('users');
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


export async function recordStripeEvent(eventId: string, type: string) {
  const stripeEvents = await getCollection('stripeEvents');
  trackMongoOperation('updateOne', STRIPE_EVENTS_COLLECTION);

  const result = await stripeEvents.updateOne(
    { id: eventId },
    { $setOnInsert: { id: eventId, type, createdAt: new Date() } },
    { upsert: true }
  );

  return result.upsertedCount > 0;
}

export async function hasStripeEvent(eventId: string): Promise<boolean> {
  const stripeEvents = await getCollection('stripeEvents');
  trackMongoOperation('findOne', STRIPE_EVENTS_COLLECTION);
  const existing = await stripeEvents.findOne({ id: eventId }, { projection: { _id: 1 } });
  return existing !== null;
}
