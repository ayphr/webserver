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
import {
  hasStripeEvent,
  recordStripeEvent,
} from '../../lib/db';
import { processStripeEvent } from '../../lib/subscriptions';

const log = createLogger('stripe-webhook');

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
    await processStripeEvent(event);
    await recordStripeEvent(event.id, event.type);
  } catch (error) {
    log.error({ error, type: event.type }, 'failed to process Stripe webhook');
    stripeWebhookErrorsTotal.inc({ type: event.type });
    return Response.json({ error: 'webhook processing failed' }, { status: 500 });
  }

  return Response.json({ received: true });
}
