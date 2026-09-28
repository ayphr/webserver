import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'ayphr_' });

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
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const activeDevices = new Gauge({
  name: 'ayphr_active_devices',
  help: 'Number of devices currently connected over the TCP listener.',
  registers: [registry],
});

export const packetsReceivedTotal = new Counter({
  name: 'ayphr_packets_received_total',
  help: 'Total packets received by the server over the TCP listener.',
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

export function recordActiveDevices(delta: number) {
  activeDevices.inc(delta);
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
