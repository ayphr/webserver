import type Stripe from 'stripe';
import {
  getTeamById,
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

/**
 * Marks an event that cannot be applied yet. The webhook route leaves such an
 * events unrecorded so Stripe retries it after reconciliation (for example,
 * after the team metadata or customer mapping has been repaired).
 */
export class StripeEventRetryableError extends Error {
  readonly retryable = true;
  readonly reason: string;

  constructor(reason: string) {
    super(`Stripe event cannot be processed yet: ${reason}`);
    this.name = 'StripeEventRetryableError';
    this.reason = reason;
  }
}

export class UnknownStripeTeamError extends StripeEventRetryableError {
  constructor(reference: string) {
    super(`no team could be resolved for ${reference}`);
    this.name = 'UnknownStripeTeamError';
  }
}

export function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

/** Injectable seams so event handling can be tested without Stripe or Mongo. */
export type SubscriptionSyncDeps = {
  getTeamById: typeof getTeamById;
  getTeamByStripeCustomerId: typeof getTeamByStripeCustomerId;
  setTeamStripeCustomerId: typeof setTeamStripeCustomerId;
  syncTeamStripeSubscription: typeof syncTeamStripeSubscription;
  clearTeamStripeSubscription: typeof clearTeamStripeSubscription;
  retrieveStripeSubscription: typeof retrieveStripeSubscription;
};

const defaultDeps: SubscriptionSyncDeps = {
  getTeamById,
  getTeamByStripeCustomerId,
  setTeamStripeCustomerId,
  syncTeamStripeSubscription,
  clearTeamStripeSubscription,
  retrieveStripeSubscription,
};

export async function resolveSubscriptionTeam(
  subscription: Stripe.Subscription,
  deps: SubscriptionSyncDeps = defaultDeps,
): Promise<string> {
  const metadataTeamId = typeof subscription.metadata?.teamId === 'string'
    ? subscription.metadata.teamId.trim()
    : '';
  if (metadataTeamId && await deps.getTeamById(metadataTeamId)) {
    return metadataTeamId;
  }

  const customerId = getStripeCustomerId(subscription.customer);
  if (customerId) {
    const team = await deps.getTeamByStripeCustomerId(customerId);
    if (team) return team.id;
  }

  throw new UnknownStripeTeamError(
    `subscription ${subscription.id}${metadataTeamId ? ` (teamId=${metadataTeamId})` : ''}`,
  );
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  deps: SubscriptionSyncDeps,
): Promise<void> {
  const teamId = await resolveSubscriptionTeam(subscription, deps);
  await deps.syncTeamStripeSubscription(teamId, subscription);
  log.info(
    { teamId, stripeSubscriptionId: subscription.id, status: subscription.status },
    'synced team Stripe subscription',
  );
}

async function removeSubscription(
  subscription: Stripe.Subscription,
  deps: SubscriptionSyncDeps,
): Promise<void> {
  const teamId = await resolveSubscriptionTeam(subscription, deps);
  await deps.clearTeamStripeSubscription(teamId, subscription.id);
  log.info({ teamId, stripeSubscriptionId: subscription.id }, 'removed team Stripe subscription');
}

async function syncCheckoutSession(
  session: Stripe.Checkout.Session,
  deps: SubscriptionSyncDeps,
): Promise<void> {
  const customerId = getStripeCustomerId(session.customer);
  const teamId = typeof session.metadata?.teamId === 'string' ? session.metadata.teamId.trim() : '';
  if (!teamId || !await deps.getTeamById(teamId)) {
    // Reconciliation note: checkout sessions are always created with a teamId;
    // a missing/stale one means the Stripe metadata needs repair.
    throw new UnknownStripeTeamError(`checkout session ${session.id}`);
  }

  if (customerId && !(await deps.getTeamByStripeCustomerId(customerId))) {
    await deps.setTeamStripeCustomerId(teamId, customerId);
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;
  if (!subscriptionId) return;

  const subscription = await deps.retrieveStripeSubscription(subscriptionId);
  if (!subscription) {
    throw new UnknownStripeTeamError(`subscription ${subscriptionId} referenced by checkout ${session.id}`);
  }
  await syncSubscription(subscription, deps);
}

async function syncInvoice(
  invoice: Stripe.Invoice,
  deps: SubscriptionSyncDeps,
): Promise<void> {
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
  // Non-subscription invoices have no team to sync.
  if (!subscriptionId) return;

  const subscription = await deps.retrieveStripeSubscription(subscriptionId);
  if (!subscription) {
    throw new UnknownStripeTeamError(`subscription ${subscriptionId} referenced by invoice ${invoice.id}`);
  }
  await syncSubscription(subscription, deps);
}

export async function processStripeEvent(
  event: Stripe.Event,
  deps: SubscriptionSyncDeps = defaultDeps,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await syncCheckoutSession(event.data.object as Stripe.Checkout.Session, deps);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.resumed':
    case 'customer.subscription.paused':
      await syncSubscription(event.data.object as Stripe.Subscription, deps);
      break;
    case 'customer.subscription.deleted':
      await removeSubscription(event.data.object as Stripe.Subscription, deps);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await syncInvoice(event.data.object as Stripe.Invoice, deps);
      break;
    default:
      break;
  }
}
