import { describe, expect, it } from 'bun:test';
import { getPlanFeaturesForUser, getPlanSeats } from './plans';

describe('getPlanFeaturesForUser and team seats calculation', () => {
  it('returns standard base features for individual plans', () => {
    const user = {
      subscription: {
        tier: 'ultra' as const,
        source: 'paid' as const,
        expiresAt: null,
      },
    };
    const features = getPlanFeaturesForUser(user);
    expect(features.dataFillMaxPoints).toBe(5_000_000);
    expect(features.sharedMaxDataPointsPerUser).toBe(150_000_000);
  });

  it('calculates data point limits multiplied by seats for team plans (public user)', () => {
    const user = {
      subscription: {
        tier: 'team-ultra' as const,
        source: 'paid' as const,
        expiresAt: null,
        seats: 5,
      },
    };
    expect(getPlanSeats(user)).toBe(5);
    const features = getPlanFeaturesForUser(user);
    // Base is 20,000,000 * 5 seats = 100,000,000
    expect(features.dataFillMaxPoints).toBe(100_000_000);
    // Base is 150,000,000 * 5 seats = 750,000,000
    expect(features.sharedMaxDataPointsPerUser).toBe(750_000_000);
  });

  it('calculates data point limits multiplied by seats for team plans (paid subscription)', () => {
    const user = {
      paidSubscriptions: [
        {
          id: 'sub-1',
          stripeSubscriptionId: 'sub_stripe_1',
          stripeCustomerId: 'cus_1',
          tier: 'team-ultra' as const,
          status: 'active' as const,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 86400000),
          cancelAtPeriodEnd: false,
          quantity: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      attachedSubscriptions: [],
    };
    expect(getPlanSeats(user)).toBe(3);
    const features = getPlanFeaturesForUser(user);
    expect(features.dataFillMaxPoints).toBe(60_000_000);
    expect(features.sharedMaxDataPointsPerUser).toBe(450_000_000);
  });

  it('calculates data point limits multiplied by seats for team member (attached subscription)', () => {
    const user = {
      paidSubscriptions: [],
      attachedSubscriptions: [
        {
          id: 'att-1',
          tier: 'team-ultra' as const,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          addedByUuid: 'manager-1',
          reason: 'team membership',
          seats: 4,
        },
      ],
    };
    expect(getPlanSeats(user)).toBe(4);
    const features = getPlanFeaturesForUser(user);
    expect(features.dataFillMaxPoints).toBe(80_000_000);
    expect(features.sharedMaxDataPointsPerUser).toBe(600_000_000);
  });

  it('respects seatsOverride if provided', () => {
    const user = {
      subscription: {
        tier: 'team-ultra' as const,
        source: 'paid' as const,
        expiresAt: null,
        seats: 2,
      },
    };
    const features = getPlanFeaturesForUser(user, 10);
    expect(features.dataFillMaxPoints).toBe(200_000_000);
    expect(features.sharedMaxDataPointsPerUser).toBe(1_500_000_000);
  });
});
