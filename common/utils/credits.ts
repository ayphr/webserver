import type { CreditBalance, PlanTier, UserCredits } from '../types';
import { PLAN_FEATURES } from '../types/plans';

/** The server's IANA timezone, used for monthly reset boundaries. */
export function getCreditTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Start of the current monthly credit period, in the server's timezone. */
export function getCreditPeriodStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Start of the next monthly credit period, in the server's timezone. */
export function getCreditPeriodEnd(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
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
    && isSameLocalMonth(storedPeriodStart, now);

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
    timezone: getCreditTimezone(),
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
