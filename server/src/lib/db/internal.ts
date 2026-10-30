/* eslint-disable @typescript-eslint/no-unused-vars */

import { Binary, Collection, Db, MongoClient, type Filter } from 'mongodb';
import { createLogger } from '../logger';
export * from '../../env';
import { recordMongoOperation, sessionsTotal } from '../metrics';
import { type DataPoint, type Device, type Punishment, type Session, type User, type UserRole, type AttachedSubscription, type PaidSubscription, type App, type OAuthAuthorizationCode, type OAuthAccessToken, type Connection } from '@common';
import {
  DATA_POINTS_COLLECTION,
  USERS_COLLECTION,
  PUNISHMENTS_COLLECTION,
  DEVICES_COLLECTION,
  DEVICE_CLAIMS_COLLECTION,
  DEVICE_PAIRINGS_COLLECTION,
  SESSIONS_COLLECTION,
  STRIPE_EVENTS_COLLECTION,
  AVATARS_COLLECTION,
  APPS_COLLECTION,
  OAUTH_CODES_COLLECTION,
  OAUTH_TOKENS_COLLECTION,
  CONNECTIONS_COLLECTION,
  DOMAIN_VERIFICATIONS_COLLECTION,
  MONGO_URI,
  MONGO_DB_NAME,
  MONGO_MAX_POOL_SIZE
} from '../../env';
import { cacheDel, cacheGet, cacheSet } from '../cache';
import { invalidateAuthEntries } from '../authCache';

export const log = createLogger('db');

export const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

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

export type DevicePairing = {
  code: string;
  serial: number;
  name?: string;
  token: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  linked: boolean;
  ownerUuid?: string;
  ownerUsername?: string;
  linkedAt?: Date;
  fetched?: boolean;
};

export type DomainVerification = {
  id: string;
  userUuid: string;
  socialType: string;
  domain: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  verifiedAt?: Date;
};

export let client: MongoClient | null = null;
export let database: Db | null = null;
export let connectPromise: Promise<Db> | null = null;

export interface Collections {
  dataPoints: Collection<DataPointDocument>;
  users: Collection<User>;
  punishments: Collection<Punishment>;
  devices: Collection<DeviceDocument>;
  deviceClaims: Collection<DeviceClaim>;
  devicePairings: Collection<DevicePairing>;
  sessions: Collection<Session>;
  stripeEvents: Collection<{ id: string; type: string; createdAt: Date }>;
  avatars: Collection<StoredAvatar>;
  apps: Collection<App>;
  oauthCodes: Collection<OAuthAuthorizationCode>;
  oauthTokens: Collection<OAuthAccessToken>;
  connections: Collection<Connection>;
  domainVerifications: Collection<DomainVerification>;
}

export interface StoredAvatar {
  userUuid: string;
  contentType: string;
  size: number;
  updatedAt: Date;
  data: Binary;
}

export let collections: Collections | null = null;

export function trackMongoOperation(operation: string, collection: string) {
  recordMongoOperation(operation, collection);
}

// ---------------------------------------------------------------------------
// Redis cache integration.
//
// Reads are cache-through: Redis first, MongoDB on a miss. Every write path in
// this module invalidates or refreshes the keys it affects. All cache helpers
// are fail-soft, so a Redis outage degrades to uncached MongoDB access.
// ---------------------------------------------------------------------------

export const USER_CACHE = 'user';
export const USER_CACHE_TTL_SECONDS = 15;

export const SUSPENSION_CACHE = 'suspension';
export const SUSPENSION_CACHE_TTL_SECONDS = 5;

export const DEVICE_CACHE = 'device';
export const DEVICE_CACHE_TTL_SECONDS = 60;
export const DEVICE_NEGATIVE_TTL_SECONDS = 5;

export const DEVICE_LIST_CACHE = 'device_list';
export const DEVICE_LIST_CACHE_TTL_SECONDS = 30;

export const DEVICE_STATS_CACHE = 'device_stats';
export const DEVICE_STATS_CACHE_TTL_SECONDS = 30;

/** Sentinel cached in place of a null result so negative lookups are cached too. */
export const NONE = 'none';

export const userCacheKey = (uuid: string) => `user:${uuid}`;
export const suspensionCacheKey = (uuid: string) => `suspension:${uuid}`;
export const deviceCacheKey = (serial: number) => `device:${serial}`;
export const deviceListCacheKey = (ownerUuid: string) => `device_list:${ownerUuid}`;
export const deviceStatsCacheKey = (ownerUuid: string) => `device_stats:${ownerUuid}`;

export async function invalidateUserCache(uuid: string): Promise<void> {
  await cacheDel(USER_CACHE, userCacheKey(uuid));
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeDateValues<T>(value: T): T {
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

export async function setupCollections(db: Db): Promise<Collections> {
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
    devicePairings: db.collection<DevicePairing>(DEVICE_PAIRINGS_COLLECTION),
    sessions: db.collection<Session>(SESSIONS_COLLECTION),
    stripeEvents: db.collection<{ id: string; type: string; createdAt: Date }>(STRIPE_EVENTS_COLLECTION),
    avatars: db.collection<StoredAvatar>(AVATARS_COLLECTION),
    apps: db.collection<App>(APPS_COLLECTION),
    oauthCodes: db.collection<OAuthAuthorizationCode>(OAUTH_CODES_COLLECTION),
    oauthTokens: db.collection<OAuthAccessToken>(OAUTH_TOKENS_COLLECTION),
    connections: db.collection<Connection>(CONNECTIONS_COLLECTION),
    domainVerifications: db.collection<DomainVerification>(DOMAIN_VERIFICATIONS_COLLECTION)
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
    [DEVICE_PAIRINGS_COLLECTION, () => cols.devicePairings.createIndex({ code: 1 }, { unique: true })],
    [DEVICE_PAIRINGS_COLLECTION, () => cols.devicePairings.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })],
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
export async function ensureSessionIndexes(sessions: Collection<Session>) {
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

export async function getCols(): Promise<Collections> {
  return collections ?? connect();
}
