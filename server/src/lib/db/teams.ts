import { randomUUID } from 'node:crypto';
import { getCollection, trackMongoOperation, normalizeDateValues, invalidateUserCache } from './internal';
import { isDuplicateKeyError } from '../http';
import { invalidateAuthEntries } from '../authCache';
import type { Team, TeamRole, User, TeamCredits } from '@common';
import { getCreditPeriodStart } from '@common';
import { getUserFromUuid } from './users';
import { notifyUser } from '../notifications';
import { logTeamAudit } from '../teamAuditService';
import { getSharedSeatCount, getTeamSeatLimit as getPolicySeatLimit } from '../teamBillingPolicy';
import {
  syncTeamMemberSubscriptions,
} from '../teamBillingSync';

export { getTeamAuditLogs, logTeamAudit } from '../teamAuditService';
export {
  acceptTeamInvite,
  createTeamInvite,
  getPendingInvitesForEmail,
  getTeamInviteByToken,
  getTeamInvites,
  revokeTeamInvite,
} from '../teamInviteService';
export {
  clearTeamStripeSubscription,
  enforceTeamMemberLimit,
  syncTeamMemberSubscriptions,
  syncTeamStripeSubscription,
} from '../teamBillingSync';

const TEAMS_COLLECTION = 'teams';

export async function getTeamById(id: string): Promise<Team | null> {
  const teams = await getCollection('teams');
  trackMongoOperation('findOne', TEAMS_COLLECTION);
  return teams.findOne({ id });
}

export async function updateTeamCredits(teamId: string, credits: TeamCredits): Promise<void> {
  const teams = await getCollection('teams');
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne({ id: teamId }, { $set: { credits: normalizeDateValues(credits), updatedAt: new Date() } });
}

export async function getTeamByManagerUuid(managerUuid: string): Promise<Team | null> {
  const teams = await getCollection('teams');
  trackMongoOperation('findOne', TEAMS_COLLECTION);
  return teams.findOne({ managerUuid });
}

export async function getTeamForUser(user: Pick<User, 'uuid' | 'teamId'>): Promise<Team | null> {
  if (user.teamId) {
    return getTeamById(user.teamId);
  }

  // Legacy users without a team get a free personal team.
  return ensureTeamForManager(user.uuid, 'free');
}

export async function ensureTeamForManager(managerUuid: string, tier?: string): Promise<Team | null> {
  const existing = await getTeamByManagerUuid(managerUuid);
  if (existing) return existing;

  const user = await getUserFromUuid(managerUuid);
  if (!user) return null;

  const resolvedTier = (tier ?? 'free') as string;

  const now = new Date();
  const team: Team = {
    id: randomUUID(),
    name: `${user.username}'s Team`,
    managerUuid,
    tier: resolvedTier as Team['tier'],
    credits: {
      periodStart: getCreditPeriodStart(now),
      monthlyUsed: 0,
      additional: 0,
      onHold: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  const teams = await getCollection('teams');
  trackMongoOperation('insertOne', TEAMS_COLLECTION);
  try {
    await teams.insertOne(normalizeDateValues(team));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existingAfterRace = await getTeamByManagerUuid(managerUuid);
      if (existingAfterRace) return existingAfterRace;
    }
    throw error;
  }

  // Mark manager as team member/manager.
  await setUserTeamMembership(managerUuid, team.id, 'manager');

  return team;
}

export async function createTeamForUser(managerUuid: string, name?: string): Promise<Team | null> {
  const user = await getUserFromUuid(managerUuid);
  if (!user) return null;

  const current = user.teamIds ?? (user.teamId ? [user.teamId] : []);
  if (current.length >= 3) return null;

  const now = new Date();
  const team: Team = {
    id: randomUUID(),
    name: name?.trim() || `${user.username}'s Team`,
    managerUuid,
    tier: 'free',
    credits: {
      periodStart: getCreditPeriodStart(now),
      monthlyUsed: 0,
      additional: 0,
      onHold: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  const teams = await getCollection('teams');
  trackMongoOperation('insertOne', TEAMS_COLLECTION);
  await teams.insertOne(normalizeDateValues(team));

  await setUserTeamMembership(managerUuid, team.id, 'manager');

  return team;
}

export async function setUserTeamMembership(userUuid: string, teamId: string, role: TeamRole): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne(
    { uuid: userUuid },
    {
      $set: { teamId, teamRole: role, [`teamRoles.${teamId}`]: role },
      $addToSet: { teamIds: teamId },
    },
  );
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function addUserToTeam(userUuid: string, teamId: string, role: TeamRole): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne(
    { uuid: userUuid },
    {
      $addToSet: { teamIds: teamId },
      $set: { [`teamRoles.${teamId}`]: role },
    },
  );
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function removeUserTeamMembership(userUuid: string, teamId: string): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne({ uuid: userUuid }, { $pull: { teamIds: teamId } });
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function setActiveTeam(userUuid: string, teamId: string): Promise<void> {
  const user = await getUserFromUuid(userUuid);
  const ids = user?.teamIds ?? (user?.teamId ? [user.teamId] : []);
  if (!user || !ids.includes(teamId)) throw new Error('not a member of this team');

  const team = await getTeamById(teamId);
  const role: TeamRole = user.teamRoles?.[teamId]
    ?? (team?.managerUuid === userUuid ? 'manager' : 'member');

  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne(
    { uuid: userUuid },
    {
      $set: { teamId, teamRole: role, [`teamRoles.${teamId}`]: role },
      $addToSet: { teamIds: teamId },
    },
  );
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function getTeamsForUser(user: Pick<User, 'teamIds' | 'teamId'>): Promise<Team[]> {
  const ids = user.teamIds && user.teamIds.length > 0 ? user.teamIds : user.teamId ? [user.teamId] : [];
  if (ids.length === 0) return [];
  const teams = await getCollection('teams');
  trackMongoOperation('find', 'teams');
  return teams.find({ id: { $in: ids } }).toArray();
}

export async function clearUserTeamMembership(userUuid: string, teamId?: string): Promise<void> {
  const users = await getCollection('users');
  const user = await getUserFromUuid(userUuid);
  trackMongoOperation('updateOne', 'users');

  const update: Record<string, unknown> = {};

  if (teamId) {
    update.$pull = { teamIds: teamId };
    update.$unset = { [`teamRoles.${teamId}`]: '' };
    if (user?.teamId === teamId) {
      const remaining = (user.teamIds ?? []).filter((id) => id !== teamId);
      const nextTeamId = remaining[0] ?? null;
      update.$set = {
        teamId: nextTeamId,
        teamRole: nextTeamId ? user.teamRoles?.[nextTeamId] ?? 'member' : null,
      };
    }
  } else {
    update.$unset = { teamId: '', teamRole: '' };
  }

  await users.updateOne({ uuid: userUuid }, update);
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function getTeamScopeUuid(user: Pick<User, 'uuid' | 'teamId'>): Promise<string> {
  const team = await getTeamForUser(user as User);
  return team ? team.id : user.uuid;
}

export async function getTeamScopeUsername(user: Pick<User, 'uuid' | 'teamId'>): Promise<string> {
  const team = await getTeamForUser(user as User);
  if (!team) return (user as User).username;
  const manager = await getUserFromUuid(team.managerUuid);
  return manager?.username ?? (user as User).username;
}

export async function getTeamMembers(teamId: string): Promise<User[]> {
  const users = await getCollection('users');
  trackMongoOperation('find', 'users');
  return users.find({ $or: [{ teamId: teamId }, { teamIds: teamId }] }).toArray();
}

export function isTeamManager(user: Pick<User, 'uuid' | 'teamId' | 'teamRole'>, team: Team | null): boolean {
  if (!team) return false;
  if (team.managerUuid === user.uuid) return true;
  return user.teamRole === 'manager';
}

export function canManageTeam(user: Pick<User, 'uuid' | 'teamId' | 'teamRole'>, team: Team | null): boolean {
  return isTeamManager(user, team);
}

export async function getTeamByStripeCustomerId(customerId: string): Promise<Team | null> {
  const teams = await getCollection('teams');
  trackMongoOperation('findOne', TEAMS_COLLECTION);
  return teams.findOne({ stripeCustomerId: customerId });
}

export async function setTeamStripeCustomerId(teamId: string, customerId: string): Promise<void> {
  const teams = await getCollection('teams');
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne({ id: teamId }, { $set: { stripeCustomerId: customerId, updatedAt: new Date() } });
}

export async function updateTeamName(team: Team, actor: User, name: string): Promise<Team> {
  const teams = await getCollection('teams');
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  const now = new Date();
  await teams.updateOne({ id: team.id }, { $set: { name, updatedAt: now } });
  await logTeamAudit({
    teamId: team.id,
    actorUuid: actor.uuid,
    actorUsername: actor.username,
    action: 'team.renamed',
    details: { name },
  });
  const updated = await getTeamById(team.id);
  return updated ?? { ...team, name, updatedAt: now };
}export function getTeamRole(user: Pick<User, 'teamRole'>): TeamRole {
  return (user.teamRole as TeamRole) ?? 'member';
}

export async function addTeamMember(params: {
  team: Team;
  manager: User;
  target: User;
  role: TeamRole;
}): Promise<void> {
  const { team, manager, target, role } = params;

  if ((target.teamIds ?? (target.teamId ? [target.teamId] : [])).includes(team.id)) {
    throw new Error('user already belongs to this team');
  }
  if ((target.teamIds ?? (target.teamId ? [target.teamId] : [])).length >= 3) {
    throw new Error('user is already a member of 3 teams');
  }

  await addUserToTeam(target.uuid, team.id, role);
  await syncTeamMemberSubscriptions(team);

  await logTeamAudit({
    teamId: team.id,
    actorUuid: manager.uuid,
    actorUsername: manager.username,
    action: 'member.added',
    targetUuid: target.uuid,
    targetUsername: target.username,
    details: { role },
  });
}

export async function removeTeamMember(params: {
  team: Team;
  actor: User;
  target: User;
}): Promise<void> {
  const { team, actor, target } = params;

  await clearUserTeamMembership(target.uuid, team.id);
  await syncTeamMemberSubscriptions(team);

  await logTeamAudit({
    teamId: team.id,
    actorUuid: actor.uuid,
    actorUsername: actor.username,
    action: 'member.removed',
    targetUuid: target.uuid,
    targetUsername: target.username,
  });

  await notifyUser({
    userUuid: target.uuid,
    type: 'team',
    title: 'You were removed from a team',
    message: `${actor.username} removed you from ${team.name ?? 'the team'}.`,
    link: '/dashboard?tab=overview',
  });
}

export async function updateTeamMemberRole(params: {
  team: Team;
  actor: User;
  target: User;
  role: TeamRole;
}): Promise<void> {
  const { team, actor, target, role } = params;
  const users = await getCollection('users');
  await users.updateOne({ uuid: target.uuid }, { $set: { [`teamRoles.${team.id}`]: role } });
  if (target.teamId === team.id) await setUserTeamMembership(target.uuid, team.id, role);

  await logTeamAudit({
    teamId: team.id,
    actorUuid: actor.uuid,
    actorUsername: actor.username,
    action: 'member.role_changed',
    targetUuid: target.uuid,
    targetUsername: target.username,
    details: { role },
  });

  await notifyUser({
    userUuid: target.uuid,
    type: 'team',
    title: 'Your team role was updated',
    message: `${actor.username} changed your team role to ${role} in ${team.name ?? 'the team'}.`,
    link: '/dashboard?tab=team',
  });
}

export async function getTeamSeatLimit(team: Team, _manager: User): Promise<number> {
  const members = await getTeamMembers(team.id);
  return getPolicySeatLimit(team, members.length);
}

/**
 * Seat count used for shared, per-seat limits (credits, data points, ...).
 * Paid teams use billed seats; other teams use the actual member count.
 */
export async function getTeamSharedSeats(team: Team, _manager: User): Promise<number> {
  const members = await getTeamMembers(team.id);
  return getSharedSeatCount(team, members.length);
}
