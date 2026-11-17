import Stripe from 'stripe';
import type { BillingInterval, SubscriptionPlan, SubscriptionTier } from '@common';
import { isSubscriptionTier, BILLING_INTERVALS, PURCHASABLE_SUBSCRIPTION_TIERS } from '@common';
import { STRIPE_PRICE_TIERS, STRIPE_SECRET_KEY, STRIPE_TRIAL_DAYS } from '../env';
import { createLogger } from './logger';

const log = createLogger('stripe');

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;

  if (!STRIPE_SECRET_KEY) {
    log.warn('STRIPE_SECRET_KEY is not set; Stripe features are disabled');
    return null;
  }

  stripeClient = new Stripe(STRIPE_SECRET_KEY);
  return stripeClient;
}

/** Returns false instead of throwing when a stored customer was deleted in Stripe. */
export async function stripeCustomerExists(customerId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return !('deleted' in customer && customer.deleted === true);
  } catch (error) {
    log.warn({ error, customerId }, 'stored Stripe customer is unavailable');
    return false;
  }
}

export function getPriceIdForTier(tier: SubscriptionTier, interval: BillingInterval): string | null {
  for (const [priceId, config] of Object.entries(STRIPE_PRICE_TIERS)) {
    if (config.tier === tier && config.interval === interval) return priceId;
  }
  return null;
}

let plansCache: { expiresAt: number; plans: SubscriptionPlan[] } | null = null;
const PLANS_CACHE_MS = 5 * 60 * 1000;

export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  if (plansCache && plansCache.expiresAt > Date.now()) {
    return plansCache.plans;
  }

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
          return {
            ...base,
            amount: price.unit_amount,
            currency: price.currency,
          };
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

function toTier(value: unknown): SubscriptionTier | null {
  return isSubscriptionTier(value) ? value : null;
}

export function resolveTierFromStripeSubscription(subscription: Stripe.Subscription): SubscriptionTier | null {
  for (const item of subscription.items.data) {
    const metadataTier = toTier(item.price?.metadata?.tier);
    if (metadataTier) return metadataTier;

    const priceId = item.price?.id;
    if (priceId) {
      const mapped = toTier(STRIPE_PRICE_TIERS[priceId]?.tier);
      if (mapped) return mapped;
    }
  }

  return null;
}

export async function constructStripeEvent(payload: string | Buffer, signature: string, secret: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  return stripe.webhooks.constructEventAsync(payload, signature, secret);
}export async function createTeamStripeCustomer(params: {
  teamId: string;
  name: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customer = await stripe.customers.create({
    name: params.name,
    metadata: { teamId: params.teamId },
  });

  return customer.id;
}export async function createTeamCheckoutSession(params: {
  customerId: string;
  priceId: string;
  tier: SubscriptionTier;
  teamId: string;
  successUrl: string;
  cancelUrl: string;
  quantity?: number;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: Math.max(1, params.quantity ?? 1) }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
    metadata: { teamId: params.teamId, tier: params.tier },
    subscription_data: {
      trial_period_days: STRIPE_TRIAL_DAYS,
      metadata: { teamId: params.teamId, tier: params.tier },
    },
  });

  return session.url;
}

export async function cancelTeamStripeSubscription(subscriptionId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return true;
  } catch (error) {
    log.warn({ error, subscriptionId }, 'failed to cancel team Stripe subscription');
    return false;
  }
}

export async function changeTeamStripeSubscription(
  subscriptionId: string,
  priceId: string,
  quantity: number,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  const current = await stripe.subscriptions.retrieve(subscriptionId);
  const item = current.items.data[0];
  if (!item) return null;
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: item.id, price: priceId, quantity: Math.max(1, quantity) }],
    proration_behavior: 'create_prorations',
  });
}

export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });

  return session.url;
}

export async function retrieveStripeSubscription(id: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  return stripe.subscriptions.retrieve(id);
}

export async function updateSubscriptionQuantity(
  stripeSubscriptionId: string,
  quantity: number,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const item = subscription.items.data[0];
  if (!item) return null;

  return stripe.subscriptions.update(stripeSubscriptionId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: 'none',
  });
}
