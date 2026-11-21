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

const log = createLogger('device-logs');

export type DeviceLogInput = {
  /** Omitted for events that happen before the upload can be attributed. */
  serial?: number;
  teamId?: string;
  event: DeviceLogEvent;
  level: DeviceLogLevel;
  message: string;
  details?: Record<string, unknown>;
};

export type DeviceLogListOptions = {
  skip?: number;
  limit?: number;
};

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

function buildDeviceLogQuery(serial: number) {
  // TTL deletion is asynchronous, so also exclude expired documents from reads.
  const cutoff = new Date(Date.now() - DEVICE_LOG_MAX_AGE_SECONDS * 1000);
  return { serial, createdAt: { $gte: cutoff } };
}

export async function listDeviceLogs(
  serial: number,
  options: DeviceLogListOptions = {},
): Promise<DeviceLog[]> {
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('find', DEVICE_LOGS_COLLECTION);
  let cursor = logs
    .find(buildDeviceLogQuery(serial))
    .project<DeviceLog>({ _id: 0 })
    .sort({ createdAt: -1 });
  if (options.skip) cursor = cursor.skip(options.skip);
  if (options.limit !== undefined) cursor = cursor.limit(options.limit);
  return cursor.toArray();
}

export async function countDeviceLogs(serial: number): Promise<number> {
  const logs = await getCollection('deviceLogs');
  trackMongoOperation('countDocuments', DEVICE_LOGS_COLLECTION);
  return logs.countDocuments(buildDeviceLogQuery(serial));
}

/** Backwards-compatible capped read helper. */
export async function getDeviceLogs(serial: number, limit = 100): Promise<DeviceLog[]> {
  return listDeviceLogs(serial, { limit });
}
