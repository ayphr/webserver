export const STORAGE_KEYS = {
  accounts: 'ayphr-accounts',
  activeToken: 'ayphr-api-token',
  defaultTab: 'ayphr-pref-default-tab',
  sidebarPinned: 'ayphr-pref-sidebar-pinned',
  radioVolume: 'ayphr-pref-radio-volume',
  assistantFolders: 'ayphr-assistant-folders',
  assistantChats: 'ayphr-assistant-chats',
  assistantActiveChat: 'ayphr-assistant-active-chat',
  assistantActiveFolder: 'ayphr-assistant-active-folder',
  assistantVariant: 'ayphr-pref-assistant-variant',
  assistantSendShortcut: 'ayphr-pref-assistant-send-shortcut',
  devicePeriod: 'ayphr:device:period',
  deviceGraphMode: 'ayphr:device:graphMode',
  deviceShowAxes: 'ayphr:device:showAxes',
  deviceShowXAxis: 'ayphr:device:showXAxis',
  deviceShowLegend: 'ayphr:device:showLegend',
  deviceShowGrid: 'ayphr:device:showGrid',
  deviceEnabledSeries: 'ayphr:device:enabledSeries',
  acceptedInvite: 'ayphr:accepted-invite',
} as const;

export type StorageArea = 'local' | 'session';

function resolveArea(target: StorageArea): Storage | null {
  const g = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
  try {
    return target === 'local' ? g.localStorage ?? null : g.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readStorage(key: string, target: StorageArea = 'local'): string | null {
  const storage = resolveArea(target);
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string, target: StorageArea = 'local'): void {
  const storage = resolveArea(target);
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage restrictions.
  }
}

export function removeStorage(key: string, target: StorageArea = 'local'): void {
  const storage = resolveArea(target);
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage restrictions.
  }
}

export function readJson<T>(key: string, target: StorageArea = 'local'): T | null {
  const raw = readStorage(key, target);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, target: StorageArea = 'local'): void {
  try {
    writeStorage(key, JSON.stringify(value), target);
  } catch {
    // Ignore serialization/storage restrictions.
  }
}