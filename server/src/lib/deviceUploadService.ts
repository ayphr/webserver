import type { DataPoint } from '@common';
import {
  cacheDevice,
  createDeviceToken,
  getDeviceBySerial,
  getDeviceByTokenHash,
  getDeviceTokenByHash,
  invalidateDeviceStatsForOwner,
  updateDeviceLastUpload,
  updateDeviceTokenLastUsed,
  upsertDataPoints,
  type DeviceDocument,
} from './db';
import { hashToken } from './tokens';
import { resolveLocationFromClient } from './session';
import { pruneOwnerDataPoints } from '../api/routes/deviceRetention';
import { evaluateAlertsForDevice } from './alerts';
import { queueDeviceLog } from './deviceLogService';
import { createLogger } from './logger';

const log = createLogger('device-upload');

type UploadResult =
  | { kind: 'missing-token' }
  | { kind: 'invalid-device' }
  | { kind: 'device-not-linked' }
  | { kind: 'token-revoked' }
  | { kind: 'accepted'; device: DeviceDocument; accepted: number; pointCount: number };

export async function uploadDeviceTelemetry(params: {
  token: string | null;
  points: DataPoint[] | null;
  metadata: Record<string, unknown> | null;
  userAgent?: string;
}): Promise<UploadResult> {
  const { token, points, metadata, userAgent } = params;
  if (!token) {
    queueDeviceLog({
      event: 'auth_error',
      level: 'error',
      message: 'Upload rejected: missing device token',
      details: { reason: 'missing-token', ...(userAgent ? { userAgent } : {}) },
    });
    return { kind: 'missing-token' };
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  let tokenRecord = await getDeviceTokenByHash(tokenHash);
  const device = tokenRecord
    ? await getDeviceBySerial(tokenRecord.serial)
    : await getDeviceByTokenHash(tokenHash);

  if (!points) {
    queueDeviceLog({
      serial: device?.serial,
      teamId: device?.teamId,
      event: 'malformed_data',
      level: 'error',
      message: 'Upload rejected: malformed telemetry data',
      details: { reason: 'invalid-data', ...(userAgent ? { userAgent } : {}) },
    });
    return { kind: 'invalid-device' };
  }

  if (!device) {
    queueDeviceLog({
      event: 'auth_error',
      level: 'error',
      message: 'Upload rejected: device token is not linked to a device',
      details: { reason: 'unknown-token', ...(userAgent ? { userAgent } : {}) },
    });
    return { kind: 'device-not-linked' };
  }

  if (!tokenRecord) {
    tokenRecord = await createDeviceToken({
      id: crypto.randomUUID(),
      serial: device.serial,
      teamId: device.teamId,
      tokenHash,
      createdAt: device.tokenCreatedAt ?? now,
      location: {},
      active: true,
    });
  }
  if (!tokenRecord.active) {
    queueDeviceLog({
      serial: device.serial,
      teamId: device.teamId,
      event: 'token_revoked',
      level: 'error',
      message: 'Upload rejected: device token has been revoked',
      details: { reason: 'token-inactive', ...(userAgent ? { userAgent } : {}) },
    });
    return { kind: 'token-revoked' };
  }

  const location = metadata
    ? resolveLocationFromClient({
        timezone: typeof metadata.timezone === 'string' ? metadata.timezone : undefined,
        locale: typeof metadata.locale === 'string' ? metadata.locale : undefined,
      })
    : undefined;

  const [accepted] = await Promise.all([
    upsertDataPoints(device.serial, points),
    updateDeviceLastUpload(device.serial, now),
    updateDeviceTokenLastUsed(tokenRecord.id, now, location, userAgent),
  ]);

  device.lastUploadAt = now;
  await cacheDevice(device);
  if (await pruneOwnerDataPoints(device.teamId)) {
    await invalidateDeviceStatsForOwner(device.teamId);
  }

  if (points.length > 0) {
    void evaluateAlertsForDevice(device, points).catch((error) => {
      log.error({ error, serial: device.serial }, 'failed to evaluate device alerts');
    });
  }

  queueDeviceLog({
    serial: device.serial,
    teamId: device.teamId,
    event: 'upload_success',
    level: 'info',
    message: `Accepted ${points.length.toLocaleString()} telemetry point${points.length === 1 ? '' : 's'}`,
    details: {
      pointCount: points.length,
      accepted,
      ...(userAgent ? { userAgent } : {}),
    },
  });

  return {
    kind: 'accepted',
    device,
    accepted,
    pointCount: points.length,
  };
}
