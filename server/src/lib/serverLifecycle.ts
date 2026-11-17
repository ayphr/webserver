import { countActiveDevices, countDevices, getUserCount } from './db';
import { reverifyAllDomains } from './domainReverification';
import {
  setActiveDevices,
  setProcessMaxFds,
  setProcessOpenFds,
  setProcessVirtualMemoryBytes,
  setTotalDevices,
  setTotalUsers,
} from './metrics';
import { runBackgroundTask, scheduleBackgroundTask } from './backgroundTasks';
import { createLogger } from './logger';

const ACTIVE_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DEVICE_REFRESH_MS = 60_000;
const ENTITY_COUNT_REFRESH_MS = 60_000;
const DOMAIN_REVERIFY_REFRESH_MS = 5 * 60 * 1000;
const PROCESS_METRICS_REFRESH_MS = 60_000;
const log = createLogger('server-lifecycle');

async function refreshActiveDevices(): Promise<void> {
  const since = new Date(Date.now() - ACTIVE_DEVICE_WINDOW_MS);
  setActiveDevices(await countActiveDevices(since));
}

async function refreshEntityCounts(): Promise<void> {
  const [users, devices] = await Promise.allSettled([getUserCount(), countDevices()]);
  if (users.status === 'fulfilled') setTotalUsers(users.value);
  else log.warn({ error: users.reason }, 'failed to refresh user count');
  if (devices.status === 'fulfilled') setTotalDevices(devices.value);
  else log.warn({ error: devices.reason }, 'failed to refresh device count');
}

async function refreshProcessMetrics(): Promise<void> {
  if (process.platform !== 'linux') return;
  const fs = await import('node:fs/promises');
  const fdEntries = await fs.readdir('/proc/self/fd').catch(() => [] as string[]);
  setProcessOpenFds(fdEntries.length);

  const limits = await fs.readFile('/proc/self/limits', 'utf8').catch(() => '');
  const match = limits.match(/Max open files\s+(\d+)/);
  if (match) setProcessMaxFds(Number(match[1]));

  const statm = await fs.readFile('/proc/self/statm', 'utf8').catch(() => '');
  const pages = statm.trim().split(/\s+/);
  if (pages.length > 0) setProcessVirtualMemoryBytes(Number(pages[0]) * 4096);
}

export function startServerLifecycle(): () => void {
  void runBackgroundTask('active-device-refresh', refreshActiveDevices);
  void runBackgroundTask('entity-count-refresh', refreshEntityCounts);
  void runBackgroundTask('process-metrics-refresh', refreshProcessMetrics);
  void runBackgroundTask('domain-reverification', reverifyAllDomains);

  const timers = [
    scheduleBackgroundTask('active-device-refresh', ACTIVE_DEVICE_REFRESH_MS, refreshActiveDevices),
    scheduleBackgroundTask('entity-count-refresh', ENTITY_COUNT_REFRESH_MS, refreshEntityCounts),
    scheduleBackgroundTask('process-metrics-refresh', PROCESS_METRICS_REFRESH_MS, refreshProcessMetrics),
    scheduleBackgroundTask('domain-reverification', DOMAIN_REVERIFY_REFRESH_MS, reverifyAllDomains),
  ];

  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
