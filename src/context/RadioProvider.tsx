import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GentleLofiEngine, RADIO_STYLES, type RadioStyle } from '../lib/radio/GentleLofiEngine';
import { RadioContext } from './RadioContext';

const RADIO_VOLUME_STORAGE_KEY = 'ayphr-pref-radio-volume';
const RADIO_STYLE_STORAGE_KEY = 'ayphr-pref-radio-style';
const DEFAULT_VOLUME = 0.7;
const DEFAULT_STYLE: RadioStyle = 'gentle';

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(RADIO_VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function readStoredStyle(): RadioStyle {
  try {
    const raw = localStorage.getItem(RADIO_STYLE_STORAGE_KEY);
    return RADIO_STYLES.includes(raw as RadioStyle) ? (raw as RadioStyle) : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
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
  const [style, setStyleState] = useState(readStoredStyle);

  const toggle = useCallback(async () => {
    if (!engineRef.current) {
      engineRef.current = new GentleLofiEngine(volume, style);
    }
    const playing = await engineRef.current.toggle();
    setIsPlaying(playing);
  }, [volume, style]);

  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    setVolumeState(clamped);
    try {
      localStorage.setItem(RADIO_VOLUME_STORAGE_KEY, String(clamped));
    } catch {
      // Storage can be unavailable (private mode / disabled cookies); volume still applies.
    }
    engineRef.current?.setVolume(clamped);
  }, []);

  const setStyle = useCallback((value: RadioStyle) => {
    setStyleState(value);
    try {
      localStorage.setItem(RADIO_STYLE_STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable; the style still applies to playback.
    }
    engineRef.current?.setStyle(value);
  }, []);

  useEffect(() => () => {
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  return (
    <RadioContext.Provider value={{ isPlaying, volume, style, toggle, setVolume, setStyle }}>
      {children}
    </RadioContext.Provider>
  );
};
