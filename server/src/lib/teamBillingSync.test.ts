import { describe, expect, test } from 'bun:test';
import type { Team, User } from '@common';
import {
  DOWNGRADE_REMOVAL_POLICY,
  enforceTeamMemberLimit,
  type MemberLimitRemovalDeps,
} from './teamBillingSync';

function member(uuid: string, createdAt: string): User {
  return { uuid, username: uuid, createdAt: new Date(createdAt) } as User;
}

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Example Team',
    managerUuid: 'manager',
    tier: 'free',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Team;
}

function setup(members: User[]) {
  const removed: string[] = [];
  const audits: Array<{ action: string; targetUuid?: string; details?: Record<string, unknown> }> = [];
  const notified: string[] = [];
  const deps: MemberLimitRemovalDeps = {
    getMembers: async () => members,
    removeMembership: async (uuid: string) => { removed.push(uuid); },
    logAudit: async (entry) => {
      audits.push(entry);
      return entry as never;
    },
    notify: async (input) => { notified.push(input.userUuid); },
  };
  return { deps, removed, audits, notified };
}

describe('plan downgrade member removal', () => {
  test('removes the newest non-manager and never the manager', async () => {
    const { deps, removed, audits, notified } = setup([
      member('older', '2026-01-02T00:00:00Z'),
      member('manager', '2026-01-03T00:00:00Z'),
      member('newest', '2026-01-04T00:00:00Z'),
    ]);

    await enforceTeamMemberLimit(team(), { reason: 'team downgraded to free', deps });

    // Free allows one member, so every non-manager must be removed.
    expect(removed).toEqual(['newest', 'older']);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      teamId: 'team-1',
      action: 'team.member_removed_plan_limit',
      targetUuid: 'newest',
    });
    expect(audits[0]?.details).toMatchObject({
      reason: 'team downgraded to free',
      policy: DOWNGRADE_REMOVAL_POLICY,
    });
    expect(notified).toEqual(['newest', 'older']);
  });

  test('does nothing when the team already fits the plan', async () => {
    const { deps, removed, audits } = setup([member('manager', '2026-01-04T00:00:00Z')]);
    await enforceTeamMemberLimit(team(), { deps });
    expect(removed).toEqual([]);
    expect(audits).toEqual([]);
  });

  test('still frees the seat when auditing fails', async () => {
    const { deps, removed } = setup([
      member('manager', '2026-01-02T00:00:00Z'),
      member('newest', '2026-01-04T00:00:00Z'),
    ]);
    deps.logAudit = async () => { throw new Error('audit unavailable'); };

    await enforceTeamMemberLimit(team(), { deps });
    expect(removed).toEqual(['newest']);
  });
});
