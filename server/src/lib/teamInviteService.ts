import { randomBytes, randomUUID } from 'node:crypto';
import type { Team, TeamInvite, TeamRole, User } from '@common';
import { getCollection, normalizeDateValues, trackMongoOperation, TEAM_INVITES_COLLECTION, TEAMS_COLLECTION } from './db/internal';
import {
  addUserToTeam,
  getTeamById,
  getTeamMembers,
  getTeamSeatLimit,
  setUserTeamMembership,
} from './db/teams';
import { getUserFromUuid } from './db/users';
import { syncTeamMemberSubscriptions } from './teamBillingSync';
import { logTeamAudit } from './teamAuditService';
import { notifyUser } from './notifications';
import { createLogger } from './logger';

const log = createLogger('team-invites');
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteClaimErrorCode =
  | 'invalid'
  | 'already_used'
  | 'expired'
  | 'email_mismatch'
  | 'team_limit'
  | 'seat_limit'
  | 'team_not_found';

export class InviteAcceptanceError extends Error {
  constructor(readonly code: InviteClaimErrorCode) {
    super(code);
    this.name = 'InviteAcceptanceError';
  }
}

export type InviteCollection = {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<TeamInvite | null>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
};

export type TeamSeatReservationCollection = {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<unknown>;
};

export type InviteServiceDeps = {
  invites: () => Promise<InviteCollection>;
  teams: () => Promise<TeamSeatReservationCollection>;
  getTeamById: typeof getTeamById;
  getUserFromUuid: typeof getUserFromUuid;
  getMembers: typeof getTeamMembers;
  getTeamSeatLimit: typeof getTeamSeatLimit;
  addUserToTeam: typeof addUserToTeam;
  setUserTeamMembership: typeof setUserTeamMembership;
  syncSubscriptions: typeof syncTeamMemberSubscriptions;
  logAudit: typeof logTeamAudit;
  notify: typeof notifyUser;
};

const defaultDeps: InviteServiceDeps = {
  invites: async () => await getCollection('teamInvites') as unknown as InviteCollection,
  teams: async () => await getCollection('teams') as unknown as TeamSeatReservationCollection,
  getTeamById,
  getUserFromUuid,
  getMembers: getTeamMembers,
  getTeamSeatLimit,
  addUserToTeam,
  setUserTeamMembership,
  syncSubscriptions: syncTeamMemberSubscriptions,
  logAudit: logTeamAudit,
  notify: notifyUser,
};

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

/** Claim filter shared with tests: email/expiry are rechecked atomically. */
export function buildInviteClaimFilter(invite: TeamInvite, userEmail: string, now: Date) {
  return {
    id: invite.id,
    token: invite.token,
    teamId: invite.teamId,
    email: userEmail.toLowerCase().trim(),
    acceptedAt: { $exists: false },
    expiresAt: { $gt: now },
  };
}

export async function claimTeamInvite(
  invite: TeamInvite,
  user: User,
  deps: InviteServiceDeps = defaultDeps,
  now = new Date(),
): Promise<TeamInvite | null> {
  const normalizedEmail = (user.email ?? '').toLowerCase().trim();
  if (invite.email !== normalizedEmail) throw new InviteAcceptanceError('email_mismatch');
  if (invite.expiresAt.getTime() <= now.getTime()) throw new InviteAcceptanceError('expired');
  if (invite.acceptedAt) throw new InviteAcceptanceError('already_used');

  const invites = await deps.invites();
  trackMongoOperation('findOneAndUpdate', TEAM_INVITES_COLLECTION);
  return invites.findOneAndUpdate(
    buildInviteClaimFilter(invite, normalizedEmail, now),
    { $set: { acceptedAt: now, acceptedByUuid: user.uuid } },
    { returnDocument: 'after' },
  );
}

async function releaseInviteClaim(invite: TeamInvite, user: User, deps: InviteServiceDeps): Promise<void> {
  const invites = await deps.invites();
  trackMongoOperation('updateOne', TEAM_INVITES_COLLECTION);
  await invites.updateOne(
    { id: invite.id, token: invite.token, acceptedByUuid: user.uuid },
    { $unset: { acceptedAt: '', acceptedByUuid: '' } },
  );
}

/**
 * Reserves one of the seats still free after current members and other
 * in-flight claims are accounted for. `$expr` treats a missing counter as zero,
 * so the first claimant can still reserve a seat on teams that never had one.
 * The counter is released on every success/error path; if a process dies
 * mid-accept, clear `pendingSeatClaims` on that team document to recover.
 */
async function reserveTeamSeat(team: Team, availableSeats: number, deps: InviteServiceDeps): Promise<void> {
  const teams = await deps.teams();
  trackMongoOperation('findOneAndUpdate', TEAMS_COLLECTION);
  const reserved = await teams.findOneAndUpdate(
    {
      id: team.id,
      $expr: { $lt: [{ $ifNull: ['$pendingSeatClaims', 0] }, availableSeats] },
    },
    { $inc: { pendingSeatClaims: 1 } },
    { returnDocument: 'after' },
  );
  if (!reserved) throw new InviteAcceptanceError('seat_limit');
}

async function releaseTeamSeat(team: Team, deps: InviteServiceDeps): Promise<void> {
  const teams = await deps.teams();
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne(
    { id: team.id, pendingSeatClaims: { $gt: 0 } },
    { $inc: { pendingSeatClaims: -1 } },
  );
}

export async function acceptTeamInvite(params: {
  invite: TeamInvite;
  user: User;
  deps?: InviteServiceDeps;
}): Promise<void> {
  const { invite, user } = params;
  const deps = params.deps ?? defaultDeps;
  const reservedTeam = teamFromInvite(invite);

  // Claim first: concurrent acceptances of the same invite cannot both reach
  // membership creation. The filter rechecks email and expiry on the server.
  const claimed = await claimTeamInvite(invite, user, deps);
  if (!claimed) throw new InviteAcceptanceError('already_used');

  let seatReserved = false;
  let acceptedTeam: Team;
  try {
    const team = await deps.getTeamById(invite.teamId);
    if (!team) throw new InviteAcceptanceError('team_not_found');
    acceptedTeam = team;
    const manager = await deps.getUserFromUuid(team.managerUuid);
    if (!manager) throw new InviteAcceptanceError('team_not_found');

    const currentTeams = user.teamIds ?? (user.teamId ? [user.teamId] : []);
    if (currentTeams.length >= 3 && !currentTeams.includes(team.id)) {
      throw new InviteAcceptanceError('team_limit');
    }

    // Re-check the plan limit after the invite claim. Two different invites
    // see the same reservation counter, so neither can oversubscribe the team.
    const members = await deps.getMembers(team.id);
    if (!members.some((member) => member.uuid === user.uuid)) {
      const seatLimit = await deps.getTeamSeatLimit(team, manager);
      await reserveTeamSeat(team, Math.max(0, seatLimit - members.length), deps);
      seatReserved = true;
    }

    await deps.addUserToTeam(user.uuid, team.id, invite.role);
    if (!user.teamId) await deps.setUserTeamMembership(user.uuid, team.id, invite.role);
    await deps.syncSubscriptions(team);
  } catch (error) {
    if (seatReserved) await releaseTeamSeat(reservedTeam, deps);
    await releaseInviteClaim(invite, user, deps);
    throw error;
  }

  if (seatReserved) {
    // The member is counted by getTeamMembers now, so the temporary
    // reservation is no longer needed on the success path either.
    await releaseTeamSeat(reservedTeam, deps);
  }

  // Audit/notification failures must not roll back an accepted invitation.
  try {
    await deps.logAudit({
      teamId: invite.teamId,
      actorUuid: user.uuid,
      actorUsername: user.username,
      action: 'invite.accepted',
      targetUuid: user.uuid,
      targetUsername: user.username,
      details: { email: invite.email, role: invite.role },
    });

    if (acceptedTeam.managerUuid !== user.uuid) {
      await deps.notify({
        userUuid: acceptedTeam.managerUuid,
        type: 'team',
        title: `${user.username} joined ${acceptedTeam.name ?? 'your team'}`,
        message: `${user.username} accepted your invitation and joined ${acceptedTeam.name ?? 'the team'}.`,
        link: '/dashboard/team',
      });
    }
  } catch (error) {
    log.warn({ error, teamId: invite.teamId }, 'failed to record invite acceptance side effects');
  }
}

function teamFromInvite(invite: TeamInvite): Team {
  return { id: invite.teamId } as Team;
}
