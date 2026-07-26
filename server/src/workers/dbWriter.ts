import { Collection, Db, MongoClient, type Document } from 'mongodb';
import { createLogger } from '../lib/logger';
import type { TelemetryRecord } from '../lib/telemetry';
import { type Device, type Punishment, type User, type UserRole } from '../../common';
import { CREDIT_PER_RECORD } from '../constants';

const log = createLogger('db-worker');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB || 'ayphr';

const TELEMETRY_COLLECTION = 'telemetry';
const USERS_COLLECTION = 'users';
const PUNISHMENTS_COLLECTION = 'punishments';
const DEVICES_COLLECTION = 'devices';

let client: MongoClient | null = null;
let database: Db | null = null;
let connectPromise: Promise<void> | null = null;

let telemetryCollection: Collection<Document> | null = null;
let usersCollection: Collection<Document> | null = null;
let punishmentsCollection: Collection<Document> | null = null;
let devicesCollection: Collection<Document> | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIsoDateString(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function normalizeDateValues<T>(value: T): T {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    return (isIsoDateString(value) ? new Date(value) : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDateValues(item)) as T;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, normalizeDateValues(nestedValue)])
  ) as T;
}

async function createCollections() {
  if (database == null) return;

  const collections = await database.collections();
  const collectionsToCreate: {
    name: string;
    creator: Function;
  }[] = [
      {
        name: TELEMETRY_COLLECTION,
        creator: async (database: Db) => {
          await database.createCollection(TELEMETRY_COLLECTION, {
            timeseries: { timeField: 'timestamp', metaField: 'deviceId', granularity: 'seconds' }
          });
          // ensure index on deviceId for queries
          const col = database.collection(TELEMETRY_COLLECTION);
          await col.createIndex({ deviceId: 1 });
          // geo index for telemetry location
          try {
            await col.createIndex({ location: '2dsphere' });
          } catch (e) {
            // ignore if server doesn't support 2dsphere
          }
        }
      },
      {
        name: USERS_COLLECTION,
        creator: async (database: Db) => {
          const collection = await database.createCollection(USERS_COLLECTION);

          // Setup indexes
          await collection.createIndex({ uuid: 1 }, { unique: true });
          await collection.createIndex({ username: 1 }, { unique: true });
          await collection.createIndex({ 'auth.token': 1 });

          return collection;
        }
      },
      {
        name: PUNISHMENTS_COLLECTION,
        creator: async (database: Db) => {
          const collection = await database.createCollection(PUNISHMENTS_COLLECTION);

          await collection.createIndex({ userUuid: 1 });
          await collection.createIndex({ userUuid: 1, type: 1, liftedAt: 1, startsAt: 1, endsAt: 1 });

          return collection;
        }
      },
      {
        name: DEVICES_COLLECTION,
        creator: async (database: Db) => {
          const collection = await database.createCollection(DEVICES_COLLECTION);

          await collection.createIndex({ serial: 1 }, { unique: true });
          await collection.createIndex({ ownerUuid: 1 });

          // geo index for location
          try {
            await collection.createIndex({ location: '2dsphere' });
          } catch (e) {
            // ignore if server doesn't support 2dsphere
          }

          return collection;
        }
      },
      {
        name: 'purchases',
        creator: async (database: Db) => {
          const collection = await database.createCollection('purchases');
          await collection.createIndex({ buyerUuid: 1 });
          await collection.createIndex({ createdAt: -1 });
          return collection;
        }
      }
    ];

  for (const collection of collectionsToCreate) {
    if (collections.some((mongoCollection: Collection<Document>) => {
      return mongoCollection.collectionName == collection.name
    })) continue;

    try {
      await collection.creator(database);
      log.info({ collection: collection.name }, 'created collection');
    } catch (error) {
      log.warn({ error, collection: collection.name }, 'could not create collection');
    }
  }
}

async function ensureIndexes() {
  if (!telemetryCollection || !usersCollection || !punishmentsCollection || !devicesCollection) return;

  try {
    await telemetryCollection.createIndex({ deviceId: 1 });
    try {
      await telemetryCollection.createIndex({ location: '2dsphere' });
    } catch {
      // ignore if server doesn't support 2dsphere
    }

    await usersCollection.createIndex({ uuid: 1 }, { unique: true });
    await usersCollection.createIndex({ username: 1 }, { unique: true });
    await usersCollection.createIndex({ 'auth.token': 1 });

    await punishmentsCollection.createIndex({ userUuid: 1 });
    await punishmentsCollection.createIndex({ type: 1, endsAt: 1, liftedAt: 1 });

    await devicesCollection.createIndex({ serial: 1 }, { unique: true });
    await devicesCollection.createIndex({ ownerUuid: 1 });
    try {
      await devicesCollection.createIndex({ location: '2dsphere' });
    } catch {
      // ignore if server doesn't support 2dsphere
    }

    const purchases = database?.collection('purchases');
    if (purchases) {
      await purchases.createIndex({ buyerUuid: 1 });
      await purchases.createIndex({ createdAt: -1 });
    }
  } catch (error) {
    log.warn({ error }, 'failed to ensure indexes');
  }
}

async function connect() {
  if (database && telemetryCollection && usersCollection && punishmentsCollection && devicesCollection) {
    return;
  }

  connectPromise ??= (async () => {
    client ??= new MongoClient(MONGO_URI);

    await client.connect();

    database = client.db(DB_NAME);

    await createCollections();

    telemetryCollection = database.collection(TELEMETRY_COLLECTION);
    usersCollection = database.collection(USERS_COLLECTION);
    punishmentsCollection = database.collection(PUNISHMENTS_COLLECTION);
    devicesCollection = database.collection(DEVICES_COLLECTION);

    await ensureIndexes();
  })().finally(() => {
    connectPromise = null;
  });

  await connectPromise;
}

export async function flushRecords(records: TelemetryRecord[], emit: (payload: unknown) => void) {
  try {
    await connect();
    const documents = records.map((record) => normalizeDateValues(record));

    if (documents.length === 0) {
      emit({ action: 'log', msg: 'nothing to insert' });
      return;
    }

    if (telemetryCollection == null) {
      emit({ action: 'log', msg: 'database not init' });
      return;
    }

    const result = await telemetryCollection.insertMany(documents);
    emit({ action: 'log', msg: `inserted ${result.insertedCount} documents` });
    // Award credits to owners: small credit per record
    try {
      const countsByDevice: Record<number, number> = {};
      for (const doc of documents) {
        const id = (doc as any).deviceId as number;
        countsByDevice[id] = (countsByDevice[id] || 0) + 1;
      }

      const ownerCredits: Record<string, number> = {};
      for (const [deviceIdStr, count] of Object.entries(countsByDevice)) {
        const deviceId = Number(deviceIdStr);
        const dev = await getDeviceBySerial(deviceId);
        if (!dev) continue;
        const owner = dev.ownerUuid;
        ownerCredits[owner] = (ownerCredits[owner] || 0) + (CREDIT_PER_RECORD * count);
      }

      // apply credits to users
      for (const [ownerUuid, amount] of Object.entries(ownerCredits)) {
        if (!usersCollection) continue;
        await usersCollection.updateOne({ uuid: ownerUuid }, { $inc: { credits: amount } });
      }
    } catch (e) {
      log.warn({ error: e }, 'failed to award credits after telemetry insert');
    }
  } catch (error) {
    log.error({ error }, 'failed to flush records');
    emit({ action: 'error', error: String(error) });
  }
}

export async function createUser(user: User) {
  await connect();
  if (usersCollection == null) return;

  const normalizedUser = normalizeDateValues(user);
  await usersCollection.insertOne(normalizedUser);
  return normalizedUser;
}

export async function getUserFromUuid(uuid: string) {
  await connect();
  if (usersCollection == null) return;

  const doc = await usersCollection.findOne({ uuid });
  if (!doc) return null;

  return doc as unknown as User;
}

export async function getUserFromUsername(username: string) {
  await connect();
  if (usersCollection == null) return;

  const doc = await usersCollection.findOne({ username });
  if (!doc) return null;

  return doc as unknown as User;
}

export async function getUserFromToken(token: string) {
  await connect();
  if (usersCollection == null) return;

  const doc = await usersCollection.findOne({ 'auth.token': token });
  if (!doc) return null;

  return doc as unknown as User;
}

export async function getUsers() {
  await connect();
  if (usersCollection == null) return [];

  const docs = await usersCollection.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map((doc) => doc as unknown as User);
}

export async function getUsersByRole(role: UserRole) {
  await connect();
  if (usersCollection == null) return [];

  const docs = await usersCollection.find({ role }).sort({ createdAt: -1 }).toArray();
  return docs.map((doc) => doc as unknown as User);
}

export async function getUserCount() {
  await connect();
  if (usersCollection == null) return 0;

  return usersCollection.countDocuments({});
}

export async function updateUser(user: User) {
  await connect();
  if (usersCollection == null) return;

  const normalizedUser = normalizeDateValues(user);
  await usersCollection.updateOne({ uuid: user.uuid }, { $set: normalizedUser });
  return normalizedUser;
}

export async function updateUserRole(userUuid: string, role: UserRole) {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  user.role = role;
  await updateUser(user);
  return user;
}

export async function createPunishment(punishment: Punishment) {
  await connect();

  if (punishmentsCollection == null) return;
  const normalizedPunishment = normalizeDateValues(punishment);
  await punishmentsCollection.insertOne(normalizedPunishment);

  return normalizedPunishment;
}

export async function getPunishmentById(id: string) {
  await connect();
  if (punishmentsCollection == null) return;

  const doc = await punishmentsCollection.findOne({ id });
  if (!doc) return null;

  return doc as unknown as Punishment;
}

export async function getPunishmentsForUserUuid(userUuid: string) {
  await connect();
  if (punishmentsCollection == null) return [];

  const docs = await punishmentsCollection.find({ userUuid }).sort({ issuedAt: -1 }).toArray();
  return docs.map((doc) => doc as unknown as Punishment);
}

export async function getActiveSuspensionForUserUuid(userUuid: string) {
  await connect();
  if (punishmentsCollection == null) return;

  const now = new Date();
  const doc = await punishmentsCollection.findOne({
    userUuid,
    type: 'suspension',
    liftedAt: { $exists: false },
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  });

  if (!doc) return null;

  return doc as unknown as Punishment;
}

export async function getPunishmentsByType(type: Punishment['type']) {
  await connect();
  if (punishmentsCollection == null) return [];

  const docs = await punishmentsCollection.find({ type }).sort({ issuedAt: -1 }).toArray();
  return docs.map((doc) => doc as unknown as Punishment);
}

export async function updatePunishment(punishment: Punishment) {
  await connect();
  if (punishmentsCollection == null) return;

  const normalizedPunishment = normalizeDateValues(punishment);
  await punishmentsCollection.updateOne({ id: punishment.id }, { $set: normalizedPunishment as unknown as Document });
  return normalizedPunishment;
}

export async function createDevice(device: Device) {
  await connect();
  if (devicesCollection == null) return;

  const normalizedDevice = normalizeDateValues(device);
  await devicesCollection.insertOne(normalizedDevice);
  return normalizedDevice;
}

export async function getDeviceBySerial(serial: number) {
  await connect();
  if (devicesCollection == null) return null;

  const doc = await devicesCollection.findOne({ serial });
  if (!doc) return null;

  return doc as unknown as Device;
}

export async function updateDevice(device: Device) {
  await connect();
  if (devicesCollection == null) return;

  const normalizedDevice = normalizeDateValues(device);
  await devicesCollection.updateOne({ serial: device.serial }, { $set: normalizedDevice });
  return normalizedDevice;
}

export async function getDevicesForOwnerUuid(ownerUuid: string) {
  await connect();
  if (devicesCollection == null) return [];

  const docs = await devicesCollection.find({ ownerUuid }).sort({ registeredAt: -1 }).toArray();
  return docs.map((doc) => doc as unknown as Device);
}

export async function updateDeviceLastBroadcast(serial: number, when: Date) {
  await connect();
  if (devicesCollection == null) return;

  await devicesCollection.updateOne({ serial }, { $set: { lastBroadcastedAt: when } });
}

export async function getTelemetryByLocationAndTime(center: { lat: number; lon: number }, radiusMeters: number, start?: Date, end?: Date, limit = 100, skip = 0) {
  await connect();
  if (telemetryCollection == null) return { total: 0, records: [] };

  const startDate = start ?? new Date(0);
  const endDate = end ?? new Date();

  const metersToRadians = (m: number) => m / 6378137;
  const query: any = {
    timestamp: { $gte: startDate, $lte: endDate },
    location: {
      $geoWithin: {
        $centerSphere: [[center.lon, center.lat], metersToRadians(radiusMeters)]
      }
    }
  };

  const total = await telemetryCollection.countDocuments(query);
  const docs = await telemetryCollection.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray();
  return { total, records: docs };
}

export async function chargeUserCredits(userUuid: string, amount: number) {
  await connect();
  if (usersCollection == null) return false;
  const user = await usersCollection.findOne({ uuid: userUuid });
  if (!user) return false;
  const current = (user.credits || 0) as number;
  if (current < amount) return false;
  await usersCollection.updateOne({ uuid: userUuid }, { $inc: { credits: -amount } });
  return true;
}

export async function awardCreditsBulk(awards: Record<string, number>) {
  await connect();
  if (usersCollection == null) return;
  for (const [uuid, amount] of Object.entries(awards)) {
    await usersCollection.updateOne({ uuid }, { $inc: { credits: amount } });
  }
}

export async function performPurchaseTransaction(buyerUuid: string, debitAmount: number, ownerAwards: Record<string, number>) {
  await connect();
  if (!client || !usersCollection || !database) return false;

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const buyer = await usersCollection!.findOne({ uuid: buyerUuid }, { session });
      if (!buyer) throw new Error('BUYER_NOT_FOUND');
      const balance = (buyer.credits || 0) as number;
      if (balance < debitAmount) throw new Error('INSUFFICIENT_FUNDS');

      // debit buyer
      await usersCollection!.updateOne({ uuid: buyerUuid }, { $inc: { credits: -debitAmount } }, { session });

      // credit owners
      for (const [ownerUuid, amount] of Object.entries(ownerAwards)) {
        await usersCollection!.updateOne({ uuid: ownerUuid }, { $inc: { credits: amount } }, { session });
      }

      // record purchase
      const purchases = database!.collection('purchases');
      await purchases.insertOne({ buyerUuid, debitAmount, ownerAwards, createdAt: new Date() }, { session });
    });
    return true;
  } catch (e) {
    if ((e as Error).message === 'INSUFFICIENT_FUNDS') return false;
    log.warn({ error: e }, 'transaction failed');
    return false;
  } finally {
    await session.endSession();
  }
}
