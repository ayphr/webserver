import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'ayphr_' });

/** Upper bound extended past the old 5s ceiling so slow requests stay measurable. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];
const COUNT_BUCKETS = [1, 10, 50, 100, 500, 1000, 5000, 10000];
const RESPONSE_SIZE_BUCKETS = [100, 500, 1000, 5000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000];
const TEMPERATURE_BUCKETS = [-30, -20, -10, 0, 5, 10, 15, 18, 20, 22, 25, 30, 35, 40, 50];
const HUMIDITY_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];
const PRESSURE_BUCKETS = [900, 950, 975, 990, 1000, 1010, 1013, 1020, 1030, 1050, 1100];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

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

export const httpResponseSize = new Histogram({
  name: 'ayphr_http_response_size_bytes',
  help: 'HTTP response body size in bytes, when a Content-Length is provided.',
  labelNames: ['method', 'route'],
  buckets: RESPONSE_SIZE_BUCKETS,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Devices / telemetry
// ---------------------------------------------------------------------------

export const activeDevices = new Gauge({
  name: 'ayphr_active_devices',
  help: 'Devices that uploaded data in the last 24 hours.',
  registers: [registry],
});

export const totalDevices = new Gauge({
  name: 'ayphr_devices_total',
  help: 'Total registered devices.',
  registers: [registry],
});

export const devicesRegisteredTotal = new Counter({
  name: 'ayphr_devices_registered_total',
  help: 'Devices that completed their first upload and were registered.',
  registers: [registry],
});

export const deviceClaimsTotal = new Counter({
  name: 'ayphr_device_claims_total',
  help: 'Device claim-token lifecycle events (created, claimed).',
  labelNames: ['event'],
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

export const telemetryTemperature = new Histogram({
  name: 'ayphr_telemetry_temperature_celsius',
  help: 'Observed device temperature readings in degrees Celsius.',
  buckets: TEMPERATURE_BUCKETS,
  registers: [registry],
});

export const telemetryHumidity = new Histogram({
  name: 'ayphr_telemetry_humidity_percent',
  help: 'Observed device relative humidity readings in percent.',
  buckets: HUMIDITY_BUCKETS,
  registers: [registry],
});

export const telemetryAirPressure = new Histogram({
  name: 'ayphr_telemetry_air_pressure_hpa',
  help: 'Observed device air pressure readings in hectopascals.',
  buckets: PRESSURE_BUCKETS,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Accounts, auth and rate limiting
// ---------------------------------------------------------------------------

export const totalUsers = new Gauge({
  name: 'ayphr_users_total',
  help: 'Total registered user accounts.',
  registers: [registry],
});

export const userRegistrationsByCountry = new Counter({
  name: 'ayphr_user_registrations_by_country_total',
  help: 'User registrations grouped by ISO 3166-1 alpha-2 country code.',
  labelNames: ['country'],
  registers: [registry],
});

export const authEventsTotal = new Counter({
  name: 'ayphr_auth_events_total',
  help: 'Authentication and account lifecycle events.',
  labelNames: ['event', 'result'],
  registers: [registry],
});

export const sessionsTotal = new Counter({
  name: 'ayphr_sessions_total',
  help: 'Session lifecycle events (created, logout, revoked, revoked_all).',
  labelNames: ['event'],
  registers: [registry],
});

export const rateLimitChecksTotal = new Counter({
  name: 'ayphr_rate_limit_checks_total',
  help: 'Rate limit decisions by limiter and outcome.',
  labelNames: ['limiter', 'result'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Staff / moderation
// ---------------------------------------------------------------------------

export const staffActionsTotal = new Counter({
  name: 'ayphr_staff_actions_total',
  help: 'Staff-initiated administrative actions.',
  labelNames: ['action'],
  registers: [registry],
});

export const punishmentsTotal = new Counter({
  name: 'ayphr_punishments_total',
  help: 'Punishments issued and lifted, by type and action.',
  labelNames: ['type', 'action'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const profileUpdatesTotal = new Counter({
  name: 'ayphr_profile_updates_total',
  help: 'Profile field updates by field group.',
  labelNames: ['field'],
  registers: [registry],
});

export const avatarEventsTotal = new Counter({
  name: 'ayphr_avatar_events_total',
  help: 'Avatar upload and deletion events.',
  labelNames: ['event'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Billing / Stripe
// ---------------------------------------------------------------------------

export const stripeWebhookEventsTotal = new Counter({
  name: 'ayphr_stripe_webhook_events_total',
  help: 'Stripe webhook events received, by Stripe event type.',
  labelNames: ['type'],
  registers: [registry],
});

export const stripeWebhookErrorsTotal = new Counter({
  name: 'ayphr_stripe_webhook_errors_total',
  help: 'Stripe webhook events that failed to verify or process.',
  labelNames: ['type'],
  registers: [registry],
});

export const subscriptionEventsTotal = new Counter({
  name: 'ayphr_subscription_events_total',
  help: 'Application-level subscription events (checkout, portal, auto-renew).',
  labelNames: ['event'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Storage / cache
// ---------------------------------------------------------------------------

export const mongoOperationsTotal = new Counter({
  name: 'ayphr_mongo_operations_total',
  help: 'MongoDB operations issued by the application.',
  labelNames: ['operation', 'collection'],
  registers: [registry],
});

export const cacheOperationsTotal = new Counter({
  name: 'ayphr_cache_operations_total',
  help: 'Redis cache operations by result (hit, miss, set, del, error).',
  labelNames: ['cache', 'result'],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function recordMongoOperation(operation: string, collection: string, count = 1) {
  mongoOperationsTotal.inc({ operation, collection }, count);
}

export function setActiveDevices(count: number) {
  activeDevices.set(count);
}

export function setTotalDevices(count: number) {
  totalDevices.set(count);
}

export function setTotalUsers(count: number) {
  totalUsers.set(count);
}

/** Records the sensor distribution of every accepted upload batch. */
export function observeTelemetryValues(
  points: ReadonlyArray<{ temperature: number; humidity: number; airPressure: number }>,
) {
  for (const point of points) {
    telemetryTemperature.observe(point.temperature);
    telemetryHumidity.observe(point.humidity);
    telemetryAirPressure.observe(point.airPressure);
  }
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
