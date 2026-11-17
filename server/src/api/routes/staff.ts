import { json, parsePositiveInt, readJsonBody } from '../../lib/http';
import { randomUUID } from 'node:crypto';
import { createPasswordHash, requireRole } from '../auth';
import { createPunishment, deleteSessionsForUserUuid, getPunishmentById, getPunishmentsByType, getUserCount, getUserFromUsername, getUserFromUuid, getUsersByRole, listUsers, countUsers, updatePunishment, updateUser, updateUserRole, getActiveSuspensionForUserUuid } from '../../lib/db';
import { getAppeals, getAppealById, resolveAppeal } from '../../lib/db/appeals';
import type { Punishment, User, UserRole } from '@common';
import { getPasswordValidationErrors } from '@common/utils/password';
import { toPublicUser } from '../../lib/user';
import { punishmentsTotal, staffActionsTotal } from '../../lib/metrics';
import { notifyUser } from '../../lib/notifications';

const MAX_REASON_LENGTH = 500;
const MAX_DURATION_MINUTES = 5 * 365 * 24 * 60;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const handleUsersSummary = requireRole('staff', async () => {
  const [users, staffUsers] = await Promise.all([
    getUserCount(),
    getUsersByRole('staff')
  ]);

  return json({
    userCount: users,
    staffCount: staffUsers.length
  });
});

const handleStaffUsers = requireRole('staff', async (request) => {
  const params = new URL(request.url).searchParams;

  const search = params.get('q')?.trim() || undefined;

  const roleParam = params.get('role');
  if (roleParam && roleParam !== 'user' && roleParam !== 'staff') {
    return json({ error: 'role must be user or staff' }, 400);
  }
  const role = (roleParam as UserRole | null) ?? undefined;

  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = Math.min(parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const baseFilter = { search, role };

  const [users, count] = await Promise.all([
    listUsers(baseFilter, { skip, limit: pageSize }),
    countUsers(baseFilter),
  ]);
  const pageUsers = users;
  const total = count;

  return json({
    users: await Promise.all(pageUsers.map((u) => toPublicUser(u))),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

const handleStaffPunishments = requireRole('staff', async (request, staffUser) => {
  if (request.method === 'GET') {
    const punishments = await getPunishmentsByType('suspension');
    return json({ punishments });
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const targetUsername = typeof body?.username === 'string' ? body.username : undefined;
    const targetUuid = typeof body?.userUuid === 'string' ? body.userUuid : undefined;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!reason || reason.length > MAX_REASON_LENGTH) {
      return json({ error: `reason is required and must be at most ${MAX_REASON_LENGTH} characters` }, 400);
    }

    let durationMinutes = 60;
    if (body?.durationMinutes !== undefined) {
      if (typeof body.durationMinutes !== 'number' || !Number.isInteger(body.durationMinutes)) {
        return json({ error: 'durationMinutes must be an integer' }, 400);
      }
      durationMinutes = body.durationMinutes;
    }

    if (durationMinutes !== -1 && (durationMinutes < 1 || durationMinutes > MAX_DURATION_MINUTES)) {
      return json({ error: 'durationMinutes must be between 1 and 2628000 minutes, or -1 for permanent' }, 400);
    }

    const targetUser = await (async () => {
      if (targetUuid) {
        return await getUserFromUuid(targetUuid);
      } else if (targetUsername) {
        return await getUserFromUsername(targetUsername);
      }
      return null;
    })();

    if (!targetUser) {
      return json({ error: 'target user not found' }, 404);
    }

    const now = new Date();
    const punishment: Punishment = {
      id: randomUUID(),
      type: 'suspension',
      userUuid: targetUser.uuid,
      userUsername: targetUser.username,
      reason,
      issuedByUuid: staffUser.uuid,
      issuedByUsername: staffUser.username,
      issuedAt: now,
      startsAt: now,
      endsAt: durationMinutes === -1 ? null : new Date(now.getTime() + durationMinutes * 60 * 1000),
    };

    await createPunishment(punishment);
    punishmentsTotal.inc({ type: 'suspension', action: 'created' });
    staffActionsTotal.inc({ action: 'punishment_create' });

    await notifyUser({
      userUuid: targetUser.uuid,
      type: 'punishment',
      title: 'Your account was suspended',
      message: punishment.endsAt
        ? `${reason} · Ends ${punishment.endsAt.toUTCString()}`
        : `${reason} · This suspension is permanent.`,
      link: '/dashboard?tab=appeal',
    });

    return json({ punishment }, 201);
  }

  return json({ error: 'method not allowed' }, 405);
});

const handleStaffPunishmentLift = requireRole('staff', async (_request, staffUser, params) => {
  const punishmentId = params.id;
  if (!punishmentId) {
    return json({ error: 'punishment id is required' }, 400);
  }

  const punishment = await getPunishmentById(punishmentId);
  if (!punishment) {
    return json({ error: 'punishment not found' }, 404);
  }

  // Staff can lift their own punishment, but a suspended staff member may not
  // lift anyone else's.
  if (staffUser.role === 'staff' && punishment.userUuid !== staffUser.uuid) {
    const activeSuspension = await getActiveSuspensionForUserUuid(staffUser.uuid);
    if (activeSuspension) {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  punishment.liftedAt = new Date();
  punishment.liftedByUuid = staffUser.uuid;
  punishment.liftedByUsername = staffUser.username;
  await updatePunishment(punishment);

  punishmentsTotal.inc({ type: punishment.type, action: 'lifted' });
  staffActionsTotal.inc({ action: 'punishment_lift' });

  await notifyUser({
    userUuid: punishment.userUuid,
    type: 'punishment',
    title: 'Your suspension was lifted',
    message: 'Your account suspension has been lifted.',
    link: '/dashboard?tab=overview',
  });

  return json({ punishment });
}, { allowSuspended: true });

const handleStaffAppeals = requireRole('staff', async () => {
  const appeals = await getAppeals();
  return json({ appeals });
}, { allowSuspended: true });

const handleStaffAppealResolve = requireRole('staff', async (request, staffUser, params) => {
  const appealId = params.id;
  if (!appealId) return json({ error: 'appeal id is required' }, 400);

  const body = await readJsonBody(request);
  const decision = body?.decision;
  if (decision !== 'lift' && decision !== 'deny') {
    return json({ error: 'decision must be "lift" or "deny"' }, 400);
  }

  const appeal = await getAppealById(appealId);
  if (!appeal) return json({ error: 'appeal not found' }, 404);
  if (appeal.status !== 'pending') return json({ error: 'appeal already resolved' }, 409);

  if (decision === 'lift') {
    const punishment = await getPunishmentById(appeal.punishmentId);
    if (punishment && !punishment.liftedAt) {
      punishment.liftedAt = new Date();
      punishment.liftedByUuid = staffUser.uuid;
      punishment.liftedByUsername = staffUser.username;
      punishment.liftedReason = 'Appeal accepted';
      await updatePunishment(punishment);
      punishmentsTotal.inc({ type: punishment.type, action: 'lifted' });
      staffActionsTotal.inc({ action: 'punishment_lift' });
    }
  }

  const resolved = await resolveAppeal({
    appealId,
    resolution: decision === 'lift' ? 'lifted' : 'denied',
    staffUuid: staffUser.uuid,
    staffUsername: staffUser.username,
  });

  await notifyUser({
    userUuid: appeal.userUuid,
    type: 'appeal',
    title: decision === 'lift' ? 'Your appeal was accepted' : 'Your appeal was denied',
    message: decision === 'lift'
      ? 'Your appeal was accepted and your suspension has been lifted.'
      : 'Your appeal was reviewed and denied.',
    link: decision === 'lift' ? '/dashboard?tab=overview' : '/dashboard?tab=appeal',
  });

  return json({ appeal: resolved });
}, { allowSuspended: true });

const handleStaffRoleUpdate = requireRole('staff', async (request, _user, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  let body: { role?: UserRole } | null;
  try {
    body = await request.json() as { role?: UserRole };
  } catch {
    body = null;
  }

  if (!body?.role) {
    return json({ error: 'role is required' }, 400);
  }

  if (!['user', 'staff'].includes(body.role)) {
    return json({ error: 'role must be user or staff' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  const updatedUser = await updateUserRole(targetUuid, body.role);
  if (!updatedUser) {
    return json({ error: 'user not found' }, 404);
  }

  staffActionsTotal.inc({ action: 'role_update' });

  await notifyUser({
    userUuid: targetUser.uuid,
    type: 'system',
    title: 'Your account role was updated',
    message: `Your account role is now ${body.role}.`,
  });

  return json({ user: await toPublicUser(updatedUser) });
});

const handleStaffPasswordUpdate = requireRole('staff', async (request, _staffUser, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const body = await readJsonBody(request);
  const password = typeof body?.password === 'string' ? body.password : undefined;

  if (!password) {
    return json({ error: 'password is required' }, 400);
  }

  const passwordValidationErrors = getPasswordValidationErrors(password);
  if (passwordValidationErrors.length > 0) {
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  targetUser.auth.passwordHash = await createPasswordHash(password);
  targetUser.trustedDevices = [];
  await updateUser(targetUser);

  // Setting a password signs the user out of every device.
  await deleteSessionsForUserUuid(targetUser.uuid);

  staffActionsTotal.inc({ action: 'password_reset' });

  await notifyUser({
    userUuid: targetUser.uuid,
    type: 'security',
    title: 'Your password was reset by staff',
    message: 'A staff member set a new password for your account and signed out all devices.',
    link: '/dashboard?tab=account-settings',
  });

  return json({ user: await toPublicUser(targetUser) });
});

export {
  handleUsersSummary,
  handleStaffUsers,
  handleStaffPunishments,
  handleStaffPunishmentLift,
  handleStaffAppeals,
  handleStaffAppealResolve,
  handleStaffRoleUpdate,
  handleStaffPasswordUpdate,
};