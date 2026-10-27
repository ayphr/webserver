import { isDuplicateKeyError, json, readJsonBody } from '../../lib/http';
import { randomBytes } from 'node:crypto';
import { requireAuth } from '../auth';
import {
  cacheDevice,
  createDevice,
  deleteDeviceClaim,
  getDataPointStats,
  getDeviceBySerial,
  getDeviceClaimByTokenHash,
  getDevicesForOwnerUuid,
  invalidateDeviceCachesForOwner,
  setDeviceClaim,
  toPublicDevice,
  updateDeviceLastUpload,
  upsertDataPoints,
  type DeviceDocument,
} from '../../lib/db';
import { hashToken } from '../../lib/tokens';
import {
  deviceClaimsTotal,
  devicesRegisteredTotal,
  observeTelemetryValues,
  telemetryRecordsAcceptedTotal,
  telemetryRecordsPersistedTotal,
  telemetryUploadBatchSize,
  telemetryUploadDuration,
  telemetryUploadErrorsTotal,
} from '../../lib/metrics';
import { DEVICE_TOKEN_TTL_MS } from '../../env';
import type { DataPoint, DeviceSummary, User } from '@common';

const MAX_SERIAL = 0xFFFFFFFF;
const MAX_NAME_LENGTH = 64;
const MAX_POINTS_PER_UPLOAD = 2_000;

function parseSerial(value: unknown): number | null {
  let serial: number;

  if (typeof value === 'number') {
    serial = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    serial = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_SERIAL) return null;

  return serial;
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function parseTimestamp(value: unknown): Date | null {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.round(ms / 1000) * 1000);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDataPoints(value: unknown): DataPoint[] | null {
  if (!Array.isArray(value) || value.length > MAX_POINTS_PER_UPLOAD) return null;

  // Rounding collapses sub-second readings onto the same second; keep the last
  // value seen for each timestamp so a single batch cannot upsert twice.
  const byTimestamp = new Map<number, DataPoint>();

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;

    const item = entry as Record<string, unknown>;
    const timestamp = parseTimestamp(item.timestamp);

    if (
      !timestamp ||
      !isFiniteNumber(item.temperature) ||
      !isFiniteNumber(item.humidity) ||
      !isFiniteNumber(item.airPressure)
    ) {
      return null;
    }

    byTimestamp.set(timestamp.getTime(), {
      timestamp,
      temperature: item.temperature,
      humidity: item.humidity,
      airPressure: item.airPressure,
    });
  }

  return [...byTimestamp.values()];
}

function getDeviceToken(request: Request, body: Record<string, unknown> | null): string | null {
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  const authHeader = request.headers.get('Authorization') ?? request.headers.get('Authentication');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  return null;
}

const handleCreateToken = requireAuth(async (_request, user: User) => {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_MS);

  await setDeviceClaim({
    ownerUuid: user.uuid,
    ownerUsername: user.username,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
  });
  deviceClaimsTotal.inc({ event: 'created' });

  return json({ token, expiresAt }, 201);
});

const handleListMine = requireAuth(async (_request, user: User) => {
  const devices = await getDevicesForOwnerUuid(user.uuid);
  const stats = await getDataPointStats(devices.map((device) => device.serial), user.uuid);

  const summaries: DeviceSummary[] = devices.map((device) => {
    const stat = stats.get(device.serial);
    return {
      ...toPublicDevice(device),
      dataPointCount: stat?.count ?? 0,
      latestDataPoint: stat?.latest ?? null,
    };
  });

  return json({ devices: summaries });
});

const handleGetBySerial = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  if (device.ownerUuid !== user.uuid) return json({ error: 'forbidden' }, 403);

  return json({ device: toPublicDevice(device) });
});

async function handleUpload(request: Request): Promise<Response> {
  const endTimer = telemetryUploadDuration.startTimer();

  try {
    const body = await readJsonBody(request);
    const serial = parseSerial(body?.serial);
    const name = parseName(body?.name);
    const token = getDeviceToken(request, body);
    const points = parseDataPoints(body?.data);

    if (serial === null) return json({ error: 'invalid serial' }, 400);
    if (name === null) return json({ error: 'invalid device name' }, 400);
    if (!token) return json({ error: 'missing device token' }, 401);
    if (!points) return json({ error: 'invalid data' }, 400);

    const tokenHash = hashToken(token);
    const now = new Date();
    const existing = await getDeviceBySerial(serial);
    let device: DeviceDocument;
    let created = false;

    if (existing) {
      if (existing.tokenHash !== tokenHash) {
        return json({ error: 'invalid device token' }, 401);
      }
      device = existing;
    } else {
      const claim = await getDeviceClaimByTokenHash(tokenHash);

      if (!claim || claim.expiresAt.getTime() <= now.getTime()) {
        return json({ error: 'invalid or expired device token' }, 401);
      }

      const newDevice: DeviceDocument = {
        serial,
        name,
        ownerUuid: claim.ownerUuid,
        ownerUsername: claim.ownerUsername,
        registeredAt: now,
        lastUploadAt: now,
        tokenHash,
        tokenCreatedAt: now,
      };

      try {
        await createDevice(newDevice);
        device = newDevice;
        created = true;
        await deleteDeviceClaim(claim.ownerUuid);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;

        const raced = await getDeviceBySerial(serial);
        if (raced?.tokenHash !== tokenHash) {
          return json({ error: 'invalid device token' }, 401);
        }
        device = raced;
      }
    }

    const [accepted] = await Promise.all([
      upsertDataPoints(serial, points),
      updateDeviceLastUpload(serial, now),
    ]);

    device.lastUploadAt = now;
    await cacheDevice(device);
    await invalidateDeviceCachesForOwner(device.ownerUuid);

    telemetryRecordsAcceptedTotal.inc(points.length);
    telemetryRecordsPersistedTotal.inc(accepted);
    telemetryUploadBatchSize.observe(points.length);
    observeTelemetryValues(points);

    if (created) {
      devicesRegisteredTotal.inc();
      deviceClaimsTotal.inc({ event: 'claimed' });
    }

    return json({ device: toPublicDevice(device), accepted }, created ? 201 : 200);
  } catch (error) {
    telemetryUploadErrorsTotal.inc();
    throw error;
  } finally {
    endTimer();
  }
}

export { handleCreateToken, handleListMine, handleGetBySerial, handleUpload };
