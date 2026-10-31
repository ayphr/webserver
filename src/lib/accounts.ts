import type { PublicUser } from '@common';

export type StoredAccount = {
  token: string;
  user: PublicUser;
  /** ISO timestamp (or Date) after which the saved token is no longer valid. */
  expiresAt?: string | number | Date;
};

const ACCOUNTS_KEY = 'ayphr-accounts';
const ACTIVE_TOKEN_KEY = 'ayphr-api-token';

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

export function getStoredAccounts(): StoredAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAccount).filter((account) => !isStoredAccountExpired(account));
  } catch {
    return [];
  }
}

export function saveStoredAccounts(accounts: StoredAccount[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getActiveToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_TOKEN_KEY);
}

export function setActiveToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(ACTIVE_TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(ACTIVE_TOKEN_KEY);
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
  const accounts = getStoredAccounts().filter((account) => account.token !== token);
  saveStoredAccounts(accounts);
  if (getActiveToken() === token) {
    if (accounts.length > 0) {
      setActiveToken(accounts[0].token);
    } else {
      setActiveToken(null);
    }
  }
}

export function clearStoredAccounts() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCOUNTS_KEY);
  window.localStorage.removeItem(ACTIVE_TOKEN_KEY);
}
