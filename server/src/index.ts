import { setupMetricsServer, setupServer } from './api/server';
import { disconnect } from './lib/db';
import { getRedis, closeRedis } from './lib/redis';
import { createLogger } from './lib/logger';
import { API_PORT, assertValidEnvironment, METRICS_PORT, REDIS_URL } from './env';
import { startServerLifecycle } from './lib/serverLifecycle';

const log = createLogger('server');
const envValidation = assertValidEnvironment();
for (const warning of envValidation.warnings) {
  log.warn({}, warning);
}

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

const stopServerLifecycle = startServerLifecycle();

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, 'shutting down');

  stopServerLifecycle();
  await httpServer.stop();
  await metricsServer.stop();
  await closeRedis();
  await disconnect();

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
