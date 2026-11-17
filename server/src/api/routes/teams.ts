import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  getTeamForUser,
  getTeamById,
  getTeamMembers,
  removeTeamMember as removeMember,
  updateTeamMemberRole as updateRole,
  getTeamAuditLogs,
  canManageTeam,
  updateTeamName,
  createTeamInvite,
  getTeamInvites,
  getPendingInvitesForEmail,
  revokeTeamInvite,
  getTeamInviteByToken,
  acceptTeamInvite,
  getTeamSeatLimit,
  getTeamsForUser,
  setActiveTeam,
  createTeamForUser,
  setTeamStripeCustomerId,
} from '../../lib/db/teams';
import {
  createBillingPortalSession,
  createTeamCheckoutSession,
  createTeamStripeCustomer,
  getPriceIdForTier,
  getStripe,
  getSubscriptionPlans,
} from '../../lib/stripe';
import { CLIENT_URL, STRIPE_TRIAL_DAYS } from '../../env';
import {
  getUserFromUuid,
  getUserFromUsername,
  getUserByEmail,
} from '../../lib/db/users';
import type { TeamRole, User } from '@common';
import { isTeamRole, isSubscriptionTier, isPurchasableTier, isBillingInterval } from '@common';
import { notifyUser } from '../../lib/notifications';

const handleTeamMe = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);

  if (!team) {
    return json({ error: 'No team found' }, 404);
  }

  const members = await getTeamMembers(team.id);
  const mapped = members.map((m) => ({
    uuid: m.uuid,
    username: m.username,
    role: ((m.teamRoles?.[team.id] ?? m.teamRole) as TeamRole) ?? (m.uuid === team.managerUuid ? 'manager' : 'member'),
    joinedAt: m.createdAt,
  }));

  return json({
    team,
    members: mapped,
    role: ((user.teamRoles?.[team.id] ?? user.teamRole) as TeamRole) ?? (user.uuid === team.managerUuid ? 'manager' : 'member'),
  });
});

const handleTeamMembersList = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);

  const members = await getTeamMembers(team.id);
  const mapped = members.map((m) => ({
    uuid: m.uuid,
    username: m.username,
    role: ((m.teamRoles?.[team.id] ?? m.teamRole) as TeamRole) ?? (m.uuid === team.managerUuid ? 'manager' : 'member'),
    joinedAt: m.createdAt,
  }));

  return json({ members: mapped });
});

const handleTeamMemberAdd = requireAuth(async (request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const body = await readJsonBody(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const uuid = typeof body?.uuid === 'string' ? body.uuid.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const roleRaw = body?.role;
  const role: TeamRole = isTeamRole(roleRaw) ? roleRaw : 'member';

  if (!username && !uuid && !email) {
    return json({ error: 'username, uuid, or email is required' }, 400);
  }

  // Resolve target (if any) for validation.
  let target = uuid ? await getUserFromUuid(uuid) : username ? await getUserFromUsername(username) : null;
  if (!target && email) {
    target = await getUserByEmail(email);
  }

  if (target) {
    if (target.uuid === user.uuid) return json({ error: 'cannot add yourself' }, 400);
    const targetTeams = target.teamIds ?? (target.teamId ? [target.teamId] : []);
    if (targetTeams.includes(team.id)) return json({ error: 'user already belongs to this team' }, 409);
    if (targetTeams.length >= 3) return json({ error: 'user is already a member of 3 teams' }, 409);
  }

  const inviteEmail = target?.email ?? (email.includes('@') ? email : '');
  if (!inviteEmail) {
    return json({ error: 'a valid email is required to invite this user' }, 400);
  }

  const members = await getTeamMembers(team.id);
  const seatLimit = await getTeamSeatLimit(team, user);
  if (members.length >= seatLimit) {
    return json({ error: 'team member limit reached' }, 409);
  }

  const invite = await createTeamInvite({ team, actor: user, email: inviteEmail, role });

  // Send invite email (best effort).
  try {
    const { sendEmail } = await import('../../lib/email');
    const { CLIENT_URL } = await import('../../env');
    const { buildTeamInviteEmail } = await import('../../lib/email/templates');
    const isExistingUser = Boolean(target);
    const link = isExistingUser
      ? `${CLIENT_URL}/dashboard?invite=${invite.token}`
      : `${CLIENT_URL}/auth/register?invite=${invite.token}`;
    const emailContent = buildTeamInviteEmail({
      inviterUsername: user.username,
      inviteUrl: link,
      teamName: team.name,
    });
    await sendEmail({
      to: inviteEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
  } catch {
    // ignore
  }

  if (target) {
    await notifyUser({
      userUuid: target.uuid,
      type: 'team_invite',
      title: `${user.username} invited you to join ${team.name ?? 'their team'}`,
      message: 'Open this notification to review and accept the invitation.',
      link: `/dashboard?invite=${encodeURIComponent(invite.token)}`,
    });
  }

  return json({ invite }, 201);
});

const handleTeamMemberRoleUpdate = requireAuth(async (request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (team.managerUuid !== user.uuid) return json({ error: 'Forbidden' }, 403);

  const targetUuid = params.uuid;
  if (!targetUuid) return json({ error: 'user uuid is required' }, 400);

  const body = await readJsonBody(request);
  const roleRaw = body?.role;
  if (!isTeamRole(roleRaw)) return json({ error: 'invalid role' }, 400);

  const target = await getUserFromUuid(targetUuid);
  if (!target || target.teamId !== team.id) return json({ error: 'member not found' }, 404);
  if (target.uuid === team.managerUuid) {
    return json({ error: 'cannot change the team manager role' }, 400);
  }

  await updateRole({ team, actor: user, target, role: roleRaw });

  return json({ member: { uuid: target.uuid, username: target.username, role: roleRaw } });
});

const handleTeamMemberRemove = requireAuth(async (_request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);

  const targetUuid = params.uuid;
  if (!targetUuid) return json({ error: 'user uuid is required' }, 400);
  const isSelf = targetUuid === user.uuid;
  if (team.managerUuid !== user.uuid && !isSelf) return json({ error: 'Forbidden' }, 403);
  if (targetUuid === team.managerUuid) return json({ error: 'the team manager cannot leave the team' }, 400);

  const target = await getUserFromUuid(targetUuid);
  if (!target || target.teamId !== team.id) return json({ error: 'member not found' }, 404);

  await removeMember({ team, actor: user, target });

  return json({ removed: true });
});

const handleTeamAuditLogs = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const logs = await getTeamAuditLogs(team.id);
  return json({ logs });
});


const handleTeamInvitesList = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const invites = await getTeamInvites(team.id);
  return json({ invites });
});

const handleTeamInviteRevoke = requireAuth(async (_request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const inviteId = params.id;
  if (!inviteId) return json({ error: 'invite id is required' }, 400);

  const revoked = await revokeTeamInvite(team.id, inviteId);
  if (!revoked) return json({ error: 'not found' }, 404);

  return json({ revoked: true });
});

const handleTeamInviteAccept = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return json({ error: 'token is required' }, 400);

  const invite = await getTeamInviteByToken(token);
  if (!invite) return json({ error: 'invalid invite' }, 404);
  if (invite.acceptedAt) return json({ error: 'invite already used' }, 409);
  if (invite.expiresAt.getTime() <= Date.now()) return json({ error: 'invite expired' }, 410);
  if (invite.email !== (user.email ?? '').toLowerCase()) {
    return json({ error: 'invite email does not match your account' }, 403);
  }

  // Ensure not already in 3 teams.
  const currentTeams = user.teamIds ?? (user.teamId ? [user.teamId] : []);
  if (currentTeams.length >= 3 && !currentTeams.includes(invite.teamId)) {
    return json({ error: 'already a member of 3 teams' }, 409);
  }

  await acceptTeamInvite({ invite, user });

  return json({ accepted: true });
});



const handlePendingTeamInvites = requireAuth(async (_request, user: User) => {
  if (!user.email) return json({ invites: [] });
  const invites = await getPendingInvitesForEmail(user.email);
  const enriched = await Promise.all(
    invites.map(async (invite) => {
      const team = await getTeamById(invite.teamId);
      return { ...invite, teamName: team?.name };
    }),
  );
  return json({ invites: enriched });
});


const handleTeamUpdate = requireAuth(async (request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const body = await readJsonBody(request);
  const nameRaw = body?.name;
  if (typeof nameRaw !== 'string') return json({ error: 'name is required' }, 400);
  const name = nameRaw.trim();
  if (!name) return json({ error: 'name is required' }, 400);
  if (name.length > 64) return json({ error: 'name is too long' }, 400);

  const updated = await updateTeamName(team, user, name);
  return json({ team: updated });
});

const handleTeamDelete = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (team.managerUuid !== user.uuid) return json({ error: 'Forbidden' }, 403);
  // Remove team from all members.
  const users = await (await import('../../lib/db/internal')).getCollection('users');
  await users.updateMany({ teamIds: team.id }, { $pull: { teamIds: team.id }, $unset: { [`teamRoles.${team.id}`]: '' } });
  await users.updateMany({ teamId: team.id }, { $set: { teamId: null, teamRole: null } });
  const teams = await (await import('../../lib/db/internal')).getCollection('teams');
  await teams.deleteOne({ id: team.id });
  // switch user to another team if available
  const remaining = (user.teamIds ?? []).filter((id) => id !== team.id);
  if (remaining.length > 0) await setActiveTeam(user.uuid, remaining[0]);
  return json({ deleted: true });
});

const handleListMyTeams = requireAuth(async (_request, user: User) => {
  const teams = await getTeamsForUser(user);
  return json({ teams });
});

const handleSwitchTeam = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const teamId = typeof body?.teamId === 'string' ? body.teamId.trim() : '';
  if (!teamId) return json({ error: 'team id is required' }, 400);
  try {
    await setActiveTeam(user.uuid, teamId);
  } catch {
    return json({ error: 'not a member of this team' }, 403);
  }
  const team = await getTeamById(teamId);
  return json({ team });
});

const handleCreateTeam = requireAuth(async (request, user: User) => {
  const body = await readJsonBody(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  const current = await getTeamsForUser(user);
  if (current.length >= 3) return json({ error: 'team limit reached' }, 409);
  const team = await createTeamForUser(user.uuid, name);
  if (!team) return json({ error: 'failed to create team' }, 500);
  return json({ team }, 201);
});

const handleTeamSubscription = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  const plans = (await getSubscriptionPlans()).filter((plan) => plan.tier.startsWith('team-'));
  return json({ team, plans, trialDays: STRIPE_TRIAL_DAYS });
});

const handleTeamSubscriptionCheckout = requireAuth(async (request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const body = await readJsonBody(request);
  const tier = body?.tier;
  const interval = body?.interval;
  if (!isSubscriptionTier(tier) || !tier.startsWith('team-')) {
    return json({ error: 'select a valid team plan' }, 400);
  }
  if (!isPurchasableTier(tier)) {
    return json({ error: 'This plan is not available for purchase' }, 400);
  }
  if (!isBillingInterval(interval)) {
    return json({ error: 'interval must be "month" or "year"' }, 400);
  }

  const priceId = getPriceIdForTier(tier, interval);
  if (!priceId) return json({ error: 'This plan is not available for purchase' }, 503);
  if (!getStripe()) return json({ error: 'Stripe is not configured' }, 503);

  let customerId = team.stripeCustomerId;
  if (!customerId) {
    customerId = await createTeamStripeCustomer({
      teamId: team.id,
      name: team.name ?? `${user.username}'s Team`,
    }) ?? undefined;
    if (!customerId) return json({ error: 'Failed to create billing customer' }, 502);
    await setTeamStripeCustomerId(team.id, customerId);
  }

  const url = await createTeamCheckoutSession({
    customerId,
    priceId,
    tier,
    teamId: team.id,
    successUrl: `${CLIENT_URL}/dashboard?tab=team&checkout=success`,
    cancelUrl: `${CLIENT_URL}/dashboard?tab=team&checkout=cancel`,
  });

  if (!url) return json({ error: 'Failed to create checkout session' }, 502);
  return json({ url });
});

const handleTeamSubscriptionPortal = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);
  if (!team.stripeCustomerId) return json({ error: 'No billing account found' }, 404);

  const url = await createBillingPortalSession({
    customerId: team.stripeCustomerId,
    returnUrl: `${CLIENT_URL}/dashboard?tab=team`,
  });

  if (!url) return json({ error: 'Stripe is not configured' }, 503);
  return json({ url });
});

export {
  handleTeamMe,
  handleTeamUpdate,
  handleTeamDelete,
  handleTeamMembersList,
  handleTeamMemberAdd,
  handleTeamMemberRoleUpdate,
  handleTeamMemberRemove,
  handleTeamAuditLogs,
  handleTeamInvitesList,
  handleTeamInviteRevoke,
  handleTeamInviteAccept,
  handlePendingTeamInvites,
  handleListMyTeams,
  handleSwitchTeam,
  handleCreateTeam,
  handleTeamSubscription,
  handleTeamSubscriptionCheckout,
  handleTeamSubscriptionPortal,
};
