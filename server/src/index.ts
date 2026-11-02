import { setupMetricsServer, setupServer } from './api/server';
import { countActiveDevices, countDevices, disconnect, getUserCount } from './lib/db';
import { reverifyAllDomains } from './lib/domainReverification';
import { setActiveDevices, setProcessMaxFds, setProcessOpenFds, setProcessVirtualMemoryBytes, setTotalDevices, setTotalUsers } from './lib/metrics';
import { getRedis, closeRedis } from './lib/redis';
import { createLogger } from './lib/logger';
import { API_PORT, METRICS_PORT, REDIS_URL } from './env';

const log = createLogger('server');

const ACTIVE_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DEVICE_REFRESH_MS = 60_000;
const ENTITY_COUNT_REFRESH_MS = 60_000;
const DOMAIN_REVERIFY_REFRESH_MS = 5 * 60 * 1000;

if (REDIS_URL) {
  if (getRedis()) {
    log.info({}, 'redis cache enabled');
  } else {
    log.warn({}, 'redis unavailable at startup; running without cache');
  }
} else {
  log.warn({}, 'REDIS_URL not set; caching and distributed rate limits disabled');
}

const httpServer = setupServer(API_PORT, () => log.info({ port: API_PORT }, 'API server listening'));
const metricsServer = setupMetricsServer(METRICS_PORT, () => log.info({ port: METRICS_PORT }, 'metrics server listening'));

async function refreshActiveDevices() {
  try {
    const since = new Date(Date.now() - ACTIVE_DEVICE_WINDOW_MS);
    setActiveDevices(await countActiveDevices(since));
  } catch (error) {
    log.warn({ error }, 'failed to refresh active device count');
  }
}

/** Refreshes the coarse business gauges shown on the dashboard. */
async function refreshEntityCounts() {
  const [users, devices] = await Promise.allSettled([getUserCount(), countDevices()]);

  if (users.status === 'fulfilled') {
    setTotalUsers(users.value);
  } else {
    log.warn({ error: users.reason }, 'failed to refresh user count');
  }

  if (devices.status === 'fulfilled') {
    setTotalDevices(devices.value);
  } else {
    log.warn({ error: devices.reason }, 'failed to refresh device count');
  }
}

void refreshActiveDevices();
void refreshEntityCounts();
const activeDevicesTimer = setInterval(() => void refreshActiveDevices(), ACTIVE_DEVICE_REFRESH_MS);
const entityCountTimer = setInterval(() => void refreshEntityCounts(), ENTITY_COUNT_REFRESH_MS);

// Best-effort process-level gauges that prom-client does not expose under Bun
// (file descriptors, virtual memory). Sourced from /proc on Linux containers.
const PROCESS_METRICS_REFRESH_MS = 60_000;
async function refreshProcessMetrics() {
  if (process.platform !== 'linux') return;
  try {
    const fs = await import('node:fs/promises');
    const fdEntries = await fs.readdir('/proc/self/fd').catch(() => [] as string[]);
    setProcessOpenFds(fdEntries.length);

    const limits = await fs.readFile('/proc/self/limits', 'utf8').catch(() => '');
    const match = limits.match(/Max open files\s+(\d+)/);
    if (match) setProcessMaxFds(Number(match[1]));

    const statm = await fs.readFile('/proc/self/statm', 'utf8').catch(() => '');
    const pages = statm.trim().split(/\s+/);
    if (pages.length > 0) {
      const pageSize = 4096;
      setProcessVirtualMemoryBytes(Number(pages[0]) * pageSize);
    }
  } catch (error) {
    log.warn({ error }, 'failed to refresh process metrics');
  }
}
void refreshProcessMetrics();
const processMetricsTimer = setInterval(() => void refreshProcessMetrics(), PROCESS_METRICS_REFRESH_MS);
const domainReverifyTimer = setInterval(() => void reverifyAllDomains().catch(() => {}), DOMAIN_REVERIFY_REFRESH_MS);
void reverifyAllDomains().catch(() => {});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutting down');

  clearInterval(activeDevicesTimer);
  clearInterval(entityCountTimer);
  clearInterval(domainReverifyTimer);
  clearInterval(processMetricsTimer);
  await httpServer.stop();
  await metricsServer.stop();
  await closeRedis();
  await disconnect();

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
