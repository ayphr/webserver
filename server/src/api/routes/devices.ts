import { json, readJsonBody } from '../../lib/http';
import { randomBytes, randomInt } from 'node:crypto';
import { requireAuth } from '../auth';
import {
  createDevicePairing,
  createDeviceToken,
  ensureDefaultLocation,
  getDeviceTokenById,
  getDeviceTokensForSerial,
  revokeDeviceToken,
  getDevicePairingByCode,
  getLocationById,
  markDevicePairingFetched,
  countDataPointsForDevice,
  getDataPointStats,
  getDataPointsForDevice,
  getDataPointsForQuery,
  deleteAllDataPointsForDevice,
  deleteDataPointsForDevice,
  getDeviceBySerial,
  getDevicesForTeamId,
  getUserFromUuid,
  invalidateDeviceStatsForOwner,
  toPublicDevice,
  updateDevice,
  unlinkDevice,
  upsertDataPoints,
} from '../../lib/db';
import { getTeamScopeUuid, getTeamScopeUsername, getTeamForUser, getTeamRole, getTeamSharedSeats } from '../../lib/db/teams';
import { hashToken } from '../../lib/tokens';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import {
  deviceClaimsTotal,
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
  compileQuery,
  MAX_QUERY_POINTS,
  type DeviceQueryRequest,
  type DeviceSummary,
  type User,
  getPlanFeatures,
} from '@common';
import { parseDataPoints, parseName, parseSerial, parseTimestamp, getDeviceToken } from '../../lib/deviceValidation';
import { pruneOwnerDataPoints } from './deviceRetention';
import {
  calculateDataFillCreditCost,
  generateSyntheticDataPointBatches,
  resolveDeviceTimeRange,
} from '../../lib/deviceDataService';
import { generateDevicePairingCode } from '../../lib/devicePairingService';
import { toPresentedDeviceTokens } from '../../lib/deviceTokenService';
import { createDeviceQueryPlan } from '../../lib/deviceQueryService';
import { linkDevice } from '../../lib/deviceLinkService';
import { uploadDeviceTelemetry } from '../../lib/deviceUploadService';

const pairingRequestLimiter = createRateLimiter(15 * 60 * 1000, 20, 'pairing-request');
const linkCodeLimiter = createRateLimiter(15 * 60 * 1000, 20, 'link-code');
const fetchPairingTokenLimiter = createRateLimiter(15 * 60 * 1000, 20, 'fetch-pairing-token');
const deviceQueryLimiter = createRateLimiter(60 * 1000, 60, 'device-query');
const deviceUploadLimiter = createRateLimiter(60 * 1000, 120, 'device-upload');

const handleRequestPairing = async (request: Request): Promise<Response> => {
  const ipCheck = await pairingRequestLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readJsonBody(request);
  const serial = parseSerial(body?.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const name = parseName(body?.name) ?? `Device ${serial}`;

  let code = generateDevicePairingCode(randomInt);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await getDevicePairingByCode(code);
    if (!existing) break;
    code = generateDevicePairingCode(randomInt);
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

  const body = await readJsonBody(request);
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) return json({ error: 'invalid code' }, 400);

  const requestedLocationId = typeof body?.locationId === 'string' ? body.locationId.trim() : null;
  const result = await linkDevice({ user, code, locationId: requestedLocationId });
  if (result.kind === 'invalid-location') return json({ error: 'invalid location' }, 400);
  if (result.kind === 'invalid-or-expired-code') return json({ error: 'invalid or expired code' }, 404);
  if (result.kind === 'code-used') return json({ error: 'code already used' }, 409);
  if (result.kind === 'forbidden') return json({ error: 'forbidden' }, 403);
  if (result.kind === 'member-forbidden') return json({ error: 'Forbidden' }, 403);
  if (result.kind === 'device-limit') return json({ error: 'device limit reached for your plan' }, 409);

  deviceClaimsTotal.inc({ event: 'claimed' });

  return json({ linked: true, device: toPublicDevice(result.device) }, 200);
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

    const rawBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const meta = (rawBody.meta && typeof rawBody.meta === 'object' ? rawBody.meta : rawBody) as Record<string, unknown>;
    const result = await uploadDeviceTelemetry({
      token,
      points,
      metadata: meta,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    if (result.kind === 'missing-token') return json({ error: 'missing device token' }, 401);
    if (result.kind === 'invalid-device') return json({ error: 'invalid data' }, 400);
    if (result.kind === 'device-not-linked') return json({ error: 'device not linked' }, 404);
    if (result.kind === 'token-revoked') return json({ error: 'device token revoked' }, 401);

    telemetryRecordsAcceptedTotal.inc(result.pointCount);
    telemetryRecordsPersistedTotal.inc(result.accepted);
    telemetryUploadBatchSize.observe(result.pointCount);
    observeTelemetryValues(points);
    return json({ device: toPublicDevice(result.device), accepted: result.accepted }, 200);
  } catch (error) {
    telemetryUploadErrorsTotal.inc();
    throw error;
  } finally {
    endTimer();
  }
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

  const { since, until } = resolveDeviceTimeRange(period, fromParam, toParam);

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
  let executor: ReturnType<typeof compileQuery>;
  try {
    executor = compileQuery(query);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid query' }, 400);
  }

  const period = typeof body?.period === 'string' && body.period ? body.period : '24h';
  const fromParam = typeof body?.from === 'string' ? body.from : null;
  const toParam = typeof body?.to === 'string' ? body.to : null;
  const { since, until } = resolveDeviceTimeRange(period, fromParam, toParam);

  const team = await getTeamForUser(user);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
  const features = getPlanFeatures(team?.tier ?? 'free', seats);

  const { points, totalCount, truncated } = await getDataPointsForQuery(serial, {
    since,
    until,
    maxPoints: MAX_QUERY_POINTS,
  });

  let queryPlan;
  try {
    queryPlan = createDeviceQueryPlan(query, points.length, features);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid query' }, 400);
  }
  const creditCost = queryPlan.creditCost;

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
    query: queryPlan.query,
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
  const features = getPlanFeatures(team?.tier ?? 'free', seats);

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

  const creditCost = calculateDataFillCreditCost(count, features);
  if (creditCost > 0) {
    const balance = await getCreditBalance(user);
    if (balance.available < creditCost) {
      return json({ error: 'insufficient credits' }, 402);
    }
  }

  // Replace existing data for this device.
  await deleteAllDataPointsForDevice(serial);

  // Generate and persist in batches so peak memory stays bounded even for the
  // largest allowed ranges (up to 10M points).
  let generated = 0;
  for (const points of generateSyntheticDataPointBatches(startMs, count, intervalSeconds)) {
    await upsertDataPoints(serial, points);
    generated += points.length;
  }

  await invalidateDeviceStatsForOwner(scopeUuid);

  if (creditCost > 0) {
    await consumeCredits(user.uuid, creditCost);
  }

  return json({ serial, count: generated });
});

const handleListDeviceTokens = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  // Backfill a token record for legacy devices that only store a single hash.
  const existingTokens = await getDeviceTokensForSerial(serial, scopeUuid);
  if (existingTokens.length === 0 && device.tokenHash) {
    await createDeviceToken({
      id: crypto.randomUUID(),
      serial,
      teamId: scopeUuid,
      tokenHash: device.tokenHash,
      createdAt: device.tokenCreatedAt ?? new Date(),
      location: {},
      active: true,
    });
  }
  const tokens = await getDeviceTokensForSerial(serial, scopeUuid);
  // Strip secret hash before returning; include a few aliases for compatibility.
  const presented = toPresentedDeviceTokens(tokens);
  return json({ tokens: presented });
});

const handleRevokeDeviceToken = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const id = typeof params.id === 'string' ? params.id : '';
  if (!id) return json({ error: 'invalid id' }, 400);

  const existing = await getDeviceTokenById(id);
  if (!existing || existing.serial !== serial || existing.teamId !== scopeUuid) {
    return json({ error: 'not found' }, 404);
  }

  const revoked = await revokeDeviceToken(id, scopeUuid, serial);
  if (!revoked) return json({ error: 'not found' }, 404);
  return new Response(null, { status: 204 });
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
  handleListDeviceTokens as handleDeviceTokensList,
  handleRevokeDeviceToken as handleDeviceTokenRevoke,
};
