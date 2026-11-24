import type { Team, TeamMember, TeamRole, User } from '@common';

/**
 * Team authorization is derived exclusively from the team-scoped role map.
 * The legacy global `teamRole` is only a display hint for the active team and
 * must never grant access to a different team.
 */
export function getTeamMemberRole(
  user: Pick<User, 'uuid' | 'teamRoles'>,
  team: Team,
): TeamRole {
  const configuredRole = user.teamRoles?.[team.id];
  if (configuredRole === 'member' || configuredRole === 'helper' || configuredRole === 'manager') {
    return configuredRole;
  }
  return user.uuid === team.managerUuid ? 'manager' : 'member';
}

/** True only when the team-scoped role (or manager identity) grants management. */
export function canManageTeamRole(
  user: Pick<User, 'uuid' | 'teamRoles'>,
  team: Team,
): boolean {
  return getTeamMemberRole(user, team) === 'manager';
}

export function toTeamMember(user: User, team: Team): TeamMember {
  return {
    uuid: user.uuid,
    username: user.username,
    role: getTeamMemberRole(user, team),
    joinedAt: user.createdAt,
  };
}

export function toTeamMembers(users: User[], team: Team): TeamMember[] {
  return users.map((user) => toTeamMember(user, team));
}
