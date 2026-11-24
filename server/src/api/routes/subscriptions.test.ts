import { describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import {
  claimStripeEvent,
  processVerifiedStripeEvent,
  type StripeEventsClaimCollection,
} from './subscriptions';
import { UnknownStripeTeamError } from '../../lib/subscriptionSync';

function stripeEvent(id: string): Stripe.Event {
  return {
    id,
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_1' } },
  } as unknown as Stripe.Event;
}

function fakeEvents() {
  const claimed = new Set<string>();
  const removed: string[] = [];
  const collection = {
    insertOne: async (doc: { id: string }) => {
      if (claimed.has(doc.id)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      claimed.add(doc.id);
      return { insertedId: doc.id };
    },
    deleteOne: async (filter: { id: string }) => {
      removed.push(filter.id);
      claimed.delete(filter.id);
      return { deletedCount: 1 };
    },
  } as unknown as StripeEventsClaimCollection;
  return { collection, claimed, removed };
}

describe('Stripe webhook idempotency', () => {
  test('claims atomically before processing and reports duplicates', async () => {
    const events = fakeEvents();
    const event = stripeEvent('evt_1');
    let processed = 0;
    const deps = {
      events: events.collection,
      processEvent: async () => { processed += 1; },
    };

    expect(await claimStripeEvent(events.collection, event)).toBe(true);
    expect(await claimStripeEvent(events.collection, event)).toBe(false);

    expect(await processVerifiedStripeEvent(event, deps)).toEqual({ kind: 'duplicate' });
    expect(processed).toBe(0);
  });

  test('concurrent deliveries process the event exactly once', async () => {
    const events = fakeEvents();
    const event = stripeEvent('evt_concurrent');
    let processed = 0;
    const deps = {
      events: events.collection,
      processEvent: async () => { processed += 1; },
    };

    const outcomes = await Promise.all([
      processVerifiedStripeEvent(event, deps),
      processVerifiedStripeEvent(event, deps),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'processed')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'duplicate')).toHaveLength(1);
    expect(processed).toBe(1);
  });

  test('releases the claim and returns retryable for an unknown team', async () => {
    const events = fakeEvents();
    const deps = {
      events: events.collection,
      processEvent: async () => {
        throw new UnknownStripeTeamError('subscription sub_missing');
      },
    };

    const outcome = await processVerifiedStripeEvent(stripeEvent('evt_unknown'), deps);
    expect(outcome.kind).toBe('retryable');
    if (outcome.kind === 'retryable') {
      expect(outcome.reason).toContain('sub_missing');
    }
    expect(events.removed).toEqual(['evt_unknown']);
    expect(events.claimed.size).toBe(0);
  });

  test('rethrows unexpected failures but still releases the claim', async () => {
    const events = fakeEvents();
    const deps = {
      events: events.collection,
      processEvent: async () => { throw new Error('database unavailable'); },
    };

    await expect(processVerifiedStripeEvent(stripeEvent('evt_fail'), deps)).rejects.toThrow('database unavailable');
    expect(events.removed).toEqual(['evt_fail']);
  });
});
