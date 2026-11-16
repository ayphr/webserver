import { json, readJsonBody } from '../../lib/http';
import { randomBytes, randomInt } from 'node:crypto';
import { requireAuth } from '../auth';
import {
  cacheDevice,
  countDevices,
  createDevice,
  createDevicePairing,
  ensureDefaultLocation,
  getDevicePairingByCode,
  getLocationById,
  markDevicePairingFetched,
  markDevicePairingLinked,
  countDataPointsForDevice,
  getDataPointStats,
  getDataPointsForDevice,
  getDataPointsForQuery,
  deleteAllDataPointsForDevice,
  deleteDataPointsForDevice,
  getDeviceBySerial,
  getDeviceByTokenHash,
  getDevicesForTeamId,
  getUserFromUuid,
  invalidateDeviceStatsForOwner,
  pruneDataPointsForSerials,
  toPublicDevice,
  updateDevice,
  updateDeviceLastUpload,
  updateDeviceLocation,
  updateDeviceToken,
  unlinkDevice,
  upsertDataPoints,
  type DeviceDocument,
} from '../../lib/db';
import { getTeamScopeUuid, getTeamScopeUsername, getTeamForUser, getTeamRole, getTeamSharedSeats, getTeamById } from '../../lib/db/teams';
import { hashToken } from '../../lib/tokens';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import {
  deviceClaimsTotal,
  setTotalDevices,
  devicesRegisteredTotal,
  observeTelemetryValues,
  telemetryRecordsAcceptedTotal,
  telemetryRecordsPersistedTotal,
  telemetryUploadBatchSize,
  telemetryUploadDuration,
  telemetryUploadErrorsTotal,
} from '../../lib/metrics';
import { consumeCredits, getCreditBalance } from '../../lib/credits';
import { PAIRING_CODE_TTL_MS } from '../../env';
import {
  PAIRING_CODE_LENGTH,
  compileQuery,
  estimateQueryComputeUnits,
  MAX_QUERY_POINTS,
  type DataPoint,
  type DeviceQueryRequest,
  type DeviceSummary,
  type User,
  getPlanFeaturesForUser,
} from '@common';
import { redisFixedWindow } from '../../lib/redis';
import { evaluateAlertsForDevice } from '../../lib/alerts';

const MAX_SERIAL = 0xFFFFFFFF;

const pairingRequestLimiter = createRateLimiter(15 * 60 * 1000, 20, 'pairing-request');
const linkCodeLimiter = createRateLimiter(15 * 60 * 1000, 20, 'link-code');
const fetchPairingTokenLimiter = createRateLimiter(15 * 60 * 1000, 20, 'fetch-pairing-token');
const deviceQueryLimiter = createRateLimiter(60 * 1000, 60, 'device-query');
const deviceUploadLimiter = createRateLimiter(60 * 1000, 120, 'device-upload');
const MAX_NAME_LENGTH = 64;
const MAX_POINTS_PER_UPLOAD = 2_000;
const MAX_QUERY_LENGTH = 10_000;
const DATA_POINT_PRUNE_COOLDOWN_MS = 5 * 60 * 1000;
const DATA_POINT_PRUNE_KEY_PREFIX = 'ayphr:telemetry:prune:';
const localDataPointPruneByOwner = new Map<string, number>();

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

function getDeviceToken(body: Record<string, unknown> | null): string | null {
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  return null;
}

async function shouldPruneOwnerDataPoints(teamId: string): Promise<boolean> {
  const now = Date.now();
  try {
    const { count } = await redisFixedWindow(
      `${DATA_POINT_PRUNE_KEY_PREFIX}${teamId}`,
      DATA_POINT_PRUNE_COOLDOWN_MS,
    );
    return count === 1;
  } catch {
    const lastPrunedAt = localDataPointPruneByOwner.get(teamId) ?? 0;
    if (now - lastPrunedAt < DATA_POINT_PRUNE_COOLDOWN_MS) return false;

    localDataPointPruneByOwner.set(teamId, now);
    if (localDataPointPruneByOwner.size > 10_000) {
      for (const [uuid, timestamp] of localDataPointPruneByOwner) {
        if (now - timestamp >= DATA_POINT_PRUNE_COOLDOWN_MS) localDataPointPruneByOwner.delete(uuid);
      }
      while (localDataPointPruneByOwner.size > 10_000) {
        const oldestUuid = localDataPointPruneByOwner.keys().next().value;
        if (oldestUuid === undefined) break;
        localDataPointPruneByOwner.delete(oldestUuid);
      }
    }
    return true;
  }
}

async function pruneOwnerDataPoints(
  teamId: string,
  user?: User,
  devices?: DeviceDocument[],
): Promise<boolean> {
  if (!(await shouldPruneOwnerDataPoints(teamId))) return false;

  try {
    const now = Date.now();
    let owner: User | undefined = user;
    if (!owner) {
      const team = await getTeamById(teamId);
      owner = team ? (await getUserFromUuid(team.managerUuid)) ?? undefined : (await getUserFromUuid(teamId)) ?? undefined;
    }
    const ownerDevices = devices ?? await getDevicesForTeamId(teamId);
    if (!owner) return false;

    const team = await getTeamForUser(owner);
    const manager = team ? await getUserFromUuid(team.managerUuid) : null;
    const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
    const features = getPlanFeaturesForUser(owner, seats);
    const cutoff = new Date(now - features.dataRetentionDays * 86_400_000);
    const removed = await pruneDataPointsForSerials(
      ownerDevices.map((device) => device.serial),
      features.sharedMaxDataPointsPerUser,
      cutoff,
    );
    return removed > 0;
  } catch (error) {
    console.error('Failed to prune data points:', error);
    return false;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

const handleRequestPairing = async (request: Request): Promise<Response> => {
  const ipCheck = await pairingRequestLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readJsonBody(request);
  const serial = parseSerial(body?.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const name = parseName(body?.name) ?? `Device ${serial}`;

  let code = generatePairingCode();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await getDevicePairingByCode(code);
    if (!existing) break;
    code = generatePairingCode();
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

  await createDevicePairing({
    code,
    serial,
    name,
    token,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
    linked: false,
  });

  deviceClaimsTotal.inc({ event: 'created' });

  return json({ code, expiresAt }, 201);
};

const handleLink = requireAuth(async (request, user: User) => {
  const ipCheck = await linkCodeLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const userCheck = await linkCodeLimiter.check(`user:${user.uuid}`);
  if (!userCheck.allowed) return tooManyRequests(userCheck.retryAfterMs);

  const scopeUuid = await getTeamScopeUuid(user);

  const body = await readJsonBody(request);
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) return json({ error: 'invalid code' }, 400);

  const requestedLocationId = typeof body?.locationId === 'string' ? body.locationId.trim() : null;

  let resolvedLocationId: string | null = null;
  if (requestedLocationId) {
    const requestedLocation = await getLocationById(requestedLocationId);
    if (requestedLocation?.teamId !== scopeUuid) {
      return json({ error: 'invalid location' }, 400);
    }
    resolvedLocationId = requestedLocation.id;
  }

  const pairing = await getDevicePairingByCode(code);
  const now = new Date();

  if (!pairing || pairing.expiresAt.getTime() <= now.getTime()) {
    return json({ error: 'invalid or expired code' }, 404);
  }

  if (pairing.linked) {
    return json({ error: 'code already used' }, 409);
  }

  const serial = pairing.serial;
  const name = pairing.name ?? `Device ${serial}`;
  const tokenHash = pairing.tokenHash;

  const existing = await getDeviceBySerial(serial);

  let device: DeviceDocument;

  if (existing) {
    if (existing.teamId !== scopeUuid) {
      return json({ error: 'forbidden' }, 403);
    }

    await updateDeviceToken(serial, tokenHash, pairing.createdAt);
    if (resolvedLocationId && existing.locationId !== resolvedLocationId) {
      await updateDeviceLocation(serial, resolvedLocationId);
      existing.locationId = resolvedLocationId;
    }
    device = { ...existing, tokenHash, tokenCreatedAt: pairing.createdAt };
  } else {
    const team = await getTeamForUser(user);
    if (team) {
      const role = getTeamRole(user);
      if (role === 'member') {
        return json({ error: 'Forbidden' }, 403);
      }
    }
    const ownedDevices = await getDevicesForTeamId(scopeUuid);
    const maxDevices = getPlanFeaturesForUser(user).maxDevices;
    if (ownedDevices.length >= maxDevices) {
      return json({ error: 'device limit reached for your plan' }, 409);
    }

    let locationId: string | undefined;
    if (resolvedLocationId) {
      locationId = resolvedLocationId;
    } else {
      const scopeUsername = await getTeamScopeUsername(user);
      const defaultLocation = await ensureDefaultLocation(scopeUuid, scopeUsername);
      locationId = defaultLocation.id;
    }

    const scopeUsername = await getTeamScopeUsername(user);
    const newDevice: DeviceDocument = {
      serial,
      name,
      teamId: scopeUuid,
      ownerUsername: scopeUsername,
      locationId,
      registeredAt: now,
      tokenHash,
      tokenCreatedAt: pairing.createdAt,
    };

    await createDevice(newDevice);
    device = newDevice;
    devicesRegisteredTotal.inc();
    try {
      setTotalDevices(await countDevices());
    } catch {
      // best effort
    }
  }

  const linked = await markDevicePairingLinked(code, user.uuid, user.username);
  if (!linked) {
    return json({ error: 'code already used' }, 409);
  }

  deviceClaimsTotal.inc({ event: 'claimed' });

  return json({ linked: true, device: toPublicDevice(device) }, 200);
});

const handleFetchPairingToken = async (request: Request, params: { code?: string }): Promise<Response> => {
  const ipCheck = await fetchPairingTokenLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const code = typeof params.code === 'string' ? params.code.trim().toUpperCase() : '';
  if (!code) return json({ error: 'invalid code' }, 400);

  const codeCheck = await fetchPairingTokenLimiter.check(`code:${code}`);
  if (!codeCheck.allowed) return tooManyRequests(codeCheck.retryAfterMs);

  const pairing = await getDevicePairingByCode(code);
  const now = new Date();

  if (!pairing || pairing.expiresAt.getTime() <= now.getTime()) {
    return json({ error: 'invalid or expired code' }, 404);
  }

  if (!pairing.linked) {
    return json({ error: 'not linked yet' }, 404);
  }

  const response = json({ token: pairing.token, serial: pairing.serial }, 200);

  await markDevicePairingFetched(code);

  return response;
};

const handleListMine = requireAuth(async (_request, user: User) => {
  const scopeUuid = await getTeamScopeUuid(user);
  const scopeUsername = await getTeamScopeUsername(user);
  await ensureDefaultLocation(scopeUuid, scopeUsername);
  const devices = await getDevicesForTeamId(scopeUuid);

  if (await pruneOwnerDataPoints(scopeUuid, user, devices)) {
    await invalidateDeviceStatsForOwner(scopeUuid);
  }

  const stats = await getDataPointStats(devices.map((device) => device.serial), scopeUuid);

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

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return json({ device: toPublicDevice(device) });
});

async function handleUpload(request: Request): Promise<Response> {
  const ipCheck = await deviceUploadLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const endTimer = telemetryUploadDuration.startTimer();

  try {
    const body = await readJsonBody(request);
    const token = getDeviceToken(body);
    const points = parseDataPoints(body?.data);

    if (!token) return json({ error: 'missing device token' }, 401);
    if (!points) return json({ error: 'invalid data' }, 400);

    const tokenHash = hashToken(token);
    const now = new Date();
    const existing = await getDeviceByTokenHash(tokenHash);

    if (!existing) {
      return json({ error: 'device not linked' }, 404);
    }

    const device = existing;
    const serial = device.serial;

    const [accepted] = await Promise.all([
      upsertDataPoints(serial, points),
      updateDeviceLastUpload(serial, now),
    ]);

    device.lastUploadAt = now;
    await cacheDevice(device);

    if (await pruneOwnerDataPoints(device.teamId)) {
      await invalidateDeviceStatsForOwner(device.teamId);
    }

    telemetryRecordsAcceptedTotal.inc(points.length);
    telemetryRecordsPersistedTotal.inc(accepted);
    telemetryUploadBatchSize.observe(points.length);
    observeTelemetryValues(points);

    if (points.length > 0) {
      void evaluateAlertsForDevice(device, points).catch((error) => {
        console.error('Failed to evaluate device alerts:', error);
      });
    }

    return json({ device: toPublicDevice(device), accepted }, 200);
  } catch (error) {
    telemetryUploadErrorsTotal.inc();
    throw error;
  } finally {
    endTimer();
  }
}

function resolveTimeRange(period: string, fromParam?: string | null, toParam?: string | null) {
  let since: Date | undefined;
  let until: Date | undefined;
  const now = Date.now();

  if (fromParam) {
    const parsed = parseTimestamp(fromParam);
    if (parsed) since = parsed;
  } else {
    switch (period) {
      case '1h':
        since = new Date(now - 60 * 60 * 1000);
        break;
      case '24h':
        since = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case '2d':
        since = new Date(now - 2 * 24 * 60 * 60 * 1000);
        break;
      case '7d':
        since = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '2w':
        since = new Date(now - 14 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        since = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        since = undefined;
        break;
      default:
        since = new Date(now - 24 * 60 * 60 * 1000);
        break;
    }
  }

  if (toParam) {
    const parsed = parseTimestamp(toParam);
    if (parsed) until = parsed;
  }

  return { since, until };
}

const handleGetData = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const url = new URL(request.url);
  const period = url.searchParams.get('period') ?? '24h';
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const countOnly = url.searchParams.get('countOnly') === 'true' || url.searchParams.get('countOnly') === '1';

  const { since, until } = resolveTimeRange(period, fromParam, toParam);

  if (countOnly) {
    const totalCount = await countDataPointsForDevice(serial, { since, until });
    return json({
      serial,
      period,
      dataPoints: [],
      totalCount,
    });
  }

  const { points, totalCount } = await getDataPointsForDevice(serial, { since, until, maxPoints: 1200 });

  return json({
    serial,
    period,
    dataPoints: points,
    totalCount,
  });
});

const handleQueryDeviceData = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const queryCheck = await deviceQueryLimiter.check(`user:${user.uuid}`);
  if (!queryCheck.allowed) return tooManyRequests(queryCheck.retryAfterMs);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody<DeviceQueryRequest>(request);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return json({ error: 'query is required' }, 400);
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ error: `query must be ${MAX_QUERY_LENGTH.toLocaleString()} characters or fewer` }, 400);
  }

  let executor: ReturnType<typeof compileQuery>;
  try {
    executor = compileQuery(query);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid query' }, 400);
  }

  const period = typeof body?.period === 'string' && body.period ? body.period : '24h';
  const fromParam = typeof body?.from === 'string' ? body.from : null;
  const toParam = typeof body?.to === 'string' ? body.to : null;
  const { since, until } = resolveTimeRange(period, fromParam, toParam);

  const team = await getTeamForUser(user);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
  const features = getPlanFeaturesForUser(user, seats);

  const { points, totalCount, truncated } = await getDataPointsForQuery(serial, {
    since,
    until,
    maxPoints: MAX_QUERY_POINTS,
  });

  const estimate = estimateQueryComputeUnits(query, points.length);
  const computeUnits = estimate.units;
  if (computeUnits > features.queryComputeUnitLimit) {
    return json({ error: `query exceeds your plan's compute unit limit of ${features.queryComputeUnitLimit}` }, 400);
  }
  const creditCost = Math.max(0.1, computeUnits * features.queryCostCredits);

  if (creditCost > 0) {
    const balance = await getCreditBalance(user);
    if (balance.available < creditCost) {
      return json({ error: 'insufficient credits' }, 402);
    }
  }

  const startedAt = performance.now();
  let result: unknown;
  try {
    result = executor(points as unknown as Parameters<typeof executor>[0]);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'query failed' }, 400);
  }

  if (creditCost > 0) {
    await consumeCredits(user.uuid, creditCost);
  }

  return json({
    serial,
    query,
    result,
    rowCount: Array.isArray(result) ? result.length : null,
    dataPointCount: points.length,
    totalCount,
    truncated,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
});


const handleDeleteDeviceDataPoints = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const team = await getTeamForUser(user);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  if (team) {
    const role = getTeamRole(user);
    if (role !== 'manager') {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  const body = await readJsonBody(request);
  const rawTimestamps = Array.isArray(body?.timestamps) ? body.timestamps : [];
  const timestamps: Date[] = [];
  for (const value of rawTimestamps) {
    const parsed = parseTimestamp(value);
    if (parsed) timestamps.push(parsed);
  }
  if (timestamps.length === 0) return json({ error: 'invalid timestamps' }, 400);

  const removed = await deleteDataPointsForDevice(serial, timestamps);
  await invalidateDeviceStatsForOwner(scopeUuid);
  return json({ serial, removed }, 200);
});

const handleUpdateDevice = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(request);
  const patch: { name?: string; locationId?: string } = {};

  if (body?.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return json({ error: 'invalid name' }, 400);
    patch.name = name;
  }

  if (body?.locationId !== undefined) {
    const locId = typeof body.locationId === 'string' ? body.locationId.trim() : '';
    if (locId) {
      const location = await getLocationById(locId);
      if (location?.teamId !== scopeUuid) {
        return json({ error: 'invalid location' }, 400);
      }
      patch.locationId = location.id;
    }
  }

  const updated = await updateDevice(serial, scopeUuid, patch);
  if (!updated) return json({ error: 'failed to update device' }, 500);

  return json({ device: toPublicDevice(updated) });
});

const handleUnlinkDevice = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const scopeUuid = await getTeamScopeUuid(user);
  const team = await getTeamForUser(user);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  // Role check: deleting requires a team manager.
  if (team) {
    const role = getTeamRole(user);
    if (role !== 'manager') {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  const unlinked = await unlinkDevice(serial, scopeUuid);
  if (!unlinked) return json({ error: 'failed to unlink device' }, 500);

  return json({ unlinked: true, serial });
});


const handleDeviceDataFill = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const body = await readJsonBody(request);
  const startMs = typeof body?.start === 'string' ? Date.parse(body.start) : Number.NaN;
  const endMs = typeof body?.end === 'string' ? Date.parse(body.end) : Number.NaN;
  const intervalSeconds = typeof body?.intervalSeconds === 'number' ? body.intervalSeconds : Number(body?.intervalSeconds);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return json({ error: 'invalid start or end time' }, 400);
  }
  if (endMs <= startMs) {
    return json({ error: 'end must be after start' }, 400);
  }
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    return json({ error: 'interval must be at least 1 second' }, 400);
  }

  const intervalMs = Math.round(intervalSeconds * 1000);
  const count = Math.floor((endMs - startMs) / intervalMs) + 1;

  const team = await getTeamForUser(user);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
  const features = getPlanFeaturesForUser(user, seats);

  if (count < 1 || count > features.dataFillMaxPoints) {
    return json({ error: `requested range produces too many points (max ${features.dataFillMaxPoints.toLocaleString()})` }, 400);
  }

  const devices = await getDevicesForTeamId(scopeUuid);
  const existingStats = await getDataPointStats(devices.map((d) => d.serial), scopeUuid);

  let existingCount = 0;
  for (const stat of existingStats.values()) {
    existingCount += stat.count;
  }
  const replacedCount = existingStats.get(serial)?.count ?? 0;
  const projectedCount = count + existingCount - replacedCount;

  if (projectedCount > features.sharedMaxDataPointsPerUser) {
    return json({ error: `requested range produces too many points for your plan (max ${features.sharedMaxDataPointsPerUser.toLocaleString()})` }, 400);
  }

  const creditCost = Math.max(0.1, (count / 1000) * features.dataFillCreditCostPerThousandPoints);
  if (creditCost > 0) {
    const balance = await getCreditBalance(user);
    if (balance.available < creditCost) {
      return json({ error: 'insufficient credits' }, 402);
    }
  }

  // Replace existing data for this device.
  await deleteAllDataPointsForDevice(serial);

  // Scale random-walk step size by interval so 1-min and 1-hr data drift at the same physical rate
  const dtHours = intervalSeconds / 3600;
  const walkScale = Math.sqrt(dtHours);

  // Stateful weather baselines (slowly drifting fronts)
  let tempBaseline = 19 + (Math.random() - 0.5) * 4;
  let humidityBaseline = 58 + (Math.random() - 0.5) * 10;
  let pressure = 1013 + (Math.random() - 0.5) * 12;
  let pressureVelocity = 0;

  // Sensor micro-noise state (autocorrelated so readings don't jump wildly sample-to-sample)
  let tempNoise = 0;
  let humidityNoise = 0;

  // Generate and persist in batches so peak memory stays bounded even for the
  // largest allowed ranges (up to 10M points).
  const BATCH_SIZE = 5_000;
  let generated = 0;
  for (let batchStart = 0; batchStart < count; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, count);
    const points: DataPoint[] = [];
    for (let i = batchStart; i < batchEnd; i += 1) {
      const t = startMs + i * intervalMs;
      const date = new Date(t);

      // 1. True Diurnal (24-hour) Cycle: coolest around 5:00 AM, warmest around 3:00 PM (15:00)
      const hourOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
      const diurnalPhase = ((hourOfDay - 15) / 24) * 2 * Math.PI;
      // Asymmetric warmth curve (sun heats faster than night cools)
      const diurnalTemp = 3.8 * Math.cos(diurnalPhase) + 0.7 * Math.cos(2 * diurnalPhase);

      // 2. Multi-day weather front drift (mean-reverting random walk)
      tempBaseline += ((19 - tempBaseline) * 0.02 * dtHours) + (Math.random() - 0.5) * 0.5 * walkScale;
      humidityBaseline += ((58 - humidityBaseline) * 0.02 * dtHours) + (Math.random() - 0.5) * 1.8 * walkScale;

      // 3. Smooth barometric pressure momentum (weather systems move slowly over days)
      pressureVelocity = pressureVelocity * 0.96 + ((1013 - pressure) * 0.002 * dtHours) + (Math.random() - 0.5) * 0.25 * walkScale;
      pressure = Math.max(980, Math.min(1042, pressure + pressureVelocity));

      // 4. Autocorrelated sensor noise
      tempNoise = tempNoise * 0.7 + (Math.random() - 0.5) * 0.18;
      humidityNoise = humidityNoise * 0.7 + (Math.random() - 0.5) * 0.6;

      // 5. Physical coupling:
      // - Relative humidity drops as air warms (~2.2% per °C)
      // - Low pressure systems bring higher humidity and slightly cooler daytime highs
      const pressureAnomaly = pressure - 1013;
      const rawTemp = tempBaseline + diurnalTemp + (pressureAnomaly * 0.08) + tempNoise;
      const rawHumidity = humidityBaseline - (diurnalTemp * 2.2) - (pressureAnomaly * 0.45) + humidityNoise;

      points.push({
        timestamp: date,
        temperature: Math.round(rawTemp * 10) / 10,
        humidity: Math.round(Math.max(15, Math.min(99, rawHumidity)) * 10) / 10,
        airPressure: Math.round(pressure * 10) / 10,
      });
    }

    await upsertDataPoints(serial, points);
    generated += points.length;
  }

  await invalidateDeviceStatsForOwner(scopeUuid);

  if (creditCost > 0) {
    await consumeCredits(user.uuid, creditCost);
  }

  return json({ serial, count: generated });
});

export {
  handleDeviceDataFill,
  handleFetchPairingToken,
  handleLink,
  handleListMine,
  handleGetBySerial,
  handleGetData as handleDeviceGetData,
  handleQueryDeviceData as handleDeviceQuery,
  handleDeleteDeviceDataPoints as handleDeviceDeleteDataPoints,
  handleUpdateDevice as handleDeviceUpdate,
  handleUnlinkDevice as handleDeviceUnlink,
  handleRequestPairing,
  handleUpload,
};
