import { Collection, Db, MongoClient } from 'mongodb';
import { createLogger } from '../lib/logger';
import type { TelemetryRecord } from '../lib/telemetry';
import { type Device, type Punishment, type User, type UserRole } from '../../../common';
import {
  TELEMETRY_COLLECTION,
  USERS_COLLECTION,
  PUNISHMENTS_COLLECTION,
  DEVICES_COLLECTION,
  MONGO_URI,
  MONGO_DB_NAME
} from '../env';

const log = createLogger('db-worker');

const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

let client: MongoClient | null = null;
let database: Db | null = null;
let connectPromise: Promise<Db> | null = null;

interface Collections {
  telemetry: Collection<TelemetryRecord>;
  users: Collection<User>;
  punishments: Collection<Punishment>;
  devices: Collection<Device>;
}

let collections: Collections | null = null;

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
  const existingCollections = await db.collections();
  const existingNames = new Set(existingCollections.map((c) => c.collectionName));

  // Initialize time-series telemetry collection if missing
  if (!existingNames.has(TELEMETRY_COLLECTION)) {
    try {
      await db.createCollection(TELEMETRY_COLLECTION, {
        timeseries: { timeField: 'timestamp', metaField: 'deviceId', granularity: 'seconds' }
      });
      log.info({ collection: TELEMETRY_COLLECTION }, 'created timeseries collection');
    } catch (error) {
      log.warn({ error, collection: TELEMETRY_COLLECTION }, 'could not create collection');
    }
  }

  const cols: Collections = {
    telemetry: db.collection<TelemetryRecord>(TELEMETRY_COLLECTION),
    users: db.collection<User>(USERS_COLLECTION),
    punishments: db.collection<Punishment>(PUNISHMENTS_COLLECTION),
    devices: db.collection<Device>(DEVICES_COLLECTION)
  };

  await Promise.all([
    cols.telemetry.createIndex({ deviceId: 1 }),
    cols.users.createIndex({ uuid: 1 }, { unique: true }),
    cols.users.createIndex({ username: 1 }, { unique: true }),
    cols.users.createIndex({ 'auth.token': 1 }),
    cols.punishments.createIndex({ userUuid: 1 }),
    cols.punishments.createIndex({ userUuid: 1, type: 1, liftedAt: 1, startsAt: 1, endsAt: 1 }),
    cols.devices.createIndex({ serial: 1 }, { unique: true }),
    cols.devices.createIndex({ ownerUuid: 1 })
  ]).catch((error) => log.warn({ error }, 'failed to ensure indexes'));

  return cols;
}

export async function connect(): Promise<Collections> {
  if (collections) return collections;

  connectPromise ??= (async () => {
      client = new MongoClient(MONGO_URI);
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

export async function flushRecords(records: TelemetryRecord[], emit: (payload: unknown) => void) {
  try {
    const { telemetry } = await getCols();
    const documents = records.map((record) => normalizeDateValues(record));

    if (documents.length === 0) {
      emit({ action: 'log', msg: 'nothing to insert' });
      return;
    }

    const result = await telemetry.insertMany(documents);
    emit({ action: 'log', msg: `inserted ${result.insertedCount} documents` });
  } catch (error) {
    log.error({ error }, 'failed to flush records');
    emit({ action: 'error', error: String(error) });
  }
}

export async function createUser(user: User) {
  const { users } = await getCols();
  const normalizedUser = normalizeDateValues(user);
  await users.insertOne(normalizedUser);
  return normalizedUser;
}

export async function getUserFromUuid(uuid: string) {
  const { users } = await getCols();
  return users.findOne({ uuid });
}

export async function getUserFromUsername(username: string) {
  const { users } = await getCols();
  return users.findOne({ username });
}

export async function getUserFromToken(token: string) {
  const { users } = await getCols();
  return users.findOne({ 'auth.token': token } as Record<string, unknown>);
}

export async function getUsers() {
  const { users } = await getCols();
  return users.find({}).sort({ createdAt: -1 }).toArray();
}

export async function getUsersByRole(role: UserRole) {
  const { users } = await getCols();
  return users.find({ role }).sort({ createdAt: -1 }).toArray();
}

export async function getUserCount() {
  const { users } = await getCols();
  return users.countDocuments({});
}

export async function updateUser(user: User) {
  const { users } = await getCols();
  const normalizedUser = normalizeDateValues(user);
  await users.updateOne({ uuid: user.uuid }, { $set: normalizedUser });
  return normalizedUser;
}

export async function updateUserRole(userUuid: string, role: UserRole) {
  const { users } = await getCols();
  const result = await users.findOneAndUpdate(
    { uuid: userUuid },
    { $set: { role } },
    { returnDocument: 'after' }
  );
  return result;
}

export async function createPunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  await punishments.insertOne(normalizedPunishment);
  return normalizedPunishment;
}

export async function getPunishmentById(id: string) {
  const { punishments } = await getCols();
  return punishments.findOne({ id } as Record<string, unknown>);
}

export async function getPunishmentsForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  return punishments.find({ userUuid }).sort({ issuedAt: -1 }).toArray();
}

export async function getActiveSuspensionForUserUuid(userUuid: string) {
  const { punishments } = await getCols();
  const now = new Date();

  return punishments.findOne({
    userUuid,
    type: 'suspension',
    liftedAt: { $exists: false },
    startsAt: { $lte: now },
    endsAt: { $gt: now }
  } as Record<string, unknown>);
}

export async function getPunishmentsByType(type: Punishment['type']) {
  const { punishments } = await getCols();
  return punishments.find({ type }).sort({ issuedAt: -1 }).toArray();
}

export async function updatePunishment(punishment: Punishment) {
  const { punishments } = await getCols();
  const normalizedPunishment = normalizeDateValues(punishment);
  await punishments.updateOne(
    { id: punishment.id } as Record<string, unknown>,
    { $set: normalizedPunishment }
  );
  return normalizedPunishment;
}

export async function createDevice(device: Device) {
  const { devices } = await getCols();
  const normalizedDevice = normalizeDateValues(device);
  await devices.insertOne(normalizedDevice);
  return normalizedDevice;
}

export async function getDeviceBySerial(serial: number) {
  const { devices } = await getCols();
  return devices.findOne({ serial });
}

export async function updateDevice(device: Device) {
  const { devices } = await getCols();
  const normalizedDevice = normalizeDateValues(device);
  await devices.updateOne({ serial: device.serial }, { $set: normalizedDevice });
  return normalizedDevice;
}

export async function getDevicesForOwnerUuid(ownerUuid: string) {
  const { devices } = await getCols();
  return devices.find({ ownerUuid }).sort({ registeredAt: -1 }).toArray();
}

export async function updateDeviceLastBroadcast(serial: number, when: Date) {
  const { devices } = await getCols();
  await devices.updateOne({ serial }, { $set: { lastBroadcastedAt: when } as Record<string, unknown> });
}
