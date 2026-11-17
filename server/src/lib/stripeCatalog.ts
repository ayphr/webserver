import type Stripe from 'stripe';
import type { BillingInterval, SubscriptionPlan, SubscriptionTier } from '@common';
import { isSubscriptionTier, BILLING_INTERVALS, PURCHASABLE_SUBSCRIPTION_TIERS } from '@common';
import { STRIPE_PRICE_TIERS, STRIPE_TRIAL_DAYS } from '../env';
import { getStripe } from './stripeClient';
import { createLogger } from './logger';

const log = createLogger('stripe-catalog');

export function getPriceIdForTier(tier: SubscriptionTier, interval: BillingInterval): string | null {
  for (const [priceId, config] of Object.entries(STRIPE_PRICE_TIERS)) {
    if (config.tier === tier && config.interval === interval) return priceId;
  }
  return null;
}

export function getBillingIntervalFromStripeSubscription(
  subscription: Stripe.Subscription,
): BillingInterval | undefined {
  const interval = subscription.items.data[0]?.price?.recurring?.interval;
  if (interval === 'year') return 'year';
  if (interval === 'month') return 'month';
  return undefined;
}

let plansCache: { expiresAt: number; plans: SubscriptionPlan[] } | null = null;
const PLANS_CACHE_MS = 5 * 60 * 1000;

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.plans;

  const stripe = getStripe();
  const plans = await Promise.all(
    PURCHASABLE_SUBSCRIPTION_TIERS.flatMap((tier) =>
      BILLING_INTERVALS.map(async (interval): Promise<SubscriptionPlan> => {
        const priceId = getPriceIdForTier(tier, interval);
        const base: SubscriptionPlan = {
          tier,
          interval,
          priceId,
          amount: null,
          currency: null,
          trialDays: STRIPE_TRIAL_DAYS,
        };

        if (!priceId || !stripe) return base;

        try {
          const price = await stripe.prices.retrieve(priceId);
          return { ...base, amount: price.unit_amount, currency: price.currency };
        } catch (error) {
          log.warn({ error, priceId, tier, interval }, 'failed to retrieve Stripe price');
          return base;
        }
      }),
    ),
  );

  plansCache = { expiresAt: Date.now() + PLANS_CACHE_MS, plans };
  return plans;
}

export function resolveTierFromStripeSubscription(subscription: Stripe.Subscription): SubscriptionTier | null {
  for (const item of subscription.items.data) {
    if (isSubscriptionTier(item.price?.metadata?.tier)) return item.price.metadata.tier;

    const mapped = item.price?.id ? STRIPE_PRICE_TIERS[item.price.id]?.tier : undefined;
    if (isSubscriptionTier(mapped)) return mapped;
  }

  return null;
}
