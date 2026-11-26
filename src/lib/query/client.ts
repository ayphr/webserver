import { QueryClient } from '@tanstack/react-query';
import { QUERY_CACHE_BUSTER } from './persist';

export const CACHE_BUSTER = QUERY_CACHE_BUSTER;
export const QUERY_GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;
export const QUERY_STALE_TIME_MS = 30_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 2,
        networkMode: 'online',
      },
      mutations: {
        retry: 1,
        networkMode: 'online',
      },
    },
  });
}
