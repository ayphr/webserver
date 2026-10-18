import { Binary, Collection, Db, MongoClient, type Filter } from 'mongodb';
import { createLogger } from './logger';
import { recordMongoOperation, sessionsTotal } from './metrics';
import { type DataPoint, type Device, type Punishment, type Session, type User, type UserRole, type AttachedSubscription, type PaidSubscription } from '@common';
import {
  DATA_POINTS_COLLECTION,
  USERS_COLLECTION,
  PUNISHMENTS_COLLECTION,
  DEVICES_COLLECTION,
  DEVICE_CLAIMS_COLLECTION,
  SESSIONS_COLLECTION,
  STRIPE_EVENTS_COLLECTION,
  AVATARS_COLLECTION,
  MONGO_URI,
  MONGO_DB_NAME,
  MONGO_MAX_POOL_SIZE
} from '../env';
import { cacheDel, cacheGet, cacheSet } from './cache';
import { invalidateAuthEntries } from './authCache';

const log = createLogger('db');

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** A data point as stored, keyed by device serial and timestamp. */
export type DataPointDocument = DataPoint & {
  deviceSerial: number;
};

/** A device as stored, including the secret token hash that is never exposed. */
export type DeviceDocument = Device & {
  tokenHash: string;
  tokenCreatedAt: Date;
};

/**
 * A one-time token generated from the dashboard so a device can claim itself on
 * first upload. Only one claim may be pending per account at a time.
 */
export type DeviceClaim = {
  ownerUuid: string;
  ownerUsername: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
};

let client: MongoClient | null = null;
let database: Db | null = null;
let connectPromise: Promise<Db> | null = null;

interface Collections {
  dataPoints: Collection<DataPointDocument>;
  users: Collection<User>;
  punishments: Collection<Punishment>;
  devices: Collection<DeviceDocument>;
  deviceClaims: Collection<DeviceClaim>;
  sessions: Collection<Session>;
  stripeEvents: Collection<{ id: string; type: string; createdAt: Date }>;
  avatars: Collection<StoredAvatar>;
}

export interface StoredAvatar {
  userUuid: string;
  contentType: string;
  size: number;
  updatedAt: Date;
  data: Binary;
}

let collections: Collections | null = null;

function trackMongoOperation(operation: string, collection: string) {
  recordMongoOperation(operation, collection);
}

// ---------------------------------------------------------------------------
// Redis cache integration.
//
// Reads are cache-through: Redis first, MongoDB on a miss. Every write path in
// this module invalidates or refreshes the keys it affects. All cache helpers
// are fail-soft, so a Redis outage degrades to uncached MongoDB access.
// ---------------------------------------------------------------------------

const USER_CACHE = 'user';
const USER_CACHE_TTL_SECONDS = 60;

const SUSPENSION_CACHE = 'suspension';
const SUSPENSION_CACHE_TTL_SECONDS = 15;

const DEVICE_CACHE = 'device';
const DEVICE_CACHE_TTL_SECONDS = 60;
const DEVICE_NEGATIVE_TTL_SECONDS = 5;

const DEVICE_LIST_CACHE = 'device_list';
const DEVICE_LIST_CACHE_TTL_SECONDS = 30;

const DEVICE_STATS_CACHE = 'device_stats';
const DEVICE_STATS_CACHE_TTL_SECONDS = 30;

/** Sentinel cached in place of a null result so negative lookups are cached too. */
const NONE = 'none';

const userCacheKey = (uuid: string) => `user:${uuid}`;
const suspensionCacheKey = (uuid: string) => `suspension:${uuid}`;
const deviceCacheKey = (serial: number) => `device:${serial}`;
const deviceListCacheKey = (ownerUuid: string) => `device_list:${ownerUuid}`;
const deviceStatsCacheKey = (ownerUuid: string) => `device_stats:${ownerUuid}`;

async function invalidateUserCache(uuid: string): Promise<void> {
  await cacheDel(USER_CACHE, userCacheKey(uuid));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeDateValues<T>(value: T): T {
  if (value instanceof Date) return value;

  if (typeof value === 'string') {
    if (ISO_8601_REGEX.test(value)) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed as unknown as T;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDateValues(item)) as unknown as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, normalizeDateValues(nestedValue)])
    ) as unknown as T;
  }

  return value;
}

async function setupCollections(db: Db): Promise<Collections> {
  trackMongoOperation('listCollections', '*');
  const existingCollections = await db.collections();
  const existingNames = new Set(existingCollections.map((c) => c.collectionName));

  if (!existingNames.has(DATA_POINTS_COLLECTION)) {
    try {
      trackMongoOperation('createCollection', DATA_POINTS_COLLECTION);
      await db.createCollection(DATA_POINTS_COLLECTION);
      log.info({ collection: DATA_POINTS_COLLECTION }, 'created data points collection');
    } catch (error) {
      log.warn({ error, collection: DATA_POINTS_COLLECTION }, 'could not create collection');
    }
  }

  const cols: Collections = {
    dataPoints: db.collection<DataPointDocument>(DATA_POINTS_COLLECTION),
    users: db.collection<User>(USERS_COLLECTION),
    punishments: db.collection<Punishment>(PUNISHMENTS_COLLECTION),
    devices: db.collection<DeviceDocument>(DEVICES_COLLECTION),
    deviceClaims: db.collection<DeviceClaim>(DEVICE_CLAIMS_COLLECTION),
    sessions: db.collection<Session>(SESSIONS_COLLECTION),
    stripeEvents: db.collection<{ id: string; type: string; createdAt: Date }>(STRIPE_EVENTS_COLLECTION),
    avatars: db.collection<StoredAvatar>(AVATARS_COLLECTION)
  };

  const indexSpecs: Array<[string, () => Promise<unknown>]> = [
    // One document per device per second; uploads replace the value at that second.
    [DATA_POINTS_COLLECTION, () => cols.dataPoints.createIndex({ deviceSerial: 1, timestamp: 1 }, { unique: true })],
    [DATA_POINTS_COLLECTION, () => cols.dataPoints.createIndex({ timestamp: -1 })],
    [USERS_COLLECTION, () => cols.users.createIndex({ uuid: 1 }, { unique: true })],
    [USERS_COLLECTION, () => cols.users.createIndex({ username: 1 }, { unique: true })],
    [USERS_COLLECTION, () => cols.users.createIndex({ stripeCustomerId: 1 }, { sparse: true })],
    [AVATARS_COLLECTION, () => cols.avatars.createIndex({ userUuid: 1 }, { unique: true })],
    [PUNISHMENTS_COLLECTION, () => cols.punishments.createIndex({ userUuid: 1 })],
    [PUNISHMENTS_COLLECTION, () => cols.punishments.createIndex({ userUuid: 1, type: 1, liftedAt: 1, startsAt: 1, endsAt: 1 })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex({ serial: 1 }, { unique: true })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex({ ownerUuid: 1 })],
    [DEVICES_COLLECTION, () => cols.devices.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    )],
    [DEVICE_CLAIMS_COLLECTION, () => cols.deviceClaims.createIndex({ ownerUuid: 1 }, { unique: true })],
    [DEVICE_CLAIMS_COLLECTION, () => cols.deviceClaims.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    )],
    [DEVICE_CLAIMS_COLLECTION, () => cols.deviceClaims.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })],
    [STRIPE_EVENTS_COLLECTION, () => cols.stripeEvents.createIndex({ id: 1 }, { unique: true })],
    [STRIPE_EVENTS_COLLECTION, () => cols.stripeEvents.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })],
  ];

  await Promise.all(
    indexSpecs.map(async ([collection, createIndex]) => {
      trackMongoOperation('createIndex', collection);
      return createIndex();
    })
  ).catch((error) => log.warn({ error }, 'failed to ensure indexes'));

  try {
    await ensureSessionIndexes(cols.sessions);
  } catch (error) {
    log.warn({ error }, 'failed to ensure sessions indexes');
  }

  return cols;
}

/**
 * Reconciles the sessions collection indexes with the current schema.
 *
 * Older deployments carried unique indexes on the legacy `token` field (and a
 * non-partial `tokenHash` index) that break inserts after the schema moved to
 * `tokenHash`. Unique indexes treat a missing field as `null`, so multiple
 * documents without the field produce `E11000 duplicate key` errors on build
 * and on write. Those stale indexes are dropped here and rebuilt as a partial
 * unique index so legacy documents (which have no `tokenHash`) are excluded.
 */
async function ensureSessionIndexes(sessions: Collection<Session>) {
  trackMongoOperation('listIndexes', SESSIONS_COLLECTION);
  const existing = await sessions.listIndexes().toArray();

  const stale: string[] = [];
  for (const index of existing) {
    const fields = Object.keys(index.key ?? {});
    if (fields.length !== 1) continue;

    const [field] = fields;
    if (field === 'token' || (field === 'tokenHash' && !index.partialFilterExpression)) {
      stale.push(index.name);
    }
  }

  for (const name of stale) {
    trackMongoOperation('dropIndex', SESSIONS_COLLECTION);
    await sessions.dropIndex(name);
  }

  const indexSpecs: Array<() => Promise<unknown>> = [
    () => sessions.createIndex({ id: 1 }, { unique: true }),
    () => sessions.createIndex(
      { tokenHash: 1 },
      { unique: true, partialFilterExpression: { tokenHash: { $type: 'string' } } }
    ),
    () => sessions.createIndex({ userUuid: 1 }),
    () => sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ];

  await Promise.all(
    indexSpecs.map(async (createIndex) => {
      trackMongoOperation('createIndex', SESSIONS_COLLECTION);
      return createIndex();
    })
  );
}

export async function connect(): Promise<Collections> {
  if (collections) return collections;

  connectPromise ??= (async () => {
      client = new MongoClient(MONGO_URI, { maxPoolSize: MONGO_MAX_POOL_SIZE });
      await client.connect();
      database = client.db(MONGO_DB_NAME);
      collections = await setupCollections(database);
      return database;
    })().finally(() => {
      connectPromise = null;
    });

  await connectPromise;
  return collections!;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
    collections = null;
  }
}

async function getCols(): Promise<Collections> {
  return collections ?? connect();
}

export async function upsertDataPoints(deviceSerial: number, points: DataPoint[]): Promise<number> {
  if (points.length === 0) return 0;

  const { dataPoints } = await getCols();
  const operations = points.map((point) => ({
    updateOne: {
      filter: { deviceSerial, timestamp: point.timestamp },
      update: {
        $set: {
          temperature: point.temperature,
          humidity: point.humidity,
          airPressure: point.airPressure,
        },
      },
      upsert: true,
    },
  }));

  trackMongoOperation('bulkWrite', DATA_POINTS_COLLECTION);
  await dataPoints.bulkWrite(operations);
  return points.length;
}

export type DataPointStats = {
  count: number;
  latest: DataPoint | null;
};

export async function getDataPointStats(
  serials: number[],
  ownerCacheKey?: string,
): Promise<Map<number, DataPointStats>> {
  if (serials.length === 0) return new Map();

  if (ownerCacheKey) {
    const cached = await cacheGet<Array<[number, DataPointStats]>>(
      DEVICE_STATS_CACHE,
      deviceStatsCacheKey(ownerCacheKey),
    );
    if (cached) return new Map(cached);
  }

  const { dataPoints } = await getCols();
  trackMongoOperation('aggregate', DATA_POINTS_COLLECTION);

  const rows = await dataPoints
    .aggregate<{ _id: number; count: number; latest: DataPointDocument }>([
      { $match: { deviceSerial: { $in: serials } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$deviceSerial',
          count: { $sum: 1 },
          latest: { $first: '$$ROOT' },
        },
      },
    ])
    .toArray();

  const stats = new Map<number, DataPointStats>();
  for (const row of rows) {
    stats.set(row._id, {
      count: row.count,
      latest: row.latest
        ? {
            timestamp: row.latest.timestamp,
            temperature: row.latest.temperature,
            humidity: row.latest.humidity,
            airPressure: row.latest.airPressure,
          }
        : null,
    });
  }

  if (ownerCacheKey) {
    await cacheSet(
      DEVICE_STATS_CACHE,
      deviceStatsCacheKey(ownerCacheKey),
      [...stats],
      DEVICE_STATS_CACHE_TTL_SECONDS,
    );
  }

  return stats;
}

export async function countActiveDevices(since: Date): Promise<number> {
  const { devices } = await getCols();
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({ lastUploadAt: { $gte: since } });
}

export async function countDevices(): Promise<number> {
  const { devices } = await getCols();
  trackMongoOperation('countDocuments', DEVICES_COLLECTION);
  return devices.countDocuments({});
}

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

export type AvatarMetadata = {
  contentType: string;
  size: number;
  updatedAt: Date;
};

export async function putAvatar(userUuid: string, data: Uint8Array, contentType: string): Promise<AvatarMetadata> {
  const { avatars } = await getCols();
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const metadata: AvatarMetadata = {
    contentType,
    size: bytes.byteLength,
    updatedAt: new Date(),
  };

  trackMongoOperation('updateOne', AVATARS_COLLECTION);
  await avatars.updateOne(
    { userUuid },
    { $set: { ...metadata, userUuid, data: new Binary(bytes) } },
    { upsert: true }
  );

  return metadata;
}

export async function getAvatar(userUuid: string) {
  const { avatars } = await getCols();
  trackMongoOperation('findOne', AVATARS_COLLECTION);
  return avatars.findOne({ userUuid });
}

export async function deleteAvatar(userUuid: string) {
  const { avatars } = await getCols();
  trackMongoOperation('deleteOne', AVATARS_COLLECTION);
  await avatars.deleteOne({ userUuid });
}

export async function deletePunishmentsForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  trackMongoOperation('deleteMany', PUNISHMENTS_COLLECTION);
  await punishments.deleteMany({ userUuid });
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(userUuid));
}

export async function deleteDevicesForOwnerUuid(ownerUuid: string) {
  const { devices, deviceClaims } = await getCols();

  // Collect serials before deleting so their cache entries can be dropped.
  trackMongoOperation('find', DEVICES_COLLECTION);
  const existing = await devices.find({ ownerUuid }, { projection: { serial: 1, _id: 0 } }).toArray();

  trackMongoOperation('deleteMany', DEVICES_COLLECTION);
  await devices.deleteMany({ ownerUuid });
  trackMongoOperation('deleteOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.deleteOne({ ownerUuid });

  await cacheDel(
    DEVICE_CACHE,
    ...existing.map((device) => deviceCacheKey(device.serial)),
    deviceListCacheKey(ownerUuid),
    deviceStatsCacheKey(ownerUuid),
  );
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

export async function updateUserLastActive(uuid: string, when: Date) {
  const { users } = await getCols();
  trackMongoOperation('updateOne', USERS_COLLECTION);
  await users.updateOne({ uuid }, { $set: { lastActive: when } });
  // Hot path (once per user per minute): refresh only that user's cached copy,
  // never the global auth generation.
  await invalidateUserCache(uuid);
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

export async function createPunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  trackMongoOperation('insertOne', PUNISHMENTS_COLLECTION);
  await punishments.insertOne(normalizedPunishment);
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(punishment.userUuid));
  return normalizedPunishment;
}

export async function getPunishmentById(id: string) {
  const { punishments } = await getCols();
  trackMongoOperation('findOne', PUNISHMENTS_COLLECTION);
  return punishments.findOne({ id } as Record<string, unknown>);
}

export async function getPunishmentsForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  trackMongoOperation('find', PUNISHMENTS_COLLECTION);
  return punishments.find({ userUuid }).sort({ issuedAt: -1 }).toArray();
}

export async function getActiveSuspensionForUserUuid(userUuid: string) {
  const cacheKey = suspensionCacheKey(userUuid);
  const cached = await cacheGet<Punishment | typeof NONE>(SUSPENSION_CACHE, cacheKey);

  if (cached === NONE) return null;
  if (cached) return cached;

  const { punishments } = await getCols();
  const now = new Date();

  trackMongoOperation('findOne', PUNISHMENTS_COLLECTION);
  const suspension = await punishments.findOne({
    userUuid,
    type: 'suspension',
    liftedAt: { $exists: false },
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $exists: false } }, { endsAt: { $gt: now } }]
  } as Record<string, unknown>);

  // Cache the negative case too: most users are never suspended, and this
  // query previously ran on every single authenticated request.
  await cacheSet(
    SUSPENSION_CACHE,
    cacheKey,
    suspension ?? NONE,
    SUSPENSION_CACHE_TTL_SECONDS,
  );

  return suspension;
}

export async function getPunishmentsByType(type: Punishment['type']) {
  const { punishments } = await getCols();
  trackMongoOperation('find', PUNISHMENTS_COLLECTION);
  return punishments.find({ type }).sort({ issuedAt: -1 }).toArray();
}

export async function updatePunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  trackMongoOperation('updateOne', PUNISHMENTS_COLLECTION);
  await punishments.updateOne(
    { id: punishment.id } as Record<string, unknown>,
    { $set: normalizedPunishment }
  );
  await cacheDel(SUSPENSION_CACHE, suspensionCacheKey(punishment.userUuid));
  return normalizedPunishment;
}

export async function createDevice(device: DeviceDocument) {
  const { devices } = await getCols();
  const normalizedDevice = normalizeDateValues(device);
  trackMongoOperation('insertOne', DEVICES_COLLECTION);
  await devices.insertOne(normalizedDevice);

  await cacheDevice(normalizedDevice);
  // The owner's device list no longer matches.
  await cacheDel(DEVICE_LIST_CACHE, deviceListCacheKey(normalizedDevice.ownerUuid));

  return normalizedDevice;
}

/**
 * Writes a device document into the cache. Used on creation and after uploads so
 * the hot upload path never has to re-read the device from MongoDB.
 */
export async function cacheDevice(device: DeviceDocument): Promise<void> {
  await cacheSet(DEVICE_CACHE, deviceCacheKey(device.serial), device, DEVICE_CACHE_TTL_SECONDS);
}

export async function getDeviceBySerial(serial: number) {
  const cacheKey = deviceCacheKey(serial);
  const cached = await cacheGet<DeviceDocument | typeof NONE>(DEVICE_CACHE, cacheKey);

  if (cached === NONE) return null;
  if (cached) return cached;

  const { devices } = await getCols();
  trackMongoOperation('findOne', DEVICES_COLLECTION);
  const device = await devices.findOne({ serial });

  if (device) {
    await cacheSet(DEVICE_CACHE, cacheKey, device, DEVICE_CACHE_TTL_SECONDS);
  } else {
    // Short negative TTL keeps invalid-serial uploads from hammering MongoDB.
    await cacheSet(DEVICE_CACHE, cacheKey, NONE, DEVICE_NEGATIVE_TTL_SECONDS);
  }

  return device;
}

export async function getDevicesForOwnerUuid(ownerUuid: string) {
  const cacheKey = deviceListCacheKey(ownerUuid);
  const cached = await cacheGet<DeviceDocument[]>(DEVICE_LIST_CACHE, cacheKey);
  if (cached) return cached;

  const { devices } = await getCols();
  trackMongoOperation('find', DEVICES_COLLECTION);
  const list = await devices.find({ ownerUuid }).sort({ registeredAt: -1 }).toArray();

  await cacheSet(DEVICE_LIST_CACHE, cacheKey, list, DEVICE_LIST_CACHE_TTL_SECONDS);

  return list;
}

/**
 * Drops the per-owner device list and statistics caches after an upload changes
 * the underlying data.
 */
export async function invalidateDeviceCachesForOwner(ownerUuid: string): Promise<void> {
  await cacheDel(
    DEVICE_LIST_CACHE,
    deviceListCacheKey(ownerUuid),
    deviceStatsCacheKey(ownerUuid),
  );
}

export async function updateDeviceLastUpload(serial: number, when: Date) {
  const { devices } = await getCols();
  trackMongoOperation('updateOne', DEVICES_COLLECTION);
  await devices.updateOne({ serial }, { $set: { lastUploadAt: when } });
}

/** Strips the secret token fields before a device is returned to a client. */
export function toPublicDevice(device: DeviceDocument): Device {
  const publicDevice: Device & { tokenHash?: string; tokenCreatedAt?: Date } = { ...device };
  delete publicDevice.tokenHash;
  delete publicDevice.tokenCreatedAt;
  return publicDevice;
}

export async function setDeviceClaim(claim: DeviceClaim) {
  const { deviceClaims } = await getCols();
  const normalizedClaim = normalizeDateValues(claim);
  trackMongoOperation('updateOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.updateOne(
    { ownerUuid: claim.ownerUuid },
    { $set: normalizedClaim },
    { upsert: true }
  );
  return normalizedClaim;
}

export async function getDeviceClaimByTokenHash(tokenHash: string) {
  const { deviceClaims } = await getCols();
  trackMongoOperation('findOne', DEVICE_CLAIMS_COLLECTION);
  return deviceClaims.findOne({ tokenHash });
}

export async function deleteDeviceClaim(ownerUuid: string) {
  const { deviceClaims } = await getCols();
  trackMongoOperation('deleteOne', DEVICE_CLAIMS_COLLECTION);
  await deviceClaims.deleteOne({ ownerUuid });
}

export async function createSession(session: Session) {
  const { sessions } = await getCols();
  const normalizedSession = normalizeDateValues(session);
  trackMongoOperation('insertOne', SESSIONS_COLLECTION);
  await sessions.insertOne(normalizedSession);
  return normalizedSession;
}

export async function getSessionByTokenHash(tokenHash: string) {
  const { sessions } = await getCols();
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ tokenHash });
}

export async function getSessionById(id: string) {
  const { sessions } = await getCols();
  trackMongoOperation('findOne', SESSIONS_COLLECTION);
  return sessions.findOne({ id } as Record<string, unknown>);
}

export async function getSessionsForUserUuid(userUuid: string) {
  const { sessions } = await getCols();
  trackMongoOperation('find', SESSIONS_COLLECTION);
  return sessions.find({ userUuid }).sort({ lastActive: -1 }).toArray();
}

export async function updateSessionLastActive(id: string, when: Date) {
  const { sessions } = await getCols();
  trackMongoOperation('updateOne', SESSIONS_COLLECTION);
  await sessions.updateOne({ id } as Record<string, unknown>, { $set: { lastActive: when } });
}

export async function deleteSession(id: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ id } as Record<string, unknown>);
  sessionsTotal.inc({ event: 'revoked' });
  await invalidateAuthEntries();
}

export async function deleteSessionByTokenHash(tokenHash: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteOne', SESSIONS_COLLECTION);
  await sessions.deleteOne({ tokenHash });
  sessionsTotal.inc({ event: 'logout' });
  await invalidateAuthEntries();
}

export async function deleteSessionsForUserUuid(userUuid: string) {
  const { sessions } = await getCols();
  trackMongoOperation('deleteMany', SESSIONS_COLLECTION);
  const result = await sessions.deleteMany({ userUuid });
  sessionsTotal.inc({ event: 'revoked_all' }, result.deletedCount);
  await invalidateAuthEntries();
}
