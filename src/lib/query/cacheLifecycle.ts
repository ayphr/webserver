import type { QueryClient } from '@tanstack/react-query';
import { clearPersistedQueryCache } from './persist';

export async function clearAccountQueryCache(queryClient: QueryClient): Promise<void> {
  queryClient.clear();
  await clearPersistedQueryCache();
}

export async function clearSensitiveQueryState(queryClient: QueryClient): Promise<void> {
  await clearAccountQueryCache(queryClient);
}
