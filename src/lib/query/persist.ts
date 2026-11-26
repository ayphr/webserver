import { del, get, set } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import type { Query } from '@tanstack/react-query';

export const QUERY_CACHE_BUSTER = 'v1';
export const QUERY_CACHE_STORAGE_KEY = `ayphr-query-cache-${QUERY_CACHE_BUSTER}`;

const NON_PERSISTED_ROOT_KEYS = new Set(['deviceDataPoints', 'locationDataPoints', 'locationHistory']);

export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root !== 'string' || !NON_PERSISTED_ROOT_KEYS.has(root);
}

export function shouldPersistQuery(query: Query): boolean {
  if (query.meta?.persist === false) return false;
  return shouldPersistQueryKey(query.queryKey);
}

export function createIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(QUERY_CACHE_STORAGE_KEY, client);
    },
    restoreClient: async () => {
      return (await get<PersistedClient>(QUERY_CACHE_STORAGE_KEY)) ?? undefined;
    },
    removeClient: async () => {
      await del(QUERY_CACHE_STORAGE_KEY);
    },
  };
}

export async function clearPersistedQueryCache(): Promise<void> {
  try {
    await del(QUERY_CACHE_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}
