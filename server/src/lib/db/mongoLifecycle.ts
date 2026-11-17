import { Db, MongoClient } from 'mongodb';
import { MONGO_DB_NAME, MONGO_MAX_POOL_SIZE, MONGO_URI } from '../../env';
import type { Collections } from './internal';
import { setupCollections } from './internal';

export let client: MongoClient | null = null;
export let database: Db | null = null;
export let connectPromise: Promise<Db> | null = null;
export let collections: Collections | null = null;

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
  if (!client) return;

  await client.close();
  client = null;
  database = null;
  collections = null;
}

export async function getCols(): Promise<Collections> {
  return collections ?? connect();
}

export async function getCollection<K extends keyof Collections>(name: K): Promise<Collections[K]> {
  const cols = await getCols();
  return cols[name];
}
