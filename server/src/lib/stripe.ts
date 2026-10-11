import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import type { BillingInterval, PaidSubscription, PaidSubscriptionStatus, SubscriptionPlan, SubscriptionTier } from '@common';
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

function getBillingPeriod(subscription: Stripe.Subscription): { start: Date | null; end: Date | null } {
  let start: number | null = null;
  let end: number | null = null;

  for (const item of subscription.items.data) {
    const itemStart = item.current_period_start;
    const itemEnd = item.current_period_end;

    if (itemStart !== null && itemStart !== undefined && (start === null || itemStart < start)) {
      start = itemStart;
    }

    if (itemEnd !== null && itemEnd !== undefined && (end === null || itemEnd > end)) {
      end = itemEnd;
    }
  }

  return {
    start: start === null ? null : new Date(start * 1000),
    end: end === null ? null : new Date(end * 1000),
  };
}

function toStripeCustomerId(customer: Stripe.Subscription['customer']): string {
  return typeof customer === 'string' ? customer : customer.id;
}

export function mapStripeSubscription(
  subscription: Stripe.Subscription,
  options: { id?: string; now?: Date } = {},
): PaidSubscription | null {
  const tier = resolveTierFromStripeSubscription(subscription);
  if (!tier) {
    log.warn({ stripeSubscriptionId: subscription.id }, 'could not resolve tier for Stripe subscription');
    return null;
  }

  const now = options.now ?? new Date();
  const period = getBillingPeriod(subscription);
  const items = subscription.items.data;
  const firstItem = items[0];

  return {
    id: options.id ?? randomUUID(),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: toStripeCustomerId(subscription.customer),
    stripePriceId: firstItem?.price?.id,
    stripeProductId:
      typeof firstItem?.price?.product === 'string'
        ? firstItem.price.product
        : firstItem?.price?.product?.id,
    tier,
    status: subscription.status as PaidSubscriptionStatus,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    createdAt: new Date(subscription.created * 1000),
    updatedAt: now,
  };
}

export async function constructStripeEvent(payload: string | Buffer, signature: string, secret: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  return stripe.webhooks.constructEventAsync(payload, signature, secret);
}

export async function createStripeCustomer(params: {
  userUuid: string;
  username: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const customer = await stripe.customers.create({
    name: params.username,
    metadata: { userUuid: params.userUuid },
  });

  return customer.id;
}

export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  tier: SubscriptionTier;
  userUuid: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
    metadata: { userUuid: params.userUuid, tier: params.tier },
    subscription_data: {
      trial_period_days: STRIPE_TRIAL_DAYS,
      metadata: { userUuid: params.userUuid, tier: params.tier },
    },
  });

  return session.url;
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

export async function setStripeSubscriptionAutoRenew(
  stripeSubscriptionId: string,
  autoRenew: boolean,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: !autoRenew,
  });
}
