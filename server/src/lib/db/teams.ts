import { randomUUID } from 'node:crypto';
import { getCollection, trackMongoOperation, normalizeDateValues, invalidateUserCache } from './internal';
import { isDuplicateKeyError } from '../http';
import { invalidateAuthEntries } from '../authCache';
import type { Team, TeamAuditLog, TeamRole, User, AttachedSubscription, TeamInvite, TeamCredits, SubscriptionTier } from '@common';
import { getCreditPeriodStart } from '@common';
import { addAttachedSubscription, removeAttachedSubscription, getUserFromUuid, upsertPaidSubscription, removePaidSubscription } from './users';
import { getActivePaidSubscription } from '@common';
import { updateSubscriptionQuantity, cancelStripeSubscription } from '../stripe';
import { notifyUser } from '../notifications';

const TEAMS_COLLECTION = 'teams';
const TEAM_AUDIT_LOGS_COLLECTION = 'team_audit_logs';

export async function getTeamById(id: string): Promise<Team | null> {
  const teams = await getCollection('teams');
  trackMongoOperation('findOne', TEAMS_COLLECTION);
  const team = await teams.findOne({ id });
  if (!team) return null;
  if (team.name) return team;
  const manager = await getUserFromUuid(team.managerUuid);
  if (manager?.username) {
    const name = `${manager.username}'s Team`;
    trackMongoOperation('updateOne', TEAMS_COLLECTION);
    await teams.updateOne({ id }, { $set: { name, updatedAt: new Date() } });
    return { ...team, name };
  }
  return team;
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

export async function getTeamForUser(user: Pick<User, 'uuid' | 'teamId' | 'paidSubscriptions' | 'attachedSubscriptions'>): Promise<Team | null> {
  if (user.teamId) {
    return getTeamById(user.teamId);
  }

  // Every user belongs to a team. The team's subscription tier determines the
  // shared features and seat limit; fall back to 'free' when there is no paid
  // or attached subscription.
  const paid = getActivePaidSubscription(user as Pick<User, 'paidSubscriptions'>);
  if (paid) {
    return ensureTeamForManager(user.uuid, paid.tier);
  }

  const attached = (user.attachedSubscriptions ?? []).find((s) => s.expiresAt === null || new Date(s.expiresAt).getTime() > Date.now());
  if (attached) {
    return ensureTeamForManager(user.uuid, attached.tier);
  }

  return ensureTeamForManager(user.uuid, 'free');
}

export async function ensureTeamForManager(managerUuid: string, tier?: string): Promise<Team | null> {
  const existing = await getTeamByManagerUuid(managerUuid);
  if (existing) return existing;

  const user = await getUserFromUuid(managerUuid);
  if (!user) return null;

  const paid = getActivePaidSubscription(user);
  const resolvedTier = (tier ?? paid?.tier ?? 'free') as string;

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
  if (!user || !(user.teamIds ?? []).includes(teamId)) throw new Error('not a member of this team');
  // Determine role? keep existing if active same; default member
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne({ uuid: userUuid }, { $set: { teamId, teamRole: user.teamRole } });
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function getTeamsForUser(user: Pick<User, 'teamIds' | 'teamId'>): Promise<Team[]> {
  const ids = user.teamIds && user.teamIds.length > 0 ? user.teamIds : user.teamId ? [user.teamId] : [];
  if (ids.length === 0) return [];
  const teams = await getCollection('teams');
  trackMongoOperation('find', 'teams');
  const list = await teams.find({ id: { $in: ids } }).toArray();
  // Backfill membership arrays and default names for pre-update records.
  for (const team of list) {
    if (!team.name) {
      const manager = await getUserFromUuid(team.managerUuid);
      if (manager?.username) team.name = `${manager.username}'s Team`;
    }
  }
  return list;
}

export async function clearUserTeamMembership(userUuid: string): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne({ uuid: userUuid }, { $unset: { teamId: '', teamRole: '' } });
  await invalidateUserCache(userUuid);
  await invalidateAuthEntries();
}

export async function getTeamScopeUuid(user: Pick<User, 'uuid' | 'teamId' | 'paidSubscriptions' | 'attachedSubscriptions'>): Promise<string> {
  const team = await getTeamForUser(user as User);
  return team ? team.id : user.uuid;
}

export async function getTeamScopeUsername(user: Pick<User, 'uuid' | 'teamId' | 'paidSubscriptions' | 'attachedSubscriptions'>): Promise<string> {
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

export function isTeamManager(user: Pick<User, 'uuid' | 'teamId' | 'teamRole' | 'paidSubscriptions' | 'attachedSubscriptions'>, team: Team | null): boolean {
  if (!team) return false;
  if (team.managerUuid === user.uuid) return true;
  return user.teamRole === 'manager';
}

export function canManageTeam(user: Pick<User, 'uuid' | 'teamId' | 'teamRole' | 'paidSubscriptions' | 'attachedSubscriptions'>, team: Team | null): boolean {
  return isTeamManager(user, team);
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
}


export async function syncTeamSubscriptionQuantity(team: Team, manager: User): Promise<void> {
  const paid = getActivePaidSubscription(manager);
  if (!paid || paid.tier !== team.tier || !paid.stripeSubscriptionId) return;

  const members = await getTeamMembers(team.id);
  const quantity = Math.max(1, members.length);
  if (paid.quantity === quantity) return;

  try {
    const updated = await updateSubscriptionQuantity(paid.stripeSubscriptionId, quantity);
    if (updated) {
      paid.quantity = quantity;
      paid.updatedAt = new Date();
      await upsertPaidSubscription(manager.uuid, paid);
    }
  } catch {
    // best effort
  }
}


export async function cancelUserPaidSubscriptions(user: User): Promise<void> {
  for (const sub of user.paidSubscriptions ?? []) {
    if (sub.stripeSubscriptionId) {
      await cancelStripeSubscription(sub.stripeSubscriptionId);
    }
    await removePaidSubscription(user.uuid, sub.stripeSubscriptionId);
  }
}

export function getTeamRole(user: Pick<User, 'teamRole'>): TeamRole {
  return (user.teamRole as TeamRole) ?? 'member';
}

export async function addTeamMember(params: {
  team: Team;
  manager: User;
  target: User;
  role: TeamRole;
}): Promise<void> {
  const { team, manager, target, role } = params;

  // Cancel the new member's own paid subscriptions (no refund).
  await cancelUserPaidSubscriptions(target);

  if ((target.teamIds ?? (target.teamId ? [target.teamId] : [])).includes(team.id)) {
    throw new Error('user already belongs to this team');
  }
  if ((target.teamIds ?? (target.teamId ? [target.teamId] : [])).length >= 3) {
    throw new Error('user is already a member of 3 teams');
  }

  // Attach team subscription to target if not already on this team.
  const existingSub = (target.attachedSubscriptions ?? []).find((s) => s.reason === 'team membership' && s.tier === (team.tier as SubscriptionTier));
  let subscriptionId: string;
  if (existingSub) {
    subscriptionId = existingSub.id;
  } else {
    const seats = manager.paidSubscriptions?.find((s) => s.tier === (team.tier as SubscriptionTier))?.quantity ?? 1;
    const subscription: AttachedSubscription = {
      id: randomUUID(),
      tier: team.tier as SubscriptionTier,
      createdAt: new Date(),
      expiresAt: manager.paidSubscriptions?.find((s) => s.tier === (team.tier as SubscriptionTier))?.currentPeriodEnd ?? null,
      addedByUuid: manager.uuid,
      addedByUsername: manager.username,
      reason: 'team membership',
      seats,
    };
    await addAttachedSubscription(target.uuid, subscription);
    subscriptionId = subscription.id;
  }

  await addUserToTeam(target.uuid, team.id, role);

  await syncTeamSubscriptionQuantity(team, manager);

  await logTeamAudit({
    teamId: team.id,
    actorUuid: manager.uuid,
    actorUsername: manager.username,
    action: 'member.added',
    targetUuid: target.uuid,
    targetUsername: target.username,
    details: { role, subscriptionId },
  });
}

export async function removeTeamMember(params: {
  team: Team;
  actor: User;
  target: User;
}): Promise<void> {
  const { team, actor, target } = params;

  // Remove team attached subscriptions.
  const subs = target.attachedSubscriptions ?? [];
  for (const sub of subs) {
    if (sub.reason === 'team membership' && sub.tier === team.tier) {
      await removeAttachedSubscription(target.uuid, sub.id);
    }
  }

  await clearUserTeamMembership(target.uuid);

  const managerUser = await getUserFromUuid(team.managerUuid);
  if (managerUser) await syncTeamSubscriptionQuantity(team, managerUser);

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

export async function logTeamAudit(entry: Omit<TeamAuditLog, 'id' | 'createdAt'>): Promise<TeamAuditLog> {
  const log: TeamAuditLog = {
    id: randomUUID(),
    createdAt: new Date(),
    ...entry,
  };
  const logs = await getCollection('teamAuditLogs');
  trackMongoOperation('insertOne', TEAM_AUDIT_LOGS_COLLECTION);
  await logs.insertOne(normalizeDateValues(log));
  return log;
}

export async function getTeamAuditLogs(teamId: string, limit = 100): Promise<TeamAuditLog[]> {
  const logs = await getCollection('teamAuditLogs');
  trackMongoOperation('find', TEAM_AUDIT_LOGS_COLLECTION);
  return logs.find({ teamId }).sort({ createdAt: -1 }).limit(limit).toArray();
}


const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createTeamInvite(params: {
  team: Team;
  actor: User;
  email: string;
  role: TeamRole;
}): Promise<TeamInvite> {
  const { team, actor, email, role } = params;
  const now = new Date();
  const token = (await import('node:crypto')).randomBytes(32).toString('hex');
  const invite: TeamInvite = {
    id: randomUUID(),
    teamId: team.id,
    email: email.toLowerCase().trim(),
    role,
    token,
    invitedByUuid: actor.uuid,
    invitedByUsername: actor.username,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
  };

  const invites = await getCollection('teamInvites');
  trackMongoOperation('insertOne', 'team_invites');
  await invites.insertOne(normalizeDateValues(invite));
  return invite;
}


export async function getPendingInvitesForEmail(email: string): Promise<TeamInvite[]> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('find', 'team_invites');
  return invites
    .find({ email: email.toLowerCase().trim(), acceptedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function getTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('find', 'team_invites');
  return invites.find({ teamId, acceptedAt: { $exists: false } }).sort({ createdAt: -1 }).toArray();
}

export async function getTeamInviteByToken(token: string): Promise<TeamInvite | null> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('findOne', 'team_invites');
  return invites.findOne({ token });
}

export async function revokeTeamInvite(teamId: string, inviteId: string): Promise<boolean> {
  const invites = await getCollection('teamInvites');
  trackMongoOperation('deleteOne', 'team_invites');
  const result = await invites.deleteOne({ id: inviteId, teamId });
  return result.deletedCount > 0;
}



export async function acceptTeamInvite(params: {
  invite: TeamInvite;
  user: User;
}): Promise<void> {
  const { invite, user } = params;
  const team = await getTeamById(invite.teamId);
  if (!team) throw new Error('team not found');

  const manager = await getUserFromUuid(team.managerUuid);
  if (!manager) throw new Error('manager not found');

  // Cancel the joining user's own paid subscriptions (no refund).
  await cancelUserPaidSubscriptions(user);

  // Attach subscription + membership.
  const existingSub = (user.attachedSubscriptions ?? []).find((s) => s.reason === 'team membership' && s.tier === (team.tier as SubscriptionTier));
  if (!existingSub) {
    const seats = manager.paidSubscriptions?.find((s) => s.tier === (team.tier as SubscriptionTier))?.quantity ?? 1;
    const subscription: AttachedSubscription = {
      id: randomUUID(),
      tier: team.tier as SubscriptionTier,
      createdAt: new Date(),
      expiresAt: manager.paidSubscriptions?.find((s) => s.tier === (team.tier as SubscriptionTier))?.currentPeriodEnd ?? null,
      addedByUuid: manager.uuid,
      addedByUsername: manager.username,
      reason: 'team membership',
      seats,
    };
    await addAttachedSubscription(user.uuid, subscription);
  }

  await addUserToTeam(user.uuid, team.id, invite.role);
  if (!user.teamId) await setUserTeamMembership(user.uuid, team.id, invite.role);

  const invites = await getCollection('teamInvites');
  trackMongoOperation('updateOne', 'team_invites');
  await invites.updateOne({ id: invite.id }, { $set: { acceptedAt: new Date(), acceptedByUuid: user.uuid } });

  await syncTeamSubscriptionQuantity(team, manager);

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
      link: '/dashboard?tab=team',
    });
  }
}

export async function getTeamSeatLimit(team: Team, manager: User): Promise<number> {
  const paid = getActivePaidSubscription(manager);
  if (paid?.tier === team.tier) {
    const seats = paid.quantity ?? 1;
    const planMax = (await import('@common')).PLAN_FEATURES[team.tier]?.maxUsers ?? seats;
    return Math.min(seats, planMax);
  }
  // Attached/granted team plans: no seat billing, use plan max.
  return (await import('@common')).PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
}

/**
 * Seat count used for shared, per-seat limits (credits, data points, ...).
 * Paid teams use billed seats; granted teams use the actual member count.
 */
export async function getTeamSharedSeats(team: Team, manager: User): Promise<number> {
  const paid = getActivePaidSubscription(manager);
  if (paid?.tier === (team.tier as SubscriptionTier)) {
    return Math.max(1, paid.quantity ?? 1);
  }
  const members = await getTeamMembers(team.id);
  return Math.max(1, members.length);
}
