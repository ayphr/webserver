import Stripe from 'stripe';
import type { SubscriptionTier } from '@common';
import { STRIPE_TRIAL_DAYS } from '../env';
import { createLogger } from './logger';
import { getStripe } from './stripeClient';
export { getStripe } from './stripeClient';
export {
  getPriceIdForTier,
  getBillingIntervalFromStripeSubscription,
  getSubscriptionPlans,
  resolveTierFromStripeSubscription,
} from './stripeCatalog';

const log = createLogger('stripe');

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
