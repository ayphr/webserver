import type { Session, User } from '@common';
import { cacheGet, cacheIncr, cacheReadCounter, cacheSet } from './cache';

const CACHE = 'auth';
const GEN_KEY = 'ayphr:cache:auth:gen';
const KEY_PREFIX = 'ayphr:cache:auth:entry:';

export const AUTH_CACHE_TTL_SECONDS = 10;

const INITIAL_GEN = 0;

export type AuthEntry = {
  session: Session;
  user: User;
};

async function bundleKey(tokenHash: string): Promise<string | null> {
  const gen = await cacheReadCounter(CACHE, GEN_KEY, INITIAL_GEN);
  if (gen === null) return null;
  return `${KEY_PREFIX}${gen}:${tokenHash}`;
}

export async function getAuthEntry(tokenHash: string): Promise<AuthEntry | null> {
  const key = await bundleKey(tokenHash);
  if (!key) return null;
  return cacheGet<AuthEntry>(CACHE, key);
}

export async function setAuthEntry(tokenHash: string, entry: AuthEntry): Promise<void> {
  const key = await bundleKey(tokenHash);
  if (!key) return;
  await cacheSet(CACHE, key, entry, AUTH_CACHE_TTL_SECONDS);
}

export async function invalidateAuthEntries(): Promise<void> {
  await cacheIncr(CACHE, GEN_KEY);
}
