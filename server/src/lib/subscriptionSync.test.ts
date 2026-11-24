import { describe, expect, test } from 'bun:test';
import type Stripe from 'stripe';
import {
  StripeEventRetryableError,
  UnknownStripeTeamError,
  getStripeCustomerId,
  resolveSubscriptionTeam,
  type SubscriptionSyncDeps,
} from './subscriptionSync';

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    metadata: {},
    customer: 'cus_1',
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function deps(overrides: Partial<SubscriptionSyncDeps> = {}): SubscriptionSyncDeps {
  return {
    getTeamById: async () => null,
    getTeamByStripeCustomerId: async () => null,
    setTeamStripeCustomerId: async () => {},
    syncTeamStripeSubscription: async () => {},
    clearTeamStripeSubscription: async () => {},
    retrieveStripeSubscription: async () => null,
    ...overrides,
  } as SubscriptionSyncDeps;
}

describe('subscription team resolution', () => {
  test('prefers valid team metadata', async () => {
    const team = { id: 'team-meta' };
    const resolved = await resolveSubscriptionTeam(
      subscription({ metadata: { teamId: 'team-meta' }, customer: 'cus_missing' }),
      deps({
        getTeamById: async (id: string) => (id === 'team-meta' ? team as never : null),
      }),
    );
    expect(resolved).toBe('team-meta');
  });

  test('falls back to the Stripe customer mapping', async () => {
    const resolved = await resolveSubscriptionTeam(
      subscription({ metadata: { teamId: 'stale' }, customer: { id: 'cus_known' } }),
      deps({
        getTeamByStripeCustomerId: async (id: string) =>
          (id === 'cus_known' ? { id: 'team-customer' } as never : null),
      }),
    );
    expect(resolved).toBe('team-customer');
  });

  test('throws a retryable error when no team can be resolved', async () => {
    const error = await resolveSubscriptionTeam(
      subscription({ metadata: { teamId: 'stale' }, customer: 'cus_unknown' }),
      deps(),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnknownStripeTeamError);
    expect(error).toBeInstanceOf(StripeEventRetryableError);
    expect((error as { retryable?: boolean }).retryable).toBe(true);
  });

  test('extracts customer ids from expanded or deleted customers', () => {
    expect(getStripeCustomerId('cus_1')).toBe('cus_1');
    expect(getStripeCustomerId({ id: 'cus_2' } as never)).toBe('cus_2');
    expect(getStripeCustomerId(null)).toBe(null);
  });
});
