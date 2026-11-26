import type { QueryClient } from '@tanstack/react-query';

const NO_PREFETCH_ROOT_KEYS = new Set(['deviceDataPoints', 'locationDataPoints', 'locationHistory']);

export function shouldPrefetch(rootKey: string): boolean {
  return !NO_PREFETCH_ROOT_KEYS.has(rootKey);
}

export function prefetchIfNeeded(queryClient: QueryClient, opts: Parameters<QueryClient['prefetchQuery']>[0] & { rootKey?: string }) {
  const root = opts.rootKey ?? (Array.isArray(opts.queryKey) ? String(opts.queryKey[0]) : '');
  if (root && !shouldPrefetch(root)) return Promise.resolve();
  return queryClient.prefetchQuery(opts);
}
