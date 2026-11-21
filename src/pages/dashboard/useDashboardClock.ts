import { useEffect, useState } from 'react';

/**
 * Tracks the current time while the tab is visible. Consumers use it for
 * day-scale cooldowns and a slowly moving suspension progress bar, so a
 * 30-second tick avoids re-rendering the whole dashboard every second.
 */
export function useDashboardClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs]);

  return now;
}