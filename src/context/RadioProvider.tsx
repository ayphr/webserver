import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GentleLofiEngine } from '../lib/radio/GentleLofiEngine';
import { RadioContext } from './RadioContext';
import { STORAGE_KEYS, readStorage, writeStorage } from '../lib/storage';

const DEFAULT_VOLUME = 0.7;

function readStoredVolume(): number {
  try {
    const raw = readStorage(STORAGE_KEYS.radioVolume, 'local');
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

/**
 * Owns the single audio engine for the whole app. Mounted above the router so the
 * music continues when the dashboard tab — or even the route — changes.
 */
export const RadioProvider = ({ children }: { children: ReactNode }) => {
  const engineRef = useRef<GentleLofiEngine | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(readStoredVolume);

  const toggle = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new GentleLofiEngine(volume);
    }
    const playing = await engineRef.current.toggle();
    setIsPlaying(playing);
  }, [volume]);

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    setVolumeState(clamped);
    try {
      writeStorage(STORAGE_KEYS.radioVolume, String(clamped), 'local');
    } catch {
      // Storage can be unavailable (private mode / disabled cookies); volume still applies.
    }
    engineRef.current?.setVolume(clamped);
  }, []);

  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  return (
    <RadioContext.Provider value={{ isPlaying, volume, toggle, setVolume }}>
      {children}
    </RadioContext.Provider>
  );
};
