import type { AttachedSubscription, PaidSubscription, PlanFeatures, PlanTier, PublicUser, User } from '../types';
import { PLAN_FEATURES } from '../types/plans';
import { isAttachedSubscriptionActive, isPaidSubscriptionActive, resolveSubscription } from './subscriptions';

export type PlanUser =
  | Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'>
  | Pick<PublicUser, 'subscription'>
  | null
  | undefined;

export function getPlanTier(user: PlanUser): PlanTier {
  if (!user) return 'free';

  if ('subscription' in user) {
    return user.subscription?.tier ?? 'free';
  }

  return resolveSubscription(user)?.tier ?? 'free';
}

export function resolvePlanTier(user: PlanUser): PlanTier {
  return getPlanTier(user);
}

export function getUserPlanTier(user: PlanUser): PlanTier {
  return getPlanTier(user);
}

export function getTierForUser(user: PlanUser): PlanTier {
  return getPlanTier(user);
}

export function getPlanSeats(user: PlanUser): number {
  if (!user) return 1;

  if ('subscription' in user && user.subscription && typeof user.subscription.seats === 'number') {
    return Math.max(1, user.subscription.seats);
  }

  if ('paidSubscriptions' in user && Array.isArray(user.paidSubscriptions)) {
    const activePaid = user.paidSubscriptions.find(
      (s: PaidSubscription) => isPaidSubscriptionActive(s),
    );
    if (activePaid && typeof activePaid.quantity === 'number' && activePaid.quantity > 1) {
      return Math.max(1, activePaid.quantity);
    }
  }

  if ('attachedSubscriptions' in user && Array.isArray(user.attachedSubscriptions)) {
    const activeAttached = user.attachedSubscriptions.find(
      (s: AttachedSubscription) => isAttachedSubscriptionActive(s),
    );
    if (activeAttached && typeof activeAttached.seats === 'number' && activeAttached.seats > 1) {
      return Math.max(1, activeAttached.seats);
    }
  }

  return 1;
}

export function getPlanFeatures(plan: PlanTier | PlanUser, seatsOverride?: number): PlanFeatures {
  if (typeof plan === 'string') {
    const base = PLAN_FEATURES[plan];
    if (typeof seatsOverride === 'number' && seatsOverride > 1) {
      return {
        ...base,
        sharedMaxDataPointsPerUser: base.sharedMaxDataPointsPerUser * seatsOverride,
        sharedQueryBoostLimitMonthlyPerUser: base.sharedQueryBoostLimitMonthlyPerUser * seatsOverride,
        dataFillMaxPoints: base.dataFillMaxPoints * seatsOverride,
      };
    }
    return base;
  }

  return getPlanFeaturesForUser(plan, seatsOverride);
}

export function getPlanFeaturesForTier(tier: PlanTier, seats = 1): PlanFeatures {
  return getPlanFeatures(tier, seats);
}

export function getPlanFeaturesForUser(user: PlanUser, seatsOverride?: number): PlanFeatures {
  const tier = getPlanTier(user);
  const base = PLAN_FEATURES[tier];
  const seats = Math.max(1, seatsOverride ?? getPlanSeats(user));
  if (seats <= 1) {
    return base;
  }

  return {
    ...base,
    sharedMaxDataPointsPerUser: base.sharedMaxDataPointsPerUser * seats,
    sharedQueryBoostLimitMonthlyPerUser: base.sharedQueryBoostLimitMonthlyPerUser * seats,
    dataFillMaxPoints: base.dataFillMaxPoints * seats,
  };
}

export function getUserPlanFeatures(user: PlanUser, seatsOverride?: number): PlanFeatures {
  return getPlanFeaturesForUser(user, seatsOverride);
}

export function getFeaturesForPlan(plan: PlanTier | PlanUser, seatsOverride?: number): PlanFeatures {
  return getPlanFeatures(plan, seatsOverride);
}

export function getPlanMaxDevices(user: PlanUser): number {
  return getPlanFeaturesForUser(user).maxDevices;
}

export function getPlanMaxDataPoints(user: PlanUser, seatsOverride?: number): number {
  return getPlanFeaturesForUser(user, seatsOverride).sharedMaxDataPointsPerUser;
}

export function getPlanDataRetentionDays(user: PlanUser): number {
  return getPlanFeaturesForUser(user).dataRetentionDays;
}
