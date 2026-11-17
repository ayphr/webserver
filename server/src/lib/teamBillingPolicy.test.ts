import { describe, expect, test } from 'bun:test';
import type { Team } from '@common';
import { getSharedSeatCount, getTeamSeatLimit } from './teamBillingPolicy';

const team = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Team',
  managerUuid: 'user-1',
  tier: 'free',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('team billing policy', () => {
  test('uses plan limits for free teams and billed seats for paid teams', () => {
    expect(getTeamSeatLimit(team(), 4)).toBe(1);
    expect(getSharedSeatCount(team(), 4)).toBe(4);
    expect(getSharedSeatCount(team({ seats: 3, stripeSubscriptionId: 'sub-1', tier: 'team-lite' }), 8)).toBe(3);
  });
});
