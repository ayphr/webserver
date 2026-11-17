import type Stripe from 'stripe';
import {
  getTeamByStripeCustomerId,
  setTeamStripeCustomerId,
} from './db/teams';
import {
  clearTeamStripeSubscription,
  syncTeamStripeSubscription,
} from './teamBillingSync';
import { retrieveStripeSubscription } from './stripe';
import { createLogger } from './logger';

const log = createLogger('subscription-sync');

export function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

async function resolveSubscriptionTeam(subscription: Stripe.Subscription): Promise<string | null> {
  const teamId = subscription.metadata?.teamId;
  if (teamId) return teamId;

  const customerId = getStripeCustomerId(subscription.customer);
  if (!customerId) return null;

  const team = await getTeamByStripeCustomerId(customerId);
  return team?.id ?? null;
}

async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const teamId = await resolveSubscriptionTeam(subscription);
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

async function removeSubscription(subscription: Stripe.Subscription): Promise<void> {
  const teamId = await resolveSubscriptionTeam(subscription);
  if (!teamId) return;

  await clearTeamStripeSubscription(teamId, subscription.id);
  log.info({ teamId, stripeSubscriptionId: subscription.id }, 'removed team Stripe subscription');
}

async function syncCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const customerId = getStripeCustomerId(session.customer);
  const teamId = session.metadata?.teamId;
  if (!teamId) {
    log.warn({ checkoutSessionId: session.id }, 'checkout completed without team metadata');
    return;
  }

  if (customerId && !(await getTeamByStripeCustomerId(customerId))) {
    await setTeamStripeCustomerId(teamId, customerId);
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (subscription) await syncSubscription(subscription);
}

async function syncInvoice(invoice: Stripe.Invoice): Promise<void> {
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
  if (subscription) await syncSubscription(subscription);
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await syncCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.resumed':
    case 'customer.subscription.paused':
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await removeSubscription(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await syncInvoice(event.data.object as Stripe.Invoice);
      break;
    default:
      break;
  }
}
