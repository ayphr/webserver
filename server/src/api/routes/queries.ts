import { randomUUID } from 'node:crypto';
import {
  QUERY_ASSIST_PROMPT_MAX_LENGTH,
  QUERY_TYPES,
  estimateAssistantUsageCredits,
  type QueryAssistRequest,
  type QueryType,
  type User,
} from '@common';
import {
  getCreditBalance,
  holdCredits,
  releaseCredits,
  settleCreditHold,
} from '../../lib/credits';
import { countDataPointsForDevice, getDeviceBySerial } from '../../lib/db';
import { getTeamScopeUuid } from '../../lib/db/teams';
import { parseSerial } from '../../lib/deviceValidation';
import {
  MAX_QUERY_AUTHOR_CONTEXT_LENGTH,
  QUERY_AUTHOR_MODEL_ID,
  estimateQueryAuthorReserveCredits,
  generateTqlQuery,
  QueryAuthorError,
} from '../../lib/queryAuthor';
import { loadQueryAuthorDeviceData } from '../../lib/queryAuthorData';
import { json, readJsonBody } from '../../lib/http';
import { createLogger } from '../../lib/logger';
import { assistantRateLimitedTotal } from '../../lib/metrics';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { requireAuth } from '../auth';

const log = createLogger('query-assist');
const queryAssistLimiter = createRateLimiter(60 * 60 * 1000, 30, 'query-assist');
const MAX_SERIALS = 100;
const MAX_TIMESTAMP_LENGTH = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
};

export function parseQueryAssistBody(body: unknown): { request: QueryAssistRequest } | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be valid JSON' };

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return { error: 'Describe the query you want.' };
  if (prompt.length > QUERY_ASSIST_PROMPT_MAX_LENGTH) {
    return { error: `Keep the description under ${QUERY_ASSIST_PROMPT_MAX_LENGTH} characters.` };
  }

  if (!Array.isArray(body.serials) || body.serials.length === 0 || body.serials.length > MAX_SERIALS) {
    return { error: 'Select at least one device.' };
  }
  const serials = body.serials
    .map((serial) => parseSerial(serial))
    .filter((serial): serial is number => serial !== null && serial > 0);
  if (serials.length !== body.serials.length) return { error: 'Invalid device selection.' };

  const from = parseTimestamp(body.from);
  const to = parseTimestamp(body.to);
  if (!from || !to) return { error: 'Choose a valid start and end time.' };
  if (Date.parse(from) > Date.parse(to)) return { error: 'Start must be before end.' };

  if (body.type !== undefined && !QUERY_TYPES.includes(body.type as QueryType)) {
    return { error: 'Invalid query type.' };
  }
  const type: QueryType = body.type === undefined ? 'standard' : body.type as QueryType;

  let existingQuery: string | undefined;
  if (typeof body.existingQuery === 'string' && body.existingQuery.trim()) {
    if (body.existingQuery.length > MAX_QUERY_AUTHOR_CONTEXT_LENGTH) {
      return { error: 'Current query is too long.' };
    }
    existingQuery = body.existingQuery;
  }

  return {
    request: {
      prompt,
      serials: [...new Set(serials)],
      from,
      to,
      type,
      existingQuery,
    },
  };
}

export const handleQueryAssist = requireAuth(async (request, user: User) => {
  const limit = await queryAssistLimiter.check(`user:${user.uuid}`);
  if (!limit.allowed) {
    assistantRateLimitedTotal.labels('query-assist').inc();
    return tooManyRequests(limit.retryAfterMs);
  }

  const body = await readJsonBody<unknown>(request);
  const parsed = parseQueryAssistBody(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  const referenceId = randomUUID();
  const now = new Date();
  let reservedCredits = 0;
  let heldCredits = 0;
  let holdPlaced = false;

  const releaseHold = async () => {
    if (!holdPlaced || heldCredits <= 0) return;
    holdPlaced = false;
    try {
      const released = await releaseCredits(user.uuid, heldCredits, now, {
        reason: 'query_assist_release',
        referenceId,
      });
      if (!released?.changed) {
        log.warn({ userUuid: user.uuid, referenceId }, 'failed to release query assist credit hold');
      }
    } catch (error) {
      log.error({ error, userUuid: user.uuid, referenceId }, 'failed to release query assist credit hold');
    }
  };

  try {
    const scopeUuid = await getTeamScopeUuid(user);
    const selected: Array<{ serial: number; name?: string | null }> = [];
    for (const serial of parsed.request.serials) {
      const device = await getDeviceBySerial(serial);
      if (!device) return json({ error: 'not found' }, 404);
      if (device.teamId !== scopeUuid) return json({ error: 'forbidden' }, 403);
      selected.push(device);
    }

    const deviceData = await loadQueryAuthorDeviceData(
      selected,
      parsed.request.from,
      parsed.request.to,
    );
    if (deviceData.availablePointCount <= 0) {
      return json({ error: 'No readings are available for the selected devices yet.' }, 422);
    }

    const countPoints = async (from: string, to: string): Promise<number> => {
      if (from === parsed.request.from && to === parsed.request.to) {
        return deviceData.totalPointCount;
      }
      const counts = await Promise.all(selected.map(async (device) => {
        try {
          return await countDataPointsForDevice(device.serial, {
            since: new Date(from),
            until: new Date(to),
          });
        } catch {
          return 0;
        }
      }));
      return counts.reduce((sum, count) => sum + count, 0);
    };

    const authorInput = {
      ...parsed.request,
      deviceLabels: selected.map((device) => ({
        serial: device.serial,
        name: device.name?.trim() || `Device ${device.serial}`,
      })),
      deviceData: deviceData.devices,
      totalPointCount: deviceData.totalPointCount,
      availablePointCount: deviceData.availablePointCount,
      availableFrom: deviceData.availableFrom,
      availableTo: deviceData.availableTo,
    };

    reservedCredits = estimateQueryAuthorReserveCredits(authorInput, now);
    const balance = await getCreditBalance(user, now);
    if (balance.available < reservedCredits) {
      return json({ error: 'You do not have enough credits to write a query.' }, 402);
    }

    const hold = await holdCredits(user.uuid, reservedCredits, now, {
      reason: 'query_assist_reserve',
      referenceId,
    });
    if (!hold?.changed) {
      return json({ error: 'You do not have enough credits to write a query.' }, 402);
    }
    heldCredits = reservedCredits;
    holdPlaced = true;

    const result = await generateTqlQuery(authorInput, {
      signal: request.signal,
      countPoints,
    });

    const actualCost = estimateAssistantUsageCredits(
      QUERY_AUTHOR_MODEL_ID,
      result.usage,
      now,
    );
    if (actualCost > heldCredits) {
      const topUpAmount = actualCost - heldCredits;
      const topUp = await holdCredits(user.uuid, topUpAmount, now, {
        reason: 'query_assist_topup',
        referenceId,
      });
      if (topUp?.changed) heldCredits += topUpAmount;
      else {
        log.warn({ userUuid: user.uuid, referenceId }, 'query assist credit top-up was rejected');
      }
    }

    const charge = Math.min(heldCredits, actualCost);
    const settled = await settleCreditHold(
      user.uuid,
      heldCredits,
      charge,
      { reason: 'query_assist_charge', referenceId },
      now,
    );
    // settleCreditHold always releases the hold before attempting the charge,
    // even when it returns -1. Clearing here prevents a second release from
    // consuming another request's hold.
    holdPlaced = false;
    heldCredits = 0;
    if (settled < 0) {
      log.error({ userUuid: user.uuid, referenceId }, 'query assist credit settlement failed');
      return json({ error: 'Iris could not complete the request. Try again.' }, 500);
    }

    return json({
      query: result.query,
      explanation: result.explanation,
      from: result.from,
      to: result.to,
      type: result.type,
      creditCost: settled,
    });
  } catch (error) {
    await releaseHold();
    if (error instanceof QueryAuthorError) {
      log.warn({ error, userUuid: user.uuid, referenceId }, 'query author rejected the draft');
      return json({ error: error.message }, 422);
    }
    if (error instanceof Error && /GEMINI_API_KEY/i.test(error.message)) {
      log.error({ error, userUuid: user.uuid, referenceId }, 'GEMINI_API_KEY is not configured');
      return json({ error: 'Iris is unavailable right now.' }, 503);
    }
    log.error({ error, userUuid: user.uuid, referenceId }, 'failed to generate a TQL query');
    return json({ error: 'Iris could not write a query. Try again.' }, 500);
  }
});
