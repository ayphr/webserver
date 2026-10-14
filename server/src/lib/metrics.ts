import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'ayphr_' });

/** Upper bound extended past the old 5s ceiling so slow requests stay measurable. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const COUNT_BUCKETS = [1, 10, 50, 100, 500, 1000, 5000, 10000];

export const httpRequestsTotal = new Counter({
  name: 'ayphr_http_requests_total',
  help: 'Total HTTP requests handled by the server.',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'ayphr_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route'],
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const httpRequestsInFlight = new Gauge({
  name: 'ayphr_http_requests_in_flight',
  help: 'HTTP requests currently being processed.',
  registers: [registry],
});

export const activeDevices = new Gauge({
  name: 'ayphr_active_devices',
  help: 'Devices that uploaded data in the last 24 hours.',
  registers: [registry],
});

export const telemetryRecordsAcceptedTotal = new Counter({
  name: 'ayphr_telemetry_records_accepted_total',
  help: 'Data points accepted from authenticated device uploads.',
  registers: [registry],
});

export const telemetryRecordsPersistedTotal = new Counter({
  name: 'ayphr_telemetry_records_persisted_total',
  help: 'Data points written to the database.',
  registers: [registry],
});

export const telemetryUploadBatchSize = new Histogram({
  name: 'ayphr_telemetry_upload_batch_size',
  help: 'Number of data points per device upload.',
  buckets: COUNT_BUCKETS,
  registers: [registry],
});

export const telemetryUploadDuration = new Histogram({
  name: 'ayphr_telemetry_upload_duration_seconds',
  help: 'Time taken to persist a device upload.',
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const telemetryUploadErrorsTotal = new Counter({
  name: 'ayphr_telemetry_upload_errors_total',
  help: 'Device uploads that failed to persist.',
  registers: [registry],
});

export const mongoOperationsTotal = new Counter({
  name: 'ayphr_mongo_operations_total',
  help: 'MongoDB operations issued by the application.',
  labelNames: ['operation', 'collection'],
  registers: [registry],
});

export function recordMongoOperation(operation: string, collection: string, count = 1) {
  mongoOperationsTotal.inc({ operation, collection }, count);
}

export function setActiveDevices(count: number) {
  activeDevices.set(count);
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
