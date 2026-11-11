import { randomUUID } from 'node:crypto';
import { getCollection, trackMongoOperation, normalizeDateValues, invalidateUserCache } from './internal';
import type { Team, TeamAuditLog, TeamRole, User, AttachedSubscription, TeamInvite } from '@common';
import { addAttachedSubscription, removeAttachedSubscription, getUserFromUuid, upsertPaidSubscription, removePaidSubscription } from './users';
import { getActivePaidSubscription } from '@common';
import { updateSubscriptionQuantity, cancelStripeSubscription } from '../stripe';

const TEAMS_COLLECTION = 'teams';
const TEAM_AUDIT_LOGS_COLLECTION = 'team_audit_logs';

export async function getTeamById(id: string): Promise<Team | null> {
  const teams = await getCollection('teams');
  trackMongoOperation('findOne', TEAMS_COLLECTION);
  return teams.findOne({ id });
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

  // A user with an active paid team subscription is an implicit team manager.
  const paid = getActivePaidSubscription(user as Pick<User, 'paidSubscriptions'>);
  if (paid?.tier.startsWith('team-')) {
    return ensureTeamForManager(user.uuid, paid.tier);
  }

  // Attached (granted) team subscriptions also create a team, with no seat billing.
  const attached = (user.attachedSubscriptions ?? []).find((s) => s.tier.startsWith('team-') && (s.expiresAt === null || new Date(s.expiresAt).getTime() > Date.now()));
  if (attached) {
    return ensureTeamForManager(user.uuid, attached.tier);
  }

  return null;
}

export async function ensureTeamForManager(managerUuid: string, tier?: string): Promise<Team | null> {
  const existing = await getTeamByManagerUuid(managerUuid);
  if (existing) return existing;

  const user = await getUserFromUuid(managerUuid);
  if (!user) return null;

  const paid = getActivePaidSubscription(user);
  const resolvedTier = (tier ?? paid?.tier) as string | undefined;
  if (!resolvedTier?.startsWith('team-')) return null;

  const now = new Date();
  const team: Team = {
    id: randomUUID(),
    managerUuid,
    tier: resolvedTier as Team['tier'],
    createdAt: now,
    updatedAt: now,
  };

  const teams = await getCollection('teams');
  trackMongoOperation('insertOne', TEAMS_COLLECTION);
  await teams.insertOne(normalizeDateValues(team));

  // Mark manager as team member/manager.
  await setUserTeamMembership(managerUuid, team.id, 'manager');

  return team;
}

export async function setUserTeamMembership(userUuid: string, teamId: string, role: TeamRole): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne({ uuid: userUuid }, { $set: { teamId, teamRole: role } });
  await invalidateUserCache(userUuid);
}

export async function clearUserTeamMembership(userUuid: string): Promise<void> {
  const users = await getCollection('users');
  trackMongoOperation('updateOne', 'users');
  await users.updateOne({ uuid: userUuid }, { $unset: { teamId: '', teamRole: '' } });
  await invalidateUserCache(userUuid);
}

export async function getTeamScopeUuid(user: Pick<User, 'uuid' | 'teamId' | 'paidSubscriptions' | 'attachedSubscriptions'>): Promise<string> {
  const team = await getTeamForUser(user as User);
  return team ? team.managerUuid : user.uuid;
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
  return users.find({ teamId }).toArray();
}

export function isTeamManager(user: Pick<User, 'uuid' | 'teamId' | 'teamRole' | 'paidSubscriptions' | 'attachedSubscriptions'>, team: Team | null): boolean {
  if (!team) return false;
  if (team.managerUuid === user.uuid) return true;
  return user.teamRole === 'manager';
}

export function canManageTeam(user: Pick<User, 'uuid' | 'teamId' | 'teamRole' | 'paidSubscriptions' | 'attachedSubscriptions'>, team: Team | null): boolean {
  return isTeamManager(user, team);
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

  // Attach team subscription to target if not already on this team.
  const existingSub = (target.attachedSubscriptions ?? []).find((s) => s.reason === 'team membership' && s.tier === team.tier);
  let subscriptionId: string;
  if (existingSub) {
    subscriptionId = existingSub.id;
  } else {
    const subscription: AttachedSubscription = {
      id: randomUUID(),
      tier: team.tier,
      createdAt: new Date(),
      expiresAt: manager.paidSubscriptions?.find((s) => s.tier === team.tier)?.currentPeriodEnd ?? null,
      addedByUuid: manager.uuid,
      addedByUsername: manager.username,
      reason: 'team membership',
    };
    await addAttachedSubscription(target.uuid, subscription);
    subscriptionId = subscription.id;
  }

  await setUserTeamMembership(target.uuid, team.id, role);

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
}

export async function updateTeamMemberRole(params: {
  team: Team;
  actor: User;
  target: User;
  role: TeamRole;
}): Promise<void> {
  const { team, actor, target, role } = params;
  await setUserTeamMembership(target.uuid, team.id, role);

  await logTeamAudit({
    teamId: team.id,
    actorUuid: actor.uuid,
    actorUsername: actor.username,
    action: 'member.role_changed',
    targetUuid: target.uuid,
    targetUsername: target.username,
    details: { role },
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
  migrateData?: boolean;
}): Promise<TeamInvite> {
  const { team, actor, email, role, migrateData } = params;
  const now = new Date();
  const token = (await import('node:crypto')).randomBytes(32).toString('hex');
  const invite: TeamInvite = {
    migrateData: migrateData ?? false,
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


async function migrateUserDataToTeam(userUuid: string, team: Team): Promise<void> {
  const manager = await getUserFromUuid(team.managerUuid);
  const scopeUuid = team.managerUuid;
  const scopeUsername = manager?.username ?? '';

  const devices = await getCollection('devices');
  trackMongoOperation('updateMany', 'devices');
  await devices.updateMany({ ownerUuid: userUuid }, { $set: { ownerUuid: scopeUuid, ownerUsername: scopeUsername } });

  const locations = await getCollection('locations');
  trackMongoOperation('updateMany', 'locations');
  await locations.updateMany({ ownerUuid: userUuid }, { $set: { ownerUuid: scopeUuid, ownerUsername: scopeUsername } });

  try {
    const { invalidateDeviceCachesForOwner } = await import('./devices');
    await invalidateDeviceCachesForOwner(userUuid);
    await invalidateDeviceCachesForOwner(scopeUuid);
  } catch {
    // ignore
  }
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
  const existingSub = (user.attachedSubscriptions ?? []).find((s) => s.reason === 'team membership' && s.tier === team.tier);
  if (!existingSub) {
    const subscription: AttachedSubscription = {
      id: randomUUID(),
      tier: team.tier,
      createdAt: new Date(),
      expiresAt: manager.paidSubscriptions?.find((s) => s.tier === team.tier)?.currentPeriodEnd ?? null,
      addedByUuid: manager.uuid,
      addedByUsername: manager.username,
      reason: 'team membership',
    };
    await addAttachedSubscription(user.uuid, subscription);
  }

  await setUserTeamMembership(user.uuid, team.id, invite.role);

  if (invite.migrateData) {
    await migrateUserDataToTeam(user.uuid, team);
  }

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
