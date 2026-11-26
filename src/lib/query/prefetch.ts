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

type LazyPreload = { preload?: () => Promise<unknown> };

const dashboardPanelPreloads: Record<string, LazyPreload | undefined> = {};

export function registerDashboardPanelPreloads(map: Record<string, LazyPreload | undefined>) {
  Object.assign(dashboardPanelPreloads, map);
}

export function preloadDashboardTab(tab: string) {
  void dashboardPanelPreloads[tab]?.preload?.();
}
