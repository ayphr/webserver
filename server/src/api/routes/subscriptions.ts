import type Stripe from 'stripe';
import { createLogger } from '../../lib/logger';
import { requireAuth } from '../auth';
import {
  constructStripeEvent,
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  getPriceIdForTier,
  getStripe,
  getSubscriptionPlans,
  mapStripeSubscription,
  retrieveStripeSubscription,
  setStripeSubscriptionAutoRenew,
} from '../../lib/stripe';
import { CLIENT_URL, STRIPE_TRIAL_DAYS, STRIPE_WEBHOOK_SECRET } from '../../env';
import { isSubscriptionTier, isPurchasableTier, isBillingInterval } from '@common';
import { getActivePaidSubscription } from '@common';
import { getUserSubscription } from '../../lib/subscriptions';
import {
  getPaidSubscriptionsForUserUuid,
  getUserByStripeCustomerId,
  getUserUuidByStripeCustomerId,
  recordStripeEvent,
  removePaidSubscription,
  setUserStripeCustomerId,
  upsertPaidSubscription,
} from '../../lib/db';

const log = createLogger('stripe-webhook');

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

/** Resolves the internal user uuid for a Stripe subscription. */
async function resolveUserUuid(subscription: Stripe.Subscription): Promise<string | null> {
  const metadataUuid = subscription.metadata?.userUuid;
  if (metadataUuid) return metadataUuid;

  const customerId = getStripeCustomerId(subscription.customer);
  if (!customerId) return null;

  return getUserUuidByStripeCustomerId(customerId);
}

async function handleSubscriptionUpsert(subscription: Stripe.Subscription) {
  const userUuid = await resolveUserUuid(subscription);
  if (!userUuid) {
    log.warn({ stripeSubscriptionId: subscription.id }, 'received subscription event for unknown user');
    return;
  }

  const existing = await getPaidSubscriptionsForUserUuid(userUuid);
  const match = existing.find((record) => record.stripeSubscriptionId === subscription.id);

  const record = mapStripeSubscription(subscription, { id: match?.id });
  if (!record) return;

  await upsertPaidSubscription(userUuid, record);
  log.info(
    { userUuid, stripeSubscriptionId: subscription.id, status: record.status, tier: record.tier },
    'synced Stripe subscription',
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userUuid = await resolveUserUuid(subscription);
  if (!userUuid) return;

  await removePaidSubscription(userUuid, subscription.id);
  log.info({ userUuid, stripeSubscriptionId: subscription.id }, 'removed Stripe subscription');
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = getStripeCustomerId(session.customer);
  const userUuid = session.metadata?.userUuid
    ?? (customerId ? await getUserUuidByStripeCustomerId(customerId) : null);

  if (!userUuid) {
    log.warn({ checkoutSessionId: session.id }, 'checkout completed for unknown user');
    return;
  }

  if (customerId) {
    const user = await getUserByStripeCustomerId(customerId);
    if (!user) await setUserStripeCustomerId(userUuid, customerId);
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (subscription) await handleSubscriptionUpsert(subscription);
}

async function handleInvoiceEvent(invoice: Stripe.Invoice) {
  const subscriptionRef = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  }).subscription;

  const subscriptionId = typeof subscriptionRef === 'string'
    ? subscriptionRef
    : subscriptionRef?.id;

  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (subscription) await handleSubscriptionUpsert(subscription);
}

async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.resumed':
    case 'customer.subscription.paused':
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await handleInvoiceEvent(event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }
}

export async function handleStripeWebhook(request: Request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: 'Stripe webhooks are not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await constructStripeEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ message, payloadLength: payload.length }, 'failed to verify Stripe webhook signature');
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
    await recordStripeEvent(event.id, event.type);
  } catch (error) {
    log.error({ error, type: event.type }, 'failed to process Stripe webhook');
    return Response.json({ error: 'webhook processing failed' }, { status: 500 });
  }

  return Response.json({ received: true });
}

const handleSubscriptionMe = requireAuth(async (_request, user) => {
  const plans = await getSubscriptionPlans();
  const paid = getActivePaidSubscription(user);

  return json({
    subscription: getUserSubscription(user),
    paidSubscription: paid,
    attachedSubscriptions: user.attachedSubscriptions ?? [],
    plans,
    trialDays: STRIPE_TRIAL_DAYS,
  });
}, { allowSuspended: true });

const handleSubscriptionCheckout = requireAuth(async (request, user) => {
  const stripe = getStripe();
  if (!stripe) {
    return json({ error: 'Stripe is not configured' }, 503);
  }

  const body = await readJsonBody(request);
  const tier = body?.tier;
  const interval = body?.interval;
  if (!isSubscriptionTier(tier)) {
    return json({ error: 'tier must be a valid subscription tier' }, 400);
  }

  if (!isBillingInterval(interval)) {
    return json({ error: 'interval must be "month" or "year"' }, 400);
  }

  if (!isPurchasableTier(tier)) {
    return json({ error: 'This plan is not available for purchase' }, 400);
  }

  const priceId = getPriceIdForTier(tier, interval);
  if (!priceId) {
    return json({ error: 'This plan is not available for purchase' }, 503);
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    customerId = await createStripeCustomer({ userUuid: user.uuid, username: user.username }) ?? undefined;
    if (!customerId) {
      return json({ error: 'Failed to create billing customer' }, 502);
    }
    await setUserStripeCustomerId(user.uuid, customerId);
  }

  const url = await createCheckoutSession({
    customerId,
    priceId,
    tier,
    userUuid: user.uuid,
    successUrl: `${CLIENT_URL}/dashboard?tab=subscription&checkout=success`,
    cancelUrl: `${CLIENT_URL}/dashboard?tab=subscription&checkout=cancel`,
  });

  if (!url) {
    return json({ error: 'Failed to create checkout session' }, 502);
  }

  return json({ url });
});

const handleSubscriptionAutoRenew = requireAuth(async (request, user) => {
  const body = await readJsonBody(request);
  const autoRenew = body?.autoRenew;
  if (typeof autoRenew !== 'boolean') {
    return json({ error: 'autoRenew must be a boolean' }, 400);
  }

  const paid = getActivePaidSubscription(user);
  if (!paid) {
    return json({ error: 'No active paid subscription' }, 404);
  }

  if (paid.status === 'trialing' && !autoRenew) {
    return json({ error: 'Auto-renew cannot be disabled during a free trial' }, 400);
  }

  const updated = await setStripeSubscriptionAutoRenew(paid.stripeSubscriptionId, autoRenew);
  if (!updated) {
    return json({ error: 'Stripe is not configured' }, 503);
  }

  paid.cancelAtPeriodEnd = !autoRenew;
  paid.updatedAt = new Date();
  if (updated.status) paid.status = updated.status as typeof paid.status;
  await upsertPaidSubscription(user.uuid, paid);

  return json({ paidSubscription: paid });
}, { allowSuspended: true });

const handleSubscriptionPortal = requireAuth(async (_request, user) => {
  if (!user.stripeCustomerId) {
    return json({ error: 'No billing account found' }, 404);
  }

  const url = await createBillingPortalSession({
    customerId: user.stripeCustomerId,
    returnUrl: `${CLIENT_URL}/dashboard?tab=subscription`,
  });

  if (!url) {
    return json({ error: 'Stripe is not configured' }, 503);
  }

  return json({ url });
}, { allowSuspended: true });

export {
  handleSubscriptionMe,
  handleSubscriptionCheckout,
  handleSubscriptionAutoRenew,
  handleSubscriptionPortal,
};
