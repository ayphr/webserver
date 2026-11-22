import { randomUUID } from 'node:crypto';
import type { DeviceLog, DeviceLogEvent, DeviceLogLevel } from '@common';
import {
  DEVICE_LOG_MAX_AGE_SECONDS,
  DEVICE_LOGS_COLLECTION,
  getCollection,
  normalizeDateValues,
  trackMongoOperation,
} from './db/internal';
import { createLogger } from './logger';
import { parseIsoTimestamp } from './deviceExportService';

const log = createLogger('device-logs');

export const DEVICE_LOG_LEVELS: readonly DeviceLogLevel[] = ['info', 'warning', 'error'];

export const DEVICE_LOG_EVENTS: readonly DeviceLogEvent[] = [
  'upload_success',
  'upload_error',
  'auth_error',
  'malformed_data',
  'rate_limited',
  'token_revoked',
];

export const MAX_DEVICE_LOG_QUERY_LENGTH = 100;
export const DEVICE_LOG_EXPORT_LIMIT = 10_000;

export type DeviceLogInput = {
  /** Omitted for events that happen before the upload can be attributed. */
  serial?: number;
  teamId?: string;
  event: DeviceLogEvent;
  level: DeviceLogLevel;
  message: string;
  details?: Record<string, unknown>;
};

/** Server-side form of DeviceLogListQuery after query-string validation. */
export type DeviceLogFilter = {
  level?: DeviceLogLevel;
  event?: DeviceLogEvent;
  q?: string;
  from?: Date;
  to?: Date;
  /** Retention cutoff computed once per request so list/count agree exactly. */
  cutoff?: Date;
};

export type DeviceLogFilterResult = {
  filter: DeviceLogFilter;
  error: string | null;
};

export type DeviceLogListOptions = {
  skip?: number;
  limit?: number;
  filter?: DeviceLogFilter;
};

export function parseDeviceLogFilter(params: URLSearchParams): DeviceLogFilterResult {
  const filter: DeviceLogFilter = {
    cutoff: new Date(Date.now() - DEVICE_LOG_MAX_AGE_SECONDS * 1000),
  };

  const level = params.get('level');
  if (level && level !== 'all') {
    if (!(DEVICE_LOG_LEVELS as readonly string[]).includes(level)) {
      return { filter, error: 'invalid level' };
    }
    filter.level = level as DeviceLogLevel;
  }

  const event = params.get('event');
  if (event && event !== 'all') {
    if (!(DEVICE_LOG_EVENTS as readonly string[]).includes(event)) {
      return { filter, error: 'invalid event' };
    }
    filter.event = event as DeviceLogEvent;
  }

  const q = params.get('q')?.trim();
  if (q) {
    if (q.length > MAX_DEVICE_LOG_QUERY_LENGTH) {
      return { filter, error: 'q must be 100 characters or fewer' };
    }
    filter.q = q;
  }

  const fromParam = params.get('from');
  const toParam = params.get('to');
  const from = fromParam ? parseIsoTimestamp(fromParam) : null;
  const to = toParam ? parseIsoTimestamp(toParam) : null;
  if (fromParam && !from) return { filter, error: 'invalid from timestamp' };
  if (toParam && !to) return { filter, error: 'invalid to timestamp' };
  if (from && to && from.getTime() > to.getTime()) {
    return { filter, error: 'from must be before to' };
  }
  if (from) filter.from = from;
  if (to) filter.to = to;

  return { filter, error: null };
}

export async function recordDeviceLog(input: DeviceLogInput): Promise<DeviceLog> {
  const entry: DeviceLog = {
    id: randomUUID(),
    ...input,
    createdAt: new Date(),
  };
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('insertOne', DEVICE_LOGS_COLLECTION);
  await logs.insertOne(normalizeDateValues(entry));
  return entry;
}

/** Logging must never fail the telemetry request that triggered it. */
export function queueDeviceLog(input: DeviceLogInput): void {
  void recordDeviceLog(input).catch((error) => {
    log.warn({ error, serial: input.serial, event: input.event }, 'failed to record device log');
  });
}

export function buildDeviceLogQuery(serial: number, filter: DeviceLogFilter = {}) {
  // TTL deletion is asynchronous, so also exclude expired documents from reads.
  const cutoffMs = filter.cutoff?.getTime() ?? Date.now() - DEVICE_LOG_MAX_AGE_SECONDS * 1000;
  const createdAt: Record<string, Date> = {
    $gte: new Date(Math.max(cutoffMs, filter.from?.getTime() ?? cutoffMs)),
  };
  if (filter.to) createdAt.$lte = filter.to;

  const query: Record<string, unknown> = { serial, createdAt };
  if (filter.level) query.level = filter.level;
  if (filter.event) query.event = filter.event;
  if (filter.q) {
    // Treat q as a literal substring; user input must not become a regex.
    const pattern = filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { message: { $regex: pattern, $options: 'i' } },
      { event: { $regex: pattern, $options: 'i' } },
    ];
  }
  return query;
}

export async function listDeviceLogs(
  serial: number,
  options: DeviceLogListOptions = {},
): Promise<DeviceLog[]> {
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('find', DEVICE_LOGS_COLLECTION);
  let cursor = logs
    .find(buildDeviceLogQuery(serial, options.filter))
    .project<DeviceLog>({ _id: 0 })
    .sort({ createdAt: -1 });
  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);
  return cursor.toArray();
}

export async function countDeviceLogs(serial: number, filter: DeviceLogFilter = {}): Promise<number> {
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('countDocuments', DEVICE_LOGS_COLLECTION);
  return logs.countDocuments(buildDeviceLogQuery(serial, filter));
}

/** Unsampled export read; fetches one extra row so truncation can be reported. */
export async function listDeviceLogsForExport(
  serial: number,
  filter: DeviceLogFilter = {},
): Promise<{ logs: DeviceLog[]; truncated: boolean }> {
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('find', DEVICE_LOGS_COLLECTION);
  const rows = await logs
    .find(buildDeviceLogQuery(serial, filter))
    .project<DeviceLog>({ _id: 0 })
    .sort({ createdAt: -1 })
    .limit(DEVICE_LOG_EXPORT_LIMIT + 1)
    .toArray();

  return {
    logs: rows.slice(0, DEVICE_LOG_EXPORT_LIMIT),
    truncated: rows.length > DEVICE_LOG_EXPORT_LIMIT,
  };
}

/** Backwards-compatible capped read helper. */
export async function getDeviceLogs(serial: number, limit = 100): Promise<DeviceLog[]> {
  return listDeviceLogs(serial, { limit });
}
