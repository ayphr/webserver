import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { getCollection, trackMongoOperation, normalizeDateValues, invalidateUserCache } from './internal';
import { isDuplicateKeyError } from '../http';
import { invalidateAuthEntries } from '../authCache';
import type { Team, TeamAuditLog, TeamRole, User, TeamInvite, TeamCredits, SubscriptionTier, BillingInterval, PaidSubscriptionStatus } from '@common';
import { getCreditPeriodStart, PLAN_FEATURES } from '@common';
import { resolveTierFromStripeSubscription } from '../stripe';
import { getUserFromUuid } from './users';
import { updateSubscriptionQuantity } from '../stripe';
import { notifyUser } from '../notifications';

const TEAMS_COLLECTION = 'teams';
const TEAM_AUDIT_LOGS_COLLECTION = 'team_audit_logs';

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

/** Applies a Stripe subscription to the team that owns it. */
export async function syncTeamStripeSubscription(
  teamId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const teams = await getCollection('teams');
  const tier = resolveTierFromStripeSubscription(subscription);
  const item = subscription.items.data[0];
  const interval: BillingInterval | undefined = item?.price?.recurring?.interval === 'year'
    ? 'year'
    : item?.price?.recurring?.interval === 'month'
      ? 'month'
      : undefined;
  const now = new Date();
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne(
    { id: teamId },
    {
      $set: {
        ...(tier ? { tier } : {}),
        subscriptionStatus: subscription.status as PaidSubscriptionStatus,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id,
        seats: item?.quantity ?? 1,
        ...(interval ? { billingInterval: interval } : {}),
        ...(item?.current_period_end ? { currentPeriodEnd: new Date(item.current_period_end * 1000) } : {}),
        updatedAt: now,
      },
    },
  );

  const updated = await getTeamById(teamId);
  if (updated) {
    await enforceTeamMemberLimit(updated);
    await syncTeamMemberSubscriptions(updated);
  }
}

/** Reverts a team to the free plan after its Stripe subscription ends. */
export async function clearTeamStripeSubscription(teamId: string): Promise<void> {
  const teams = await getCollection('teams');
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne(
    { id: teamId },
    {
      $set: { tier: 'free', subscriptionStatus: 'canceled', updatedAt: new Date() },
      $unset: { stripeSubscriptionId: '', seats: '', billingInterval: '', currentPeriodEnd: '' },
    },
  );

  const updated = await getTeamById(teamId);
  if (updated) {
    await enforceTeamMemberLimit(updated);
    await syncTeamMemberSubscriptions(updated);
  }
}

/**
 * Keeps the Stripe subscription quantity in sync with the team's member count.
 */
export async function syncTeamMemberSubscriptions(team: Team): Promise<void> {
  const members = await getTeamMembers(team.id);
  const seats = Math.max(1, members.length);

  if (team.stripeSubscriptionId && team.seats !== seats) {
    try {
      await updateSubscriptionQuantity(team.stripeSubscriptionId, seats);
      const teams = await getCollection('teams');
      trackMongoOperation('updateOne', TEAMS_COLLECTION);
      await teams.updateOne({ id: team.id }, { $set: { seats, updatedAt: new Date() } });
    } catch {
      // Best effort: billing quantity is reconciled by the next Stripe event.
    }
  }
}

/** Removes the newest non-manager members when a plan cannot hold the team size. */
export async function enforceTeamMemberLimit(team: Team): Promise<void> {
  const members = await getTeamMembers(team.id);
  const limit = PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
  if (members.length <= limit) return;
  const removable = members
    .filter((member) => member.uuid !== team.managerUuid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const member of removable.slice(0, Math.max(0, members.length - limit))) {
    await clearUserTeamMembership(member.uuid, team.id);
  }
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

  await addUserToTeam(user.uuid, team.id, invite.role);
  if (!user.teamId) await setUserTeamMembership(user.uuid, team.id, invite.role);
  await syncTeamMemberSubscriptions(team);

  const invites = await getCollection('teamInvites');
  trackMongoOperation('updateOne', 'team_invites');
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
      link: '/dashboard?tab=team',
    });
  }
}

export async function getTeamSeatLimit(team: Team, _manager: User): Promise<number> {
  const planMax = (await import('@common')).PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
  if (team.seats && team.stripeSubscriptionId) {
    return Math.min(team.seats, planMax);
  }
  return planMax;
}

/**
 * Seat count used for shared, per-seat limits (credits, data points, ...).
 * Paid teams use billed seats; other teams use the actual member count.
 */
export async function getTeamSharedSeats(team: Team, _manager: User): Promise<number> {
  if (team.seats && team.stripeSubscriptionId) {
    return Math.max(1, team.seats);
  }
  const members = await getTeamMembers(team.id);
  return Math.max(1, members.length);
}
