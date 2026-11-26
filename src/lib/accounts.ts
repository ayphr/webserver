import type { PublicUser } from '@common';
import { STORAGE_KEYS, readStorage, writeStorage, removeStorage } from './storage';

export type StoredAccount = {
  token: string;
  user: PublicUser;
  /** ISO timestamp (or Date) after which the saved token is no longer valid. */
  expiresAt?: string | number | Date;
};

const ACCOUNTS_KEY = STORAGE_KEYS.accounts;
const ACTIVE_TOKEN_KEY = STORAGE_KEYS.activeToken;
const AUTH_STORAGE_AREA = 'local' as const;
const LEGACY_AUTH_STORAGE_AREA = 'session' as const;

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.token !== 'string' || !candidate.token) return false;
  if (!candidate.user || typeof candidate.user !== 'object') return false;
  const user = candidate.user as Record<string, unknown>;
  if (typeof user.uuid !== 'string' || typeof user.username !== 'string') return false;
  if (candidate.expiresAt !== undefined && candidate.expiresAt !== null) {
    const time = new Date(candidate.expiresAt as string | number | Date).getTime();
    if (Number.isNaN(time)) return false;
  }
  return true;
}

export function isStoredAccountExpired(account: StoredAccount): boolean {
  if (account.expiresAt === undefined || account.expiresAt === null) return false;
  const time = new Date(account.expiresAt).getTime();
  if (Number.isNaN(time)) return false;
  return time <= Date.now();
}

export function migrateSessionAuthToPersistent(): void {
  const persistentAccounts = readStorage(ACCOUNTS_KEY, AUTH_STORAGE_AREA);
  const sessionAccounts = readStorage(ACCOUNTS_KEY, LEGACY_AUTH_STORAGE_AREA);
  if (!persistentAccounts && sessionAccounts) {
    writeStorage(ACCOUNTS_KEY, sessionAccounts, AUTH_STORAGE_AREA);
  }

  const persistentToken = readStorage(ACTIVE_TOKEN_KEY, AUTH_STORAGE_AREA);
  const sessionToken = readStorage(ACTIVE_TOKEN_KEY, LEGACY_AUTH_STORAGE_AREA);
  if (!persistentToken && sessionToken) {
    writeStorage(ACTIVE_TOKEN_KEY, sessionToken, AUTH_STORAGE_AREA);
  }

  removeStorage(ACCOUNTS_KEY, LEGACY_AUTH_STORAGE_AREA);
  removeStorage(ACTIVE_TOKEN_KEY, LEGACY_AUTH_STORAGE_AREA);
}

/** Returns every saved account, including tokens that have already expired. */
export function getAllStoredAccounts(): StoredAccount[] {
  try {
    const raw = readStorage(ACCOUNTS_KEY, AUTH_STORAGE_AREA);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAccount);
  } catch {
    return [];
  }
}

export function getStoredAccounts(): StoredAccount[] {
  return getAllStoredAccounts().filter((account) => !isStoredAccountExpired(account));
}

export function saveStoredAccounts(accounts: StoredAccount[]) {
  writeStorage(ACCOUNTS_KEY, JSON.stringify(accounts), AUTH_STORAGE_AREA);
  try {
    (globalThis as unknown as { window?: { dispatchEvent?: (e: unknown) => unknown } }).window?.dispatchEvent?.(
      new CustomEvent('ayphr-accounts-changed'),
    );
  } catch {
    // ignore
  }
}

export function getActiveToken(): string | null {
  return readStorage(ACTIVE_TOKEN_KEY, AUTH_STORAGE_AREA);
}

export function setActiveToken(token: string | null) {
  if (token) {
    writeStorage(ACTIVE_TOKEN_KEY, token, AUTH_STORAGE_AREA);
  } else {
    removeStorage(ACTIVE_TOKEN_KEY, AUTH_STORAGE_AREA);
  }
}

const DEFAULT_TOKEN_EXPIRE_MS = 48 * 60 * 60 * 1000;

function normalizeExpiresAt(value: StoredAccount['expiresAt'] | undefined): string {
  if (value === undefined || value === null) {
    return new Date(Date.now() + DEFAULT_TOKEN_EXPIRE_MS).toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now() + DEFAULT_TOKEN_EXPIRE_MS).toISOString();
  }
  return date.toISOString();
}

export function addStoredAccount(token: string, user: PublicUser, expiresAt?: StoredAccount['expiresAt']) {
  const accounts = getStoredAccounts().filter((account) => account.user.uuid !== user.uuid && account.token !== token);
  accounts.unshift({ token, user, expiresAt: normalizeExpiresAt(expiresAt) });
  saveStoredAccounts(accounts);
  setActiveToken(token);
}

export function updateStoredAccount(token: string, user: PublicUser) {
  const accounts = getStoredAccounts();
  const index = accounts.findIndex((account) => account.token === token);
  if (index >= 0) {
    accounts[index] = { ...accounts[index], user };
    saveStoredAccounts(accounts);
  }
}

export function removeStoredAccount(token: string) {
  const accounts = getAllStoredAccounts().filter((account) => account.token !== token);
  saveStoredAccounts(accounts);
  if (getActiveToken() === token) {
    const nextActive = accounts.find((account) => !isStoredAccountExpired(account));
    setActiveToken(nextActive?.token ?? null);
  }
}
