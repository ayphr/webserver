import { beforeEach, describe, expect, test } from 'bun:test';
import { STORAGE_KEYS } from './storage';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function installWindow() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  (globalThis as unknown as { window: unknown }).window = {
    localStorage,
    sessionStorage,
    dispatchEvent: (event: { type: string }) => {
      (listeners[event.type] ?? []).forEach((fn) => fn(event));
      return true;
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] ??= [];
      listeners[type].push(fn);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'CustomEvent', {
    value: class CustomEvent<T = unknown> { type: string; detail: T | undefined; constructor(type: string, init?: { detail?: T }) { this.type = type; this.detail = init?.detail; } },
    configurable: true,
    writable: true,
  });
  return { localStorage, sessionStorage };
}

describe('accounts persistent storage', () => {
  beforeEach(() => {
    installWindow();
  });

  test('migrates session auth to persistent and removes session copy', async () => {
    const { localStorage, sessionStorage } = installWindow();
    sessionStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify([{ token: 't1', user: { uuid: 'u1', username: 'alice' }, expiresAt: new Date(Date.now() + 60_000).toISOString() }]));
    sessionStorage.setItem(STORAGE_KEYS.activeToken, 't1');

    const mod = await import(`./accounts.ts?migrate=${Date.now()}`);
    mod.migrateSessionAuthToPersistent();

    expect(localStorage.getItem(STORAGE_KEYS.accounts)).toContain('alice');
    expect(localStorage.getItem(STORAGE_KEYS.activeToken)).toBe('t1');
    expect(sessionStorage.getItem(STORAGE_KEYS.accounts)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.activeToken)).toBeNull();
  });

  test('expired accounts filtered from stored accounts', async () => {
    const { localStorage } = installWindow();
    localStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify([
      { token: 'old', user: { uuid: 'u1', username: 'old' }, expiresAt: new Date(Date.now() - 60_000).toISOString() },
      { token: 'new', user: { uuid: 'u2', username: 'new' }, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ]));

    const mod = await import(`./accounts.ts?expire=${Date.now()}`);
    expect(mod.getStoredAccounts().map((a: { user: { username: string } }) => a.user.username)).toEqual(['new']);
  });
});
