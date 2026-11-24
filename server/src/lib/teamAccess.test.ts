import { describe, expect, test } from 'bun:test';
import { canManageTeamRole, getTeamMemberRole, toTeamMember, toTeamMembers } from './teamAccess';
import type { Team, User } from '@common';

const team: Team = {
  id: 'team-1',
  managerUuid: 'manager-1',
  tier: 'free',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function user(overrides: Partial<User>): User {
  return {
    uuid: 'user-1',
    username: 'user',
    role: 'user',
    auth: {},
    createdAt: new Date('2026-01-02T00:00:00Z'),
    lastActive: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('team access projections', () => {
  test('derives authorization from teamRoles and falls back to manager identity', () => {
    expect(getTeamMemberRole(user({ uuid: 'manager-1' }), team)).toBe('manager');
    expect(getTeamMemberRole(user({ teamRoles: { 'team-1': 'helper' } }), team)).toBe('helper');
    expect(getTeamMemberRole(user({ teamRoles: { 'team-1': 'manager' }, teamRole: 'member' }), team)).toBe('manager');
  });

  test('never trusts the global teamRole for team authorization', () => {
    const globalManager = user({ teamRole: 'manager' });
    expect(getTeamMemberRole(globalManager, team)).toBe('member');
    expect(canManageTeamRole(globalManager, team)).toBe(false);

    const helper = user({ teamRole: 'manager', teamRoles: { 'team-1': 'helper' } });
    expect(getTeamMemberRole(helper, team)).toBe('helper');
    expect(canManageTeamRole(helper, team)).toBe(false);
  });

  test('maps members into the public team shape', () => {
    const members = toTeamMembers([user({ uuid: 'manager-1' }), user({ uuid: 'user-2', username: 'second' })], team);
    expect(members).toEqual([
      {
        uuid: 'manager-1',
        username: 'user',
        role: 'manager',
        joinedAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        uuid: 'user-2',
        username: 'second',
        role: 'member',
        joinedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);
    expect(toTeamMember(user({ teamRoles: { 'team-1': 'helper' } }), team).role).toBe('helper');
  });
});
