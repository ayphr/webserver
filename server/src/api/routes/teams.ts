import { json, readJsonBody } from '../../lib/http';
import { requireAuth } from '../auth';
import {
  getTeamForUser,
  ensureTeamForManager,
  getTeamMembers,
  removeTeamMember as removeMember,
  updateTeamMemberRole as updateRole,
  getTeamAuditLogs,
  canManageTeam,
  createTeamInvite,
  getTeamInvites,
  getPendingInvitesForEmail,
  revokeTeamInvite,
  getTeamInviteByToken,
  acceptTeamInvite,
  getTeamSeatLimit,
} from '../../lib/db/teams';
import {
  getUserFromUuid,
  getUserFromUsername,
  getUserByEmail,
} from '../../lib/db/users';
import type { TeamRole, User } from '@common';
import { isTeamRole } from '@common';

const handleTeamMe = requireAuth(async (_request, user: User) => {
  let team = await getTeamForUser(user);
  if (!team && user.paidSubscriptions?.some((s) => s.tier.startsWith('team-') && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due'))) {
    const paid = user.paidSubscriptions.find((s) => s.tier.startsWith('team-'));
    if (paid) team = await ensureTeamForManager(user.uuid, paid.tier);
  }

  if (!team) {
    return json({ error: 'No team found' }, 404);
  }

  const members = await getTeamMembers(team.id);
  const mapped = members.map((m) => ({
    uuid: m.uuid,
    username: m.username,
    role: (m.teamRole as TeamRole) ?? (m.uuid === team.managerUuid ? 'manager' : 'member'),
    joinedAt: m.createdAt,
  }));

  return json({
    team,
    members: mapped,
    role: (user.teamRole as TeamRole) ?? (user.uuid === team.managerUuid ? 'manager' : 'member'),
  });
});

const handleTeamMembersList = requireAuth(async (_request, user: User) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);

  const members = await getTeamMembers(team.id);
  const mapped = members.map((m) => ({
    uuid: m.uuid,
    username: m.username,
    role: (m.teamRole as TeamRole) ?? (m.uuid === team.managerUuid ? 'manager' : 'member'),
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
  const migrateData = body?.migrateData === true;
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
    if (target.teamId) return json({ error: 'user already belongs to a team' }, 409);
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

  const invite = await createTeamInvite({ team, actor: user, email: inviteEmail, role, migrateData });

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
      migrateData,
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

  return json({ invite }, 201);
});

const handleTeamMemberRoleUpdate = requireAuth(async (request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const targetUuid = params.uuid;
  if (!targetUuid) return json({ error: 'user uuid is required' }, 400);

  const body = await readJsonBody(request);
  const roleRaw = body?.role;
  if (!isTeamRole(roleRaw)) return json({ error: 'invalid role' }, 400);

  const target = await getUserFromUuid(targetUuid);
  if (!target || target.teamId !== team.id) return json({ error: 'member not found' }, 404);
  if (target.uuid === team.managerUuid && roleRaw !== 'manager') {
    // allow? keep manager at least one manager; but allow demotion? Prevent removing last manager maybe.
  }

  await updateRole({ team, actor: user, target, role: roleRaw });

  return json({ member: { uuid: target.uuid, username: target.username, role: roleRaw } });
});

const handleTeamMemberRemove = requireAuth(async (_request, user: User, params) => {
  const team = await getTeamForUser(user);
  if (!team) return json({ error: 'No team found' }, 404);
  if (!canManageTeam(user, team)) return json({ error: 'Forbidden' }, 403);

  const targetUuid = params.uuid;
  if (!targetUuid) return json({ error: 'user uuid is required' }, 400);
  if (targetUuid === team.managerUuid) return json({ error: 'cannot remove the team manager' }, 400);

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

  // Ensure not already on another team.
  if (user.teamId && user.teamId !== invite.teamId) {
    return json({ error: 'already belongs to a team' }, 409);
  }

  await acceptTeamInvite({ invite, user });

  return json({ accepted: true });
});



const handlePendingTeamInvites = requireAuth(async (_request, user: User) => {
  if (!user.email) return json({ invites: [] });
  const invites = await getPendingInvitesForEmail(user.email);
  return json({ invites });
});


export {
  handleTeamMe,
  handleTeamMembersList,
  handleTeamMemberAdd,
  handleTeamMemberRoleUpdate,
  handleTeamMemberRemove,
  handleTeamAuditLogs,
  handleTeamInvitesList,
  handleTeamInviteRevoke,
  handleTeamInviteAccept,
  handlePendingTeamInvites,
};
