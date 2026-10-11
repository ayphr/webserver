import type { BadgeId } from './badges';

export type SubscriptionTier = Extract<
  BadgeId,
  'lite' | 'plus' | 'ultra' | 'team-lite' | 'team-plus' | 'team-ultra'
>;

export const SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  'lite',
  'plus',
  'ultra',
  'team-lite',
  'team-plus',
  'team-ultra',
];

/**
 * Ranking used to compare tiers. Higher is better, matching the order:
 * lite < plus < ultra < team lite < team plus < team ultra.
 */
export const SUBSCRIPTION_TIER_RANK: Record<SubscriptionTier, number> = {
  lite: 0,
  plus: 1,
  ultra: 2,
  'team-lite': 3,
  'team-plus': 4,
  'team-ultra': 5,
};

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && (SUBSCRIPTION_TIERS as readonly string[]).includes(value);
}

export const PURCHASABLE_SUBSCRIPTION_TIERS: readonly SubscriptionTier[] = [
  'lite',
  'plus',
  'ultra',
];

export function isPurchasableTier(value: unknown): value is SubscriptionTier {
  return isSubscriptionTier(value) && (PURCHASABLE_SUBSCRIPTION_TIERS as readonly string[]).includes(value);
}

export type PaidSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type PaidSubscription = {
  id: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId?: string;
  stripeProductId?: string;
  tier: SubscriptionTier;
  status: PaidSubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AttachedSubscription = {
  id: string;
  tier: SubscriptionTier;
  createdAt: Date;
  expiresAt: Date | null;
  addedByUuid: string;
  addedByUsername?: string;
  reason?: string;
};

export type SubscriptionSource = 'paid' | 'attached';

export type ResolvedSubscription = {
  tier: SubscriptionTier;
  source: SubscriptionSource;
  expiresAt: Date | null;
  paidSubscription?: PaidSubscription;
  attachedSubscription?: AttachedSubscription;
};

export type PublicSubscription = {
  tier: SubscriptionTier;
  source: SubscriptionSource;
  expiresAt: Date | null;
};

export type BillingInterval = 'month' | 'year';

export const BILLING_INTERVALS: readonly BillingInterval[] = ['month', 'year'];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'month' || value === 'year';
}

export type SubscriptionPlan = {
  tier: SubscriptionTier;
  interval: BillingInterval;
  priceId: string | null;
  amount: number | null;
  currency: string | null;
  trialDays: number;
};
