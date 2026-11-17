import type { Team, TeamMember, TeamRole, User } from '@common';

export function getTeamMemberRole(user: Pick<User, 'uuid' | 'teamId' | 'teamRole' | 'teamRoles'>, team: Team): TeamRole {
  const configuredRole = user.teamRoles?.[team.id] ?? user.teamRole;
  if (configuredRole === 'member' || configuredRole === 'helper' || configuredRole === 'manager') {
    return configuredRole;
  }
  return user.uuid === team.managerUuid ? 'manager' : 'member';
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
