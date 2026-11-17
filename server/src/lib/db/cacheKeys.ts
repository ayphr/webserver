import { cacheDel } from '../cache';

export const USER_CACHE = 'user';
export const USER_CACHE_TTL_SECONDS = 60;

export const SUSPENSION_CACHE = 'suspension';
export const SUSPENSION_CACHE_TTL_SECONDS = 60;

export const DEVICE_CACHE = 'device';
export const DEVICE_CACHE_TTL_SECONDS = 60;
export const DEVICE_NEGATIVE_TTL_SECONDS = 5;

export const DEVICE_LIST_CACHE = 'device_list';
export const DEVICE_LIST_CACHE_TTL_SECONDS = 60;

export const DEVICE_STATS_CACHE = 'device_stats';
export const DEVICE_STATS_CACHE_TTL_SECONDS = 60;

/** Sentinel cached in place of a null result so negative lookups are cached too. */
export const NONE = 'none';

export const userCacheKey = (uuid: string) => `user:${uuid}`;
export const suspensionCacheKey = (uuid: string) => `suspension:${uuid}`;
export const deviceCacheKey = (serial: number) => `device:${serial}`;
export const deviceListCacheKey = (teamId: string) => `device_list:${teamId}`;
export const deviceStatsCacheKey = (teamId: string) => `device_stats:${teamId}`;

export async function invalidateUserCache(uuid: string): Promise<void> {
  await cacheDel(USER_CACHE, userCacheKey(uuid));
}
