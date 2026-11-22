import { randomBytes, randomUUID } from 'node:crypto';
import type { Team, TeamInvite, TeamRole, User } from '@common';
import { getCollection, normalizeDateValues, trackMongoOperation, TEAM_INVITES_COLLECTION } from './db/internal';
import {
  addUserToTeam,
  getTeamById,
  setUserTeamMembership,
} from './db/teams';
import { getUserFromUuid } from './db/users';
import { syncTeamMemberSubscriptions } from './teamBillingSync';
import { logTeamAudit } from './teamAuditService';
import { notifyUser } from './notifications';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createTeamInvite(params: {
  team: Team;
  actor: User;
  email: string;
  role: TeamRole;
}): Promise<TeamInvite> {
  const { team, actor, email, role } = params;
  const now = new Date();
  const invite: TeamInvite = {
    id: randomUUID(),
    teamId: team.id,
    email: email.toLowerCase().trim(),
    role,
    token: randomBytes(32).toString('hex'),
    invitedByUuid: actor.uuid,
    invitedByUsername: actor.username,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  };

  const invites = await getCollection('teamInvites');
  trackMongoOperation('insertOne', TEAM_INVITES_COLLECTION);
  await invites.insertOne(normalizeDateValues(invite));
  return invite;
}

export async function getPendingInvitesForEmail(email: string): Promise<TeamInvite[]> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('find', TEAM_INVITES_COLLECTION);
  return invites
    .find({ email: email.toLowerCase().trim(), acceptedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function getTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('find', TEAM_INVITES_COLLECTION);
  return invites.find({ teamId, acceptedAt: { $exists: false } }).sort({ createdAt: -1 }).toArray();
}

export async function getTeamInviteByToken(token: string): Promise<TeamInvite | null> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('findOne', TEAM_INVITES_COLLECTION);
  return invites.findOne({ token });
}

export async function revokeTeamInvite(teamId: string, inviteId: string): Promise<boolean> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('deleteOne', TEAM_INVITES_COLLECTION);
  const result = await invites.deleteOne({ id: inviteId, teamId });
  return result.deletedCount > 0;
}

export async function acceptTeamInvite(params: { invite: TeamInvite; user: User }): Promise<void> {
  const { invite, user } = params;
  const team = await getTeamById(invite.teamId);
  if (!team) throw new Error('team not found');

  const manager = await getUserFromUuid(team.managerUuid);
  if (!manager) throw new Error('manager not found');

  await addUserToTeam(user.uuid, team.id, invite.role);
  if (!user.teamId) await setUserTeamMembership(user.uuid, team.id, invite.role);
  await syncTeamMemberSubscriptions(team);

  const invites = await getCollection('teamInvites');
  trackMongoOperation('updateOne', TEAM_INVITES_COLLECTION);
  await invites.updateOne({ id: invite.id }, { $set: { acceptedAt: new Date(), acceptedByUuid: user.uuid } });

  await logTeamAudit({
    teamId: team.id,
    actorUuid: user.uuid,
    actorUsername: user.username,
    action: 'invite.accepted',
    targetUuid: user.uuid,
    targetUsername: user.username,
    details: { email: invite.email, role: invite.role },
  });

  if (team.managerUuid !== user.uuid) {
    await notifyUser({
      userUuid: team.managerUuid,
      type: 'team',
      title: `${user.username} joined ${team.name ?? 'your team'}`,
      message: `${user.username} accepted your invitation and joined ${team.name ?? 'the team'}.`,
      link: '/dashboard/team',
    });
  }
}
