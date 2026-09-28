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
  help: 'Number of devices currently connected over the TCP listener.',
  registers: [registry],
});

export const packetsReceivedTotal = new Counter({
  name: 'ayphr_packets_received_total',
  help: 'Total packets received by the server over the TCP listener.',
  registers: [registry],
});

export const tcpConnectionsTotal = new Counter({
  name: 'ayphr_tcp_connections_total',
  help: 'Total TCP connections accepted by the device listener.',
  registers: [registry],
});

export const tcpConnectionErrorsTotal = new Counter({
  name: 'ayphr_tcp_connection_errors_total',
  help: 'Total socket errors observed on the device listener.',
  registers: [registry],
});

export const tcpBytesReceivedTotal = new Counter({
  name: 'ayphr_tcp_bytes_received_total',
  help: 'Total raw bytes received over the device listener.',
  registers: [registry],
});

export const tcpConnectionDuration = new Histogram({
  name: 'ayphr_tcp_connection_duration_seconds',
  help: 'Lifetime of device TCP connections, from accept to close.',
  buckets: DURATION_BUCKETS,
  registers: [registry],
});

export const telemetryRecordsBufferedTotal = new Counter({
  name: 'ayphr_telemetry_records_buffered_total',
  help: 'Total telemetry records successfully buffered in Redis.',
  registers: [registry],
});

export const telemetryEnqueueErrorsTotal = new Counter({
  name: 'ayphr_telemetry_enqueue_errors_total',
  help: 'Total failures buffering a telemetry record in Redis.',
  registers: [registry],
});

export const telemetryDrainErrorsTotal = new Counter({
  name: 'ayphr_telemetry_drain_errors_total',
  help: 'Total failures draining the telemetry buffer, which risk dropping records.',
  registers: [registry],
});

export const telemetryBufferLength = new Gauge({
  name: 'ayphr_telemetry_buffer_length',
  help: 'Telemetry records found waiting in the Redis buffer at the last drain.',
  registers: [registry],
});

export const telemetryRecordsFlushedTotal = new Counter({
  name: 'ayphr_telemetry_records_flushed_total',
  help: 'Total telemetry records handed to the database worker.',
  registers: [registry],
});

export const telemetryFlushBatchSize = new Histogram({
  name: 'ayphr_telemetry_flush_batch_size',
  help: 'Number of telemetry records per database flush.',
  buckets: COUNT_BUCKETS,
  registers: [registry],
});

export const telemetryFlushDuration = new Histogram({
  name: 'ayphr_telemetry_flush_duration_seconds',
  help: 'Time taken to drain the Redis buffer and dispatch it to the database worker.',
  buckets: DURATION_BUCKETS,
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
