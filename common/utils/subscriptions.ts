import type {
  AttachedSubscription,
  PaidSubscription,
  PaidSubscriptionStatus,
  ResolvedSubscription,
  SubscriptionTier,
  User,
} from '../types';
import { SUBSCRIPTION_TIER_RANK } from '../types';

export const ENTITLED_PAID_STATUSES: readonly PaidSubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due',
];

export function isPaidSubscriptionActive(
  subscription: Pick<PaidSubscription, 'status' | 'currentPeriodEnd'>,
  now: number = Date.now(),
): boolean {
  if (!ENTITLED_PAID_STATUSES.includes(subscription.status)) {
    return false;
  }

  const end = toTime(subscription.currentPeriodEnd);
  return end === null || end > now;
}

export function isAttachedSubscriptionActive(
  subscription: Pick<AttachedSubscription, 'expiresAt'>,
  now: number = Date.now(),
): boolean {
  const end = toTime(subscription.expiresAt);
  return end === null || end > now;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function remainingMs(expiresAt: Date | string | null, now: number): number {
  const time = toTime(expiresAt);
  return time === null ? Number.POSITIVE_INFINITY : time - now;
}

export function resolveSubscription(
  user: Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'>,
  now: number = Date.now(),
): ResolvedSubscription | null {
  const candidates: ResolvedSubscription[] = [];

  for (const subscription of user.paidSubscriptions ?? []) {
    if (!isPaidSubscriptionActive(subscription, now)) continue;
    candidates.push({
      tier: subscription.tier,
      source: 'paid',
      expiresAt: subscription.currentPeriodEnd ?? null,
      paidSubscription: subscription,
    });
  }

  for (const subscription of user.attachedSubscriptions ?? []) {
    if (!isAttachedSubscriptionActive(subscription, now)) continue;
    candidates.push({
      tier: subscription.tier,
      source: 'attached',
      expiresAt: subscription.expiresAt ?? null,
      attachedSubscription: subscription,
    });
  }

  return pickBestSubscription(candidates, now);
}

export function pickBestSubscription(
  candidates: readonly ResolvedSubscription[],
  now: number = Date.now(),
): ResolvedSubscription | null {
  let best: ResolvedSubscription | null = null;

  for (const candidate of candidates) {
    if (best === null || isBetterSubscription(candidate, best, now)) {
      best = candidate;
    }
  }

  return best;
}

export function isBetterSubscription(
  candidate: ResolvedSubscription,
  current: ResolvedSubscription,
  now: number = Date.now(),
): boolean {
  const candidateRank = SUBSCRIPTION_TIER_RANK[candidate.tier];
  const currentRank = SUBSCRIPTION_TIER_RANK[current.tier];

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }

  return remainingMs(candidate.expiresAt, now) > remainingMs(current.expiresAt, now);
}

export function getSubscriptionTier(
  user: Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'>,
  now: number = Date.now(),
): SubscriptionTier | null {
  return resolveSubscription(user, now)?.tier ?? null;
}

export function getActivePaidSubscription(
  user: Pick<User, 'paidSubscriptions'>,
  now: number = Date.now(),
): PaidSubscription | null {
  let best: PaidSubscription | null = null;

  for (const subscription of user.paidSubscriptions ?? []) {
    if (!isPaidSubscriptionActive(subscription, now)) continue;

    if (
      best === null ||
      SUBSCRIPTION_TIER_RANK[subscription.tier] > SUBSCRIPTION_TIER_RANK[best.tier] ||
      (SUBSCRIPTION_TIER_RANK[subscription.tier] === SUBSCRIPTION_TIER_RANK[best.tier] &&
        remainingMs(subscription.currentPeriodEnd, now) > remainingMs(best.currentPeriodEnd, now))
    ) {
      best = subscription;
    }
  }

  return best;
}
