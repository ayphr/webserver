import { describe, expect, it } from 'bun:test';
import type { Team } from '@common';
import { teamSupportsAlertsAndWebhooks } from './planAccess';

function teamWithTier(tier: Team['tier']): Team {
  return {
    id: `team-${tier}`,
    managerUuid: 'manager-1',
    tier,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('teamSupportsAlertsAndWebhooks', () => {
  it('allows Plus, Ultra and every team plan', () => {
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('plus'))).toBe(true);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('ultra'))).toBe(true);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('team-lite'))).toBe(true);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('team-plus'))).toBe(true);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('team-ultra'))).toBe(true);
  });

  it('denies free, Lite and users without a team', () => {
    expect(teamSupportsAlertsAndWebhooks(null)).toBe(false);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('free'))).toBe(false);
    expect(teamSupportsAlertsAndWebhooks(teamWithTier('lite'))).toBe(false);
  });
});
