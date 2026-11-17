import { describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import { getBillingIntervalFromStripeSubscription, getPriceIdForTier } from './stripe';

describe('Stripe helpers', () => {
  test('maps configured billing intervals and rejects unknown intervals', () => {
    const subscription = {
      items: {
        data: [{ price: { recurring: { interval: 'month' } } }],
      },
    } as Stripe.Subscription;
    expect(getBillingIntervalFromStripeSubscription(subscription)).toBe('month');

    subscription.items.data[0]!.price!.recurring!.interval = 'week';
    expect(getBillingIntervalFromStripeSubscription(subscription)).toBeUndefined();
  });

  test('returns null when no configured price matches', () => {
    expect(getPriceIdForTier('lite', 'month')).toBeNull();
  });
});
