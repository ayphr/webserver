import { json, parsePositiveInt, readJsonBody } from '../../lib/http';
import { randomBytes, randomInt } from 'node:crypto';
import { getUserFromRequest, requireAuth } from '../auth';
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
  getDataPointsForExport,
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
import {
  DEVICE_PAIRINGS_COLLECTION,
  getCollection,
  trackMongoOperation,
} from '../../lib/db/internal';
import { getTeamScopeUuid, getTeamScopeUsername, getTeamForUser, getTeamSharedSeats } from '../../lib/db/teams';
import { getTeamMemberRole } from '../../lib/teamAccess';
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
import { consumeQueryBoostAllowance } from '../../lib/db/queryBoostUsage';
import { PAIRING_CODE_TTL_MS } from '../../env';
import {
  compileQuery,
  MAX_BOOST_QUERY_POINTS,
  MAX_QUERY_POINTS_BY_TYPE,
  MAX_STANDARD_QUERY_POINTS,
  QUERY_TYPES,
  type DeviceQueryRequest,
  type DeviceSummary,
  type MultiDeviceQueryRequest,
  type QueryType,
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
import { deviceQueryQueue } from '../../lib/deviceQueryQueue';
import { linkDevice } from '../../lib/deviceLinkService';
import { uploadDeviceTelemetry } from '../../lib/deviceUploadService';
import { getDeviceUptime } from '../../lib/deviceUptimeService';
import {
  countDeviceLogs,
  listDeviceLogs,
  listDeviceLogsForExport,
  parseDeviceLogFilter,
  queueDeviceLog,
} from '../../lib/deviceLogService';
import {
  dataPointsToCsv,
  deviceLogsToCsv,
  fileResponse,
  logExportCompleted,
  parseExportFormat,
  parseIsoTimestamp,
} from '../../lib/deviceExportService';

const pairingRequestLimiter = createRateLimiter(15 * 60 * 1000, 20, 'pairing-request');
const linkCodeLimiter = createRateLimiter(15 * 60 * 1000, 20, 'link-code');
const fetchPairingTokenLimiter = createRateLimiter(15 * 60 * 1000, 20, 'fetch-pairing-token');
const deviceQueryLimiter = createRateLimiter(60 * 1000, 60, 'device-query');
const deviceUploadLimiter = createRateLimiter(60 * 1000, 120, 'device-upload');
const deviceLogExportLimiter = createRateLimiter(60 * 1000, 10, 'device-log-export');

const DEFAULT_DEVICE_LOG_PAGE_SIZE = 20;
const MAX_DEVICE_LOG_PAGE_SIZE = 100;
/** Logs are retained for 30 days; a wider export window has no useful data. */
const MAX_EXPORT_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

export type PairingOwnershipOutcome =
  | { kind: 'allowed'; teamId?: string; ownerUsername?: string }
  | { kind: 'foreign_serial' };

/**
 * Device-initiated pairing stays unauthenticated for backward compatibility.
 * When a session token is present, the serial must already belong to that
 * user's team; the pairing is then stamped with the team/owner so link-time
 * checks have an explicit ownership record. An unauthenticated request may
 * still pair a serial, but only one unlinked pairing per serial is active at a
 * time (see `invalidateSupersededPairings`), so a stale or squatting code is
 * invalidated as soon as the real owner requests a new one.
 */
export async function resolvePairingOwnership(
  serial: number,
  user: User | null,
  deps: {
    getDevice: typeof getDeviceBySerial;
    scopeUuid: (user: User) => Promise<string>;
    scopeUsername: (user: User) => Promise<string>;
  } = {
    getDevice: getDeviceBySerial,
    scopeUuid: getTeamScopeUuid,
    scopeUsername: getTeamScopeUsername,
  },
): Promise<PairingOwnershipOutcome> {
  const device = await deps.getDevice(serial);
  if (!device) return { kind: 'allowed' };

  if (user) {
    const teamId = await deps.scopeUuid(user);
    if (device.teamId !== teamId) return { kind: 'foreign_serial' };
    return { kind: 'allowed', teamId, ownerUsername: await deps.scopeUsername(user) };
  }

  // Legacy firmware path: final authorization still happens in linkDevice(),
  // which refuses to link a serial owned by another team.
  return { kind: 'allowed', teamId: device.teamId };
}

type PairingInvalidationCollection = {
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
};

/** Exported for tests; invalidates unlinked pairings superseded by a new code. */
export async function invalidateSupersededPairings(
  serial: number,
  now: Date,
): Promise<void> {
  const pairings = await getCollection('devicePairings') as unknown as PairingInvalidationCollection;
  trackMongoOperation('updateMany', DEVICE_PAIRINGS_COLLECTION);
  await pairings.updateMany(
    { serial, linked: false, expiresAt: { $gt: now } },
    { $set: { expiresAt: now, superseded: true } },
  );
}

/** Bounds a user-selected export window so a single request cannot scan all history. */
export function validateExportSpan(
  from: Date | undefined,
  to: Date | undefined,
  maxSpanMs = MAX_EXPORT_SPAN_MS,
): string | null {
  if (!from || !to) return null;
  const span = to.getTime() - from.getTime();
  if (!Number.isFinite(span) || span < 0) return 'from must be before to';
  if (span > maxSpanMs) return `export range must be ${Math.round(maxSpanMs / 86_400_000)} days or fewer`;
  return null;
}

const handleRequestPairing = async (request: Request): Promise<Response> => {
  const ipCheck = await pairingRequestLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readJsonBody(request);
  const serial = parseSerial(body?.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const name = parseName(body?.name) ?? `Device ${serial}`;

  const user = await getUserFromRequest(request);
  const ownership = await resolvePairingOwnership(serial, user);
  if (ownership.kind === 'foreign_serial') {
    return json({ error: 'serial belongs to another team' }, 403);
  }

  let code = generateDevicePairingCode(randomInt);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const existing = await getDevicePairingByCode(code);
    if (!existing) break;
    code = generateDevicePairingCode(randomInt);
  }

  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);

  // Only the newest unlinked code for a serial remains usable. This prevents
  // a previously issued (or attacker-squatted) code from being redeemed after
  // the real owner starts a new pairing.
  await invalidateSupersededPairings(serial, now);

  await createDevicePairing({
    code,
    serial,
    name,
    token,
    tokenHash: hashToken(token),
    createdAt: now,
    expiresAt,
    linked: false,
    ...(ownership.teamId ? { teamId: ownership.teamId } : {}),
    ...(ownership.ownerUsername ? { ownerUsername: ownership.ownerUsername } : {}),
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

const handleDeviceLogs = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const query = new URL(request.url).searchParams;
  const parsedFilter = parseDeviceLogFilter(query);
  if (parsedFilter.error) return json({ error: parsedFilter.error }, 400);

  const page = parsePositiveInt(query.get('page'), 1);
  const pageSize = Math.min(
    parsePositiveInt(query.get('pageSize'), DEFAULT_DEVICE_LOG_PAGE_SIZE),
    MAX_DEVICE_LOG_PAGE_SIZE,
  );
  const skip = (page - 1) * pageSize;

  // The same filter drives both reads so pagination totals stay correct.
  const [logs, total] = await Promise.all([
    listDeviceLogs(serial, { skip, limit: pageSize, filter: parsedFilter.filter }),
    countDeviceLogs(serial, parsedFilter.filter),
  ]);

  return json({
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

const handleExportDeviceLogs = requireAuth(async (request, user: User, params) => {
  const exportCheck = await deviceLogExportLimiter.check(`user:${user.uuid}`);
  if (!exportCheck.allowed) return tooManyRequests(exportCheck.retryAfterMs);

  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const query = new URL(request.url).searchParams;
  const format = parseExportFormat(query.get('format'));
  if (!format) return json({ error: 'invalid format' }, 400);

  const parsedFilter = parseDeviceLogFilter(query);
  if (parsedFilter.error) return json({ error: parsedFilter.error }, 400);

  const spanError = validateExportSpan(parsedFilter.filter.from, parsedFilter.filter.to);
  if (spanError) return json({ error: spanError }, 400);

  const { logs, truncated } = await listDeviceLogsForExport(serial, parsedFilter.filter);
  const body = format === 'csv' ? deviceLogsToCsv(logs) : JSON.stringify(logs);
  logExportCompleted('logs', serial, logs.length, truncated);

  return fileResponse({
    body,
    format,
    filename: `device-${serial}-logs.${format}`,
    truncated,
  });
});

const handleExportDeviceData = requireAuth(async (request, user: User, params) => {
  const exportCheck = await deviceLogExportLimiter.check(`user:${user.uuid}`);
  if (!exportCheck.allowed) return tooManyRequests(exportCheck.retryAfterMs);

  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);
  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  const query = new URL(request.url).searchParams;
  const format = parseExportFormat(query.get('format'));
  if (!format) return json({ error: 'invalid format' }, 400);

  const fromParam = query.get('from');
  const toParam = query.get('to');
  if (!fromParam || !toParam) return json({ error: 'from and to are required' }, 400);

  const from = parseIsoTimestamp(fromParam);
  const to = parseIsoTimestamp(toParam);
  if (!from) return json({ error: 'invalid from timestamp' }, 400);
  if (!to) return json({ error: 'invalid to timestamp' }, 400);
  const spanError = validateExportSpan(from, to);
  if (spanError) return json({ error: spanError }, 400);

  const { points, truncated } = await getDataPointsForExport(serial, { since: from, until: to });
  const body = format === 'csv' ? dataPointsToCsv(points) : JSON.stringify(points);
  logExportCompleted('data', serial, points.length, truncated);

  return fileResponse({
    body,
    format,
    filename: `device-${serial}-data.${format}`,
    truncated,
  });
});

const handleDeviceUptime = requireAuth(async (_request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);

  const device = await getDeviceBySerial(serial);
  if (!device) return json({ error: 'not found' }, 404);

  const scopeUuid = await getTeamScopeUuid(user);
  if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);

  return json({ uptime: await getDeviceUptime(serial) });
});

async function handleUpload(request: Request): Promise<Response> {
  const clientIp = getClientIp(request);
  const ipCheck = await deviceUploadLimiter.check(`ip:${clientIp}`);
  if (!ipCheck.allowed) {
    queueDeviceLog({
      event: 'rate_limited',
      level: 'warning',
      message: 'Upload rejected: rate limit exceeded',
      details: { clientIp, scope: 'ip' },
    });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

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
    queueDeviceLog({
      event: 'upload_error',
      level: 'error',
      message: 'Upload failed: unexpected server error',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
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

type QueryTarget = {
  serial: number;
  name: string;
};

type QueryExecution = QueryTarget & {
  result: unknown;
  dataPointCount: number;
  totalCount: number;
  truncated: boolean;
};

/** Split the global point budget across devices without exceeding it. */
function allocateQueryBudgets(counts: number[], maxPoints: number): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= maxPoints) return counts.map((count) => count);

  const exact = counts.map((count) => (count / total) * maxPoints);
  const budgets = exact.map((value) => Math.floor(value));
  let remaining = maxPoints - budgets.reduce((sum, budget) => sum + budget, 0);
  const remainderOrder = counts
    .map((_count, index) => ({ index, remainder: exact[index]! - budgets[index]! }))
    .sort((a, b) => b.remainder - a.remainder);

  for (const { index } of remainderOrder) {
    if (remaining <= 0) break;
    const room = counts[index]! - budgets[index]!;
    if (room <= 0) continue;
    const added = Math.min(room, remaining);
    budgets[index] = budgets[index]! + added;
    remaining -= added;
  }

  return budgets;
}

function annotateQueryRow(value: unknown, target: QueryTarget): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    return {
      ...(value as Record<string, unknown>),
      serial: target.serial,
      device: target.name,
    };
  }

  return { result: value, serial: target.serial, device: target.name };
}

async function executeDeviceQuery(
  user: User,
  serials: number[],
  body: DeviceQueryRequest,
  options: { annotateResults?: boolean } = {},
): Promise<Response> {
  const queryCheck = await deviceQueryLimiter.check(`user:${user.uuid}`);
  if (!queryCheck.allowed) return tooManyRequests(queryCheck.retryAfterMs);

  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (!query) return json({ error: 'query is required' }, 400);
  if (body?.type !== undefined && !QUERY_TYPES.includes(body.type as QueryType)) {
    return json({ error: 'invalid query type' }, 400);
  }
  const type: QueryType = body?.type === 'boost' ? 'boost' : 'standard';
  let executor: ReturnType<typeof compileQuery>;
  try {
    executor = compileQuery(query);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'invalid query' }, 400);
  }

  const period = typeof body?.period === 'string' && body.period ? body.period : '24h';
  const fromParam = typeof body?.from === 'string' ? body.from : null;
  const toParam = typeof body?.to === 'string' ? body.to : null;

  const parsedFrom = fromParam ? parseTimestamp(fromParam) : null;
  const parsedTo = toParam ? parseTimestamp(toParam) : null;
  if (fromParam && !parsedFrom) return json({ error: 'invalid from timestamp' }, 400);
  if (toParam && !parsedTo) return json({ error: 'invalid to timestamp' }, 400);
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    return json({ error: 'from must be before to' }, 400);
  }

  const { since, until } = resolveDeviceTimeRange(period, fromParam, toParam);

  const scopeUuid = await getTeamScopeUuid(user);
  const targets: QueryTarget[] = [];
  for (const serial of serials) {
    const device = await getDeviceBySerial(serial);
    if (!device) return json({ error: 'not found' }, 404);
    if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);
    targets.push({
      serial,
      name: device.name?.trim() || `Device ${serial}`,
    });
  }

  const team = await getTeamForUser(user);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : undefined;
  const features = getPlanFeatures(team?.tier ?? 'free', seats);

  const counts = await Promise.all(
    targets.map(({ serial }) => countDataPointsForDevice(serial, { since, until })),
  );
  const pointCount = counts.reduce((sum, count) => sum + count, 0);
  if (pointCount === 0) {
    return json({ error: 'There are no data points in the selected range for the selected devices.' }, 400);
  }
  if (pointCount > MAX_BOOST_QUERY_POINTS) {
    return json(
      {
        error: `This temporal range contains ${pointCount.toLocaleString()} data points, which is too many. Narrow the range to ${MAX_BOOST_QUERY_POINTS.toLocaleString()} points or fewer.`,
      },
      400,
    );
  }
  if (type === 'standard' && pointCount > MAX_STANDARD_QUERY_POINTS) {
    return json(
      {
        error: `This temporal range contains ${pointCount.toLocaleString()} data points. Standard queries support at most ${MAX_STANDARD_QUERY_POINTS.toLocaleString()}. Switch Query Type to Boost to continue.`,
      },
      400,
    );
  }

  const maxPoints = MAX_QUERY_POINTS_BY_TYPE[type];
  let queryPlan;
  try {
    queryPlan = createDeviceQueryPlan(query, Math.min(pointCount, maxPoints), features, type);
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

  if (type === 'boost') {
    const limit = features.sharedQueryBoostLimitMonthlyPerUser;
    const usage = await consumeQueryBoostAllowance(user.uuid, limit);
    if (!usage.allowed) {
      if (limit <= 0) {
        return json({ error: 'Boost queries are not available on your plan.' }, 403);
      }
      return json(
        {
          error: `You have reached the monthly Boost query limit (${limit}). It resets ${usage.resetAt.toISOString()}.`,
        },
        429,
      );
    }
  }

  const budgets = allocateQueryBudgets(counts, maxPoints);
  const startedAt = performance.now();
  let executions: QueryExecution[];
  try {
    executions = await deviceQueryQueue.run(type === 'boost' ? 1 : 0, async () => {
      const completed: QueryExecution[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        const loaded = await getDataPointsForQuery(target.serial, {
          since,
          until,
          maxPoints: budgets[index]!,
          knownTotalCount: counts[index]!,
        });
        const points = loaded.points.map((point) => ({
          timestamp: point.timestamp,
          temperature: point.temperature,
          humidity: point.humidity,
          airPressure: point.airPressure,
          serial: target.serial,
          device: target.name,
        })) as unknown as Parameters<typeof executor>[0];
        const rawResult = executor(points);
        const result = options.annotateResults
          ? Array.isArray(rawResult)
            ? rawResult.map((row) => annotateQueryRow(row, target))
            : [annotateQueryRow(rawResult, target)]
          : rawResult;
        completed.push({
          ...target,
          result,
          dataPointCount: loaded.points.length,
          totalCount: loaded.totalCount,
          truncated: loaded.truncated,
        });
      }
      return completed;
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'query failed' }, 400);
  }

  if (creditCost > 0) {
    await consumeCredits(user.uuid, creditCost);
  }

  const result = options.annotateResults
    ? executions.flatMap((execution) => execution.result as Record<string, unknown>[])
    : executions[0]?.result ?? null;
  const deviceTargets = targets.map(({ serial, name }) => ({ serial, name }));
  return json({
    serials: serials.slice(),
    ...(!options.annotateResults && serials.length === 1 ? { serial: serials[0] } : {}),
    devices: deviceTargets,
    query: queryPlan.query,
    type,
    result,
    rowCount: Array.isArray(result) ? result.length : null,
    dataPointCount: executions.reduce((sum, execution) => sum + execution.dataPointCount, 0),
    totalCount: executions.reduce((sum, execution) => sum + execution.totalCount, 0),
    truncated: executions.some((execution) => execution.truncated),
    computeUnits: queryPlan.computeUnits,
    creditCost,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  });
}

const handleQueryDeviceData = requireAuth(async (request, user: User, params) => {
  const serial = parseSerial(params.serial);
  if (serial === null) return json({ error: 'invalid serial' }, 400);
  const body = await readJsonBody<DeviceQueryRequest>(request);
  return executeDeviceQuery(user, [serial], body ?? { query: '' });
});

const handleQueryDevices = requireAuth(async (request, user: User) => {
  const body = await readJsonBody<MultiDeviceQueryRequest>(request);
  const rawSerials = Array.isArray(body?.serials) ? body.serials : [];
  const serials = rawSerials.map(parseSerial).filter((serial): serial is number => serial !== null);
  if (serials.length === 0) return json({ error: 'select at least one device' }, 400);
  if (serials.length !== rawSerials.length) return json({ error: 'invalid serials' }, 400);
  return executeDeviceQuery(user, [...new Set(serials)], body ?? { query: '', serials }, {
    annotateResults: true,
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

  if (team && getTeamMemberRole(user, team) !== 'manager') {
    return json({ error: 'Forbidden' }, 403);
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
  if (team && getTeamMemberRole(user, team) !== 'manager') {
    return json({ error: 'Forbidden' }, 403);
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

  queueDeviceLog({
    serial,
    teamId: scopeUuid,
    event: 'token_revoked',
    level: 'warning',
    message: 'Upload token was revoked',
    details: { tokenId: id },
  });

  return new Response(null, { status: 204 });
});

export {
  handleDeviceDataFill,
  handleFetchPairingToken,
  handleLink,
  handleListMine,
  handleGetBySerial,
  handleDeviceLogs,
  handleExportDeviceLogs,
  handleExportDeviceData,
  handleDeviceUptime,
  handleGetData as handleDeviceGetData,
  handleQueryDeviceData as handleDeviceQuery,
  handleQueryDevices,
  handleDeleteDeviceDataPoints as handleDeviceDeleteDataPoints,
  handleUpdateDevice as handleDeviceUpdate,
  handleUnlinkDevice as handleDeviceUnlink,
  handleRequestPairing,
  handleUpload,
  handleListDeviceTokens as handleDeviceTokensList,
  handleRevokeDeviceToken as handleDeviceTokenRevoke,
};
