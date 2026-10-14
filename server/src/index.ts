import { setupMetricsServer, setupServer } from './api/server';
import { countActiveDevices, disconnect } from './lib/db';
import { setActiveDevices } from './lib/metrics';
import { createLogger } from './lib/logger';
import { API_PORT, METRICS_PORT } from './env';

const log = createLogger('server');

const ACTIVE_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DEVICE_REFRESH_MS = 60_000;

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

void refreshActiveDevices();
const activeDevicesTimer = setInterval(() => void refreshActiveDevices(), ACTIVE_DEVICE_REFRESH_MS);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutting down');

  clearInterval(activeDevicesTimer);
  await httpServer.stop();
  await metricsServer.stop();
  await disconnect();

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
