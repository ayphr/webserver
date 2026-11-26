import { createAppQueryClient } from './client';
import { createIdbPersister } from './persist';

export const queryClient = createAppQueryClient();
export const queryPersister = createIdbPersister();

export { CACHE_BUSTER, QUERY_GC_TIME_MS, QUERY_STALE_TIME_MS } from './client';
export { queryKeys } from './keys';
export { shouldPersistQuery, shouldPersistQueryKey, clearPersistedQueryCache } from './persist';
export { clearAccountQueryCache, clearSensitiveQueryState } from './cacheLifecycle';
