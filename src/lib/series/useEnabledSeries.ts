import { useCallback, useEffect, useState } from 'react';
import { SERIES_DEFINITIONS, type SeriesId } from './definitions';
import { STORAGE_KEYS, readStorage, writeStorage } from '../storage';

const STORAGE_KEY = STORAGE_KEYS.deviceEnabledSeries;

const DEFAULT_ENABLED: SeriesId[] = SERIES_DEFINITIONS.filter((s) => s.defaultEnabled).map((s) => s.id);

const VALID_IDS = new Set<SeriesId>(SERIES_DEFINITIONS.map((s) => s.id));

function readStored(): SeriesId[] {
  if (typeof window === 'undefined') return DEFAULT_ENABLED;
  try {
    const raw = readStorage(STORAGE_KEY, 'local');
    if (!raw) return DEFAULT_ENABLED;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ENABLED;
    const filtered = parsed.filter((v): v is SeriesId => typeof v === 'string' && VALID_IDS.has(v as SeriesId));
    return filtered.length ? filtered : DEFAULT_ENABLED;
  } catch {
    return DEFAULT_ENABLED;
  }
}

export function useEnabledSeries() {
  const [enabled, setEnabled] = useState<SeriesId[]>(() => readStored());

  useEffect(() => {
    try {
      writeStorage(STORAGE_KEY, JSON.stringify(enabled), 'local');
    } catch {
      // ignore storage failures
    }
  }, [enabled]);

  const toggle = useCallback((id: SeriesId) => {
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  }, []);

  const isEnabled = useCallback((id: SeriesId) => enabled.includes(id), [enabled]);

  return { enabled, setEnabled, toggle, isEnabled };
}

export { DEFAULT_ENABLED, STORAGE_KEY };
