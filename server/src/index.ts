import { setupMetricsServer, setupServer } from './api/server';
import { countActiveDevices, countDevices, disconnect, getUserCount } from './lib/db';
import { setActiveDevices, setTotalDevices, setTotalUsers } from './lib/metrics';
import { getRedis, closeRedis } from './lib/redis';
import { createLogger } from './lib/logger';
import { API_PORT, METRICS_PORT, REDIS_URL } from './env';

const log = createLogger('server');

const ACTIVE_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DEVICE_REFRESH_MS = 60_000;
const ENTITY_COUNT_REFRESH_MS = 60_000;

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

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutting down');

  clearInterval(activeDevicesTimer);
  clearInterval(entityCountTimer);
  await httpServer.stop();
  await metricsServer.stop();
  await closeRedis();
  await disconnect();

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
