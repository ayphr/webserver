import { describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import { getStripeCustomerId } from './subscriptions';

describe('subscription helpers', () => {
  test('normalizes Stripe customer references', () => {
    expect(getStripeCustomerId('cus_123')).toBe('cus_123');
    expect(getStripeCustomerId({ id: 'cus_456' } as Stripe.Customer)).toBe('cus_456');
    expect(getStripeCustomerId(null)).toBeNull();
  });
});
