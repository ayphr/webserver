import type { CreditBalance, PlanTier, UserCredits } from '../types';
import { PLAN_FEATURES } from '../types/plans';

/** Timezone used for monthly credit reset boundaries. */
export const CREDIT_TIMEZONE = 'Australia/Sydney';

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CREDIT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getZonedParts(date: Date): ZonedDateParts {
  const values: Record<string, number> = {};

  for (const part of zonedDateFormatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year ?? 0,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Milliseconds that the credit timezone is ahead of UTC at the given instant. */
function getTimeZoneOffsetMs(date: Date): number {
  const parts = getZonedParts(date);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const time = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - time;
}

/** The instant at which the given calendar month starts in the credit timezone. */
function getZonedMonthStart(year: number, monthIndex: number): Date {
  const wallClockUtc = Date.UTC(year, monthIndex, 1);
  const firstOffset = getTimeZoneOffsetMs(new Date(wallClockUtc));
  let timestamp = wallClockUtc - firstOffset;
  const adjustedOffset = getTimeZoneOffsetMs(new Date(timestamp));

  if (adjustedOffset !== firstOffset) {
    timestamp = wallClockUtc - adjustedOffset;
  }

  return new Date(timestamp);
}

/** Start of the current monthly credit period, in Sydney time. */
export function getCreditPeriodStart(now: Date = new Date()): Date {
  const parts = getZonedParts(now);
  return getZonedMonthStart(parts.year, parts.month - 1);
}

/** Start of the next monthly credit period, in Sydney time. */
export function getCreditPeriodEnd(now: Date = new Date()): Date {
  const parts = getZonedParts(now);
  return getZonedMonthStart(parts.year, parts.month);
}

function isSameZonedMonth(a: Date, b: Date): boolean {
  const aParts = getZonedParts(a);
  const bParts = getZonedParts(b);
  return aParts.year === bParts.year && aParts.month === bParts.month;
}

function toNonNegative(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

/**
 * Resolves the user's current credit balance from their plan and stored credits.
 *
 * Monthly usage is ignored once the stored period is no longer the current
 * calendar month, which makes the allowance reset lazily on the next read.
 */
export function resolveCreditBalance(
  plan: PlanTier,
  credits: UserCredits | null | undefined,
  now: Date = new Date(),
): CreditBalance {
  const features = PLAN_FEATURES[plan];
  const storedPeriodStart = credits?.periodStart ? new Date(credits.periodStart) : null;
  const periodIsCurrent = storedPeriodStart !== null
    && !Number.isNaN(storedPeriodStart.getTime())
    && isSameZonedMonth(storedPeriodStart, now);

  const monthlyAllowance = toNonNegative(features.sharedMonthlyCreditsPerUser);
  const monthlyUsed = periodIsCurrent
    ? Math.min(toNonNegative(credits?.monthlyUsed), monthlyAllowance)
    : 0;
  const monthlyRemaining = Math.max(0, monthlyAllowance - monthlyUsed);

  const additional = toNonNegative(credits?.additional);
  const additionalLimit = toNonNegative(features.sharedMaxAdditionalCredits);
  const total = monthlyRemaining + additional;
  const onHold = Math.min(toNonNegative(credits?.onHold), total);

  return {
    plan,
    timezone: CREDIT_TIMEZONE,
    monthlyAllowance,
    monthlyUsed,
    monthlyRemaining,
    monthlyResetsAt: getCreditPeriodEnd(now),
    additional,
    additionalLimit,
    additionalCapacity: Math.max(0, additionalLimit - additional),
    onHold,
    total,
    available: Math.max(0, total - onHold),
  };
}
