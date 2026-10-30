import type { PlanFeatures, PlanTier, PublicUser, User } from '../types';
import { PLAN_FEATURES } from '../types/plans';
import { resolveSubscription } from './subscriptions';

type PlanUser = Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'> | Pick<PublicUser, 'subscription'> | null | undefined;

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

export function getPlanFeatures(plan: PlanTier | PlanUser): PlanFeatures {
  if (typeof plan === 'string') {
    return PLAN_FEATURES[plan];
  }

  return PLAN_FEATURES[getPlanTier(plan)];
}

export function getPlanFeaturesForTier(tier: PlanTier): PlanFeatures {
  return PLAN_FEATURES[tier];
}

export function getPlanFeaturesForUser(user: PlanUser): PlanFeatures {
  return PLAN_FEATURES[getPlanTier(user)];
}

export function getUserPlanFeatures(user: PlanUser): PlanFeatures {
  return getPlanFeaturesForUser(user);
}

export function getFeaturesForPlan(plan: PlanTier | PlanUser): PlanFeatures {
  return getPlanFeatures(plan);
}

export function getPlanMaxDevices(user: PlanUser): number {
  return getPlanFeaturesForUser(user).maxDevices;
}

export function getPlanMaxDataPoints(user: PlanUser): number {
  return getPlanFeaturesForUser(user).sharedMaxDataPointsPerUser;
}

export function getPlanDataRetentionDays(user: PlanUser): number {
  return getPlanFeaturesForUser(user).dataRetentionDays;
}