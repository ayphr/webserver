import type { Team, TeamRole, User } from '@common';
import {
  getTeamForUser,
} from './db/teams';
import { getUserFromUuid } from './db/users';
import { getTeamMemberRole } from './teamAccess';

export type TeamContext = {
  team: Team | null;
  scopeUuid: string;
  scopeUsername: string;
  role: TeamRole;
};

export async function getTeamContext(user: User): Promise<TeamContext> {
  const team = await getTeamForUser(user);
  const scopeUuid = team?.id ?? user.uuid;
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const scopeUsername = manager?.username ?? user.username;
  const role = team ? getTeamMemberRole(user, team) : 'member';

  return { team, scopeUuid, scopeUsername, role };
}
