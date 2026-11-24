import type Stripe from 'stripe';
import { createLogger } from '../../lib/logger';
import {
  stripeWebhookErrorsTotal,
  stripeWebhookEventsTotal,
} from '../../lib/metrics';
import {
  constructStripeEvent,
} from '../../lib/stripe';
import { STRIPE_WEBHOOK_SECRET } from '../../env';
import { getCollection, trackMongoOperation, STRIPE_EVENTS_COLLECTION } from '../../lib/db';
import { isDuplicateKeyError } from '../../lib/http';
import {
  processStripeEvent,
  StripeEventRetryableError,
} from '../../lib/subscriptionSync';

const log = createLogger('stripe-webhook');

type StripeEventDocument = {
  id: string;
  type: string;
  createdAt: Date;
};

/**
 * Only the collection methods needed for the idempotency claim. Keeping this
 * seam narrow lets tests exercise duplicate/concurrent deliveries with a fake.
 */
export type StripeEventsClaimCollection = {
  insertOne(document: StripeEventDocument): Promise<unknown>;
  deleteOne(filter: { id: string }): Promise<unknown>;
};

export type StripeWebhookProcessingDeps = {
  events: StripeEventsClaimCollection;
  processEvent: typeof processStripeEvent;
};

export type StripeWebhookOutcome =
  | { kind: 'duplicate' }
  | { kind: 'processed' }
  | { kind: 'retryable'; reason: string };

/** Inserts the claim before processing; a duplicate key means "already seen". */
export async function claimStripeEvent(
  events: StripeEventsClaimCollection,
  event: Stripe.Event,
): Promise<boolean> {
  trackMongoOperation('insertOne', STRIPE_EVENTS_COLLECTION);
  try {
    await events.insertOne({
      id: event.id,
      type: event.type,
      createdAt: new Date(),
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

/** Removes an incomplete claim so Stripe can retry the event. */
export async function releaseStripeEventClaim(
  events: StripeEventsClaimCollection,
  eventId: string,
): Promise<void> {
  trackMongoOperation('deleteOne', STRIPE_EVENTS_COLLECTION);
  await events.deleteOne({ id: eventId });
}

/**
 * Claims, processes, and finalizes (or rolls back) a verified Stripe event.
 * The claim insert is the atomic check-and-set: no separate `hasStripeEvent`
 * read is involved, so concurrent deliveries cannot both process an event.
 */
export async function processVerifiedStripeEvent(
  event: Stripe.Event,
  deps: StripeWebhookProcessingDeps,
): Promise<StripeWebhookOutcome> {
  if (!await claimStripeEvent(deps.events, event)) {
    return { kind: 'duplicate' };
  }

  try {
    await deps.processEvent(event);
    return { kind: 'processed' };
  } catch (error) {
    // Do not leave a claim behind for a failed event; Stripe must be able to
    // retry it after the underlying problem (often missing team metadata) is
    // reconciled.
    await releaseStripeEventClaim(deps.events, event.id);
    if (error instanceof StripeEventRetryableError) {
      return { kind: 'retryable', reason: error.reason };
    }
    throw error;
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

  try {
    const events = await getCollection('stripeEvents') as unknown as StripeEventsClaimCollection;
    const outcome = await processVerifiedStripeEvent(event, { events, processEvent: processStripeEvent });

    if (outcome.kind === 'duplicate') {
      log.info({ eventId: event.id, type: event.type }, 'ignoring duplicate Stripe webhook');
      return Response.json({ received: true, duplicate: true });
    }

    if (outcome.kind === 'retryable') {
      // Reconciliation note: inspect the event's teamId metadata / customer
      // mapping in Stripe, then let Stripe redeliver. The claim was removed.
      log.warn(
        { eventId: event.id, type: event.type, reason: outcome.reason },
        'Stripe webhook needs team reconciliation; leaving event unrecorded for retry',
      );
      stripeWebhookErrorsTotal.inc({ type: event.type });
      return Response.json(
        { error: 'Stripe event requires team reconciliation', retryable: true },
        { status: 503 },
      );
    }

    return Response.json({ received: true });
  } catch (error) {
    log.error({ error, type: event.type }, 'failed to process Stripe webhook');
    stripeWebhookErrorsTotal.inc({ type: event.type });
    return Response.json({ error: 'webhook processing failed' }, { status: 500 });
  }
}
