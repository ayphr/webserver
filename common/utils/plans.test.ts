import { describe, expect, it } from 'bun:test';
import { PLAN_FEATURES } from '../types/plans';
import { getPlanFeaturesForUser, getPlanSeats } from './plans';

describe('getPlanFeaturesForUser and team seats calculation', () => {
  it('returns standard base features for individual plans', () => {
    const user = {
      subscription: {
        tier: 'ultra' as const,
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

  it('respects seatsOverride if provided', () => {
    const user = {
      subscription: {
        tier: 'team-ultra' as const,
        expiresAt: null,
        seats: 2,
      },
    };
    const features = getPlanFeaturesForUser(user, 10);
    expect(features.dataFillMaxPoints).toBe(200_000_000);
    expect(features.sharedMaxDataPointsPerUser).toBe(1_500_000_000);
  });
});

describe('alerts and webhooks plan access', () => {
  it('is disabled on free and lite', () => {
    expect(PLAN_FEATURES.free.alertsAndWebhooks).toBe(false);
    expect(PLAN_FEATURES.lite.alertsAndWebhooks).toBe(false);
  });

  it('is enabled on plus and above', () => {
    expect(PLAN_FEATURES.plus.alertsAndWebhooks).toBe(true);
    expect(PLAN_FEATURES.ultra.alertsAndWebhooks).toBe(true);
  });

  it('is enabled on every team plan', () => {
    expect(PLAN_FEATURES['team-lite'].alertsAndWebhooks).toBe(true);
    expect(PLAN_FEATURES['team-plus'].alertsAndWebhooks).toBe(true);
    expect(PLAN_FEATURES['team-ultra'].alertsAndWebhooks).toBe(true);
  });
});
