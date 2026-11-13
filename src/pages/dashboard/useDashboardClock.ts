import { useEffect, useState } from 'react';

/** Tracks the current time, updating once per second while the tab is visible. */
export function useDashboardClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => setNow(Date.now()), 1000);
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
  }, []);

  return now;
}