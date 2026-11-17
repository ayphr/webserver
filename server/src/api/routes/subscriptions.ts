import type Stripe from 'stripe';
import { createLogger } from '../../lib/logger';
import {
  stripeWebhookErrorsTotal,
  stripeWebhookEventsTotal,
} from '../../lib/metrics';
import {
  constructStripeEvent,
  retrieveStripeSubscription,
} from '../../lib/stripe';
import { STRIPE_WEBHOOK_SECRET } from '../../env';
import {
  hasStripeEvent,
  recordStripeEvent,
} from '../../lib/db';
import {
  clearTeamStripeSubscription,
  getTeamByStripeCustomerId,
  setTeamStripeCustomerId,
  syncTeamStripeSubscription,
} from '../../lib/db/teams';

const log = createLogger('stripe-webhook');
export function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

/** Resolves the team owner of a Stripe subscription. */
async function resolveSubscriptionTarget(subscription: Stripe.Subscription): Promise<string | null> {
  const teamId = subscription.metadata?.teamId;
  if (teamId) return teamId;

  const customerId = getStripeCustomerId(subscription.customer);
  if (!customerId) return null;

  const team = await getTeamByStripeCustomerId(customerId);
  return team?.id ?? null;
}

async function handleSubscriptionUpsert(subscription: Stripe.Subscription) {
  const teamId = await resolveSubscriptionTarget(subscription);
  if (!teamId) {
    log.warn({ stripeSubscriptionId: subscription.id }, 'received subscription event for unknown team');
    return;
  }

  await syncTeamStripeSubscription(teamId, subscription);
  log.info(
    { teamId, stripeSubscriptionId: subscription.id, status: subscription.status },
    'synced team Stripe subscription',
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const teamId = await resolveSubscriptionTarget(subscription);
  if (!teamId) return;

  await clearTeamStripeSubscription(teamId, subscription.id);
  log.info({ teamId, stripeSubscriptionId: subscription.id }, 'removed team Stripe subscription');
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = getStripeCustomerId(session.customer);
  const teamId = session.metadata?.teamId;

  if (!teamId) {
    log.warn({ checkoutSessionId: session.id }, 'checkout completed without team metadata');
    return;
  }

  if (customerId) {
    const team = await getTeamByStripeCustomerId(customerId);
    if (!team) await setTeamStripeCustomerId(teamId, customerId);
  }

  await syncFromCheckoutSession(session);
}

async function syncFromCheckoutSession(session: Stripe.Checkout.Session) {
  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (subscription) await handleSubscriptionUpsert(subscription);
}

async function handleInvoiceEvent(invoice: Stripe.Invoice) {
  const invoiceWithSubscription = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    parent?: { subscription_details?: { subscription?: string | Stripe.Subscription | null } } | null;
  };
  const subscriptionRef =
    invoiceWithSubscription.subscription ??
    invoiceWithSubscription.parent?.subscription_details?.subscription;

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
    stripeWebhookErrorsTotal.inc({ type: 'signature_missing' });
    return Response.json({ error: 'missing stripe-signature header' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await constructStripeEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ message, payloadLength: payload.length }, 'failed to verify Stripe webhook signature');
    stripeWebhookErrorsTotal.inc({ type: 'signature_invalid' });
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  stripeWebhookEventsTotal.inc({ type: event.type });

  if (await hasStripeEvent(event.id)) {
    return Response.json({ received: true });
  }

  try {
    await handleStripeEvent(event);
    await recordStripeEvent(event.id, event.type);
  } catch (error) {
    log.error({ error, type: event.type }, 'failed to process Stripe webhook');
    stripeWebhookErrorsTotal.inc({ type: event.type });
    return Response.json({ error: 'webhook processing failed' }, { status: 500 });
  }

  return Response.json({ received: true });
}
