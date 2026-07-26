import { randomUUID } from 'node:crypto';
import { requireRole } from '../auth';
import { createPunishment, getPunishmentById, getPunishmentsByType, getUserCount, getUserFromUsername, getUserFromUuid, getUsers, getUsersByRole, updatePunishment, updateUserRole, getActiveSuspensionForUserUuid } from '../../workers/dbWriter';
import type { Punishment, User, UserRole } from '../../../../common';
import { handleApiNotFoundRoute } from './util';

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

const handleUsersSummary = requireRole('staff', async () => {
  const [users, staffUsers, ownerUsers] = await Promise.all([
    getUserCount(),
    getUsersByRole('staff'),
    getUsersByRole('owner'),
  ]);

  return json({
    userCount: users,
    staffCount: staffUsers.length,
    ownerCount: ownerUsers.length,
  });
});

const handleStaffUsers = requireRole('staff', async () => {
  const users = await getUsers();
  return json({ users: users.map(publicUser) });
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
    const durationMinutes = typeof body?.durationMinutes === 'number' ? body.durationMinutes : 60;

    if (!reason) {
      return json({ error: 'reason is required' }, 400);
    }

    const targetUser = targetUuid ? await getUserFromUuid(targetUuid) : targetUsername ? await getUserFromUsername(targetUsername) : null;
    if (!targetUser) {
      return json({ error: 'target user not found' }, 404);
    }

    if (targetUser.role === 'owner' && targetUser.uuid !== staffUser.uuid) {
      return json({ error: 'you cannot suspend other owners' }, 403);
    }

    if (!Number.isFinite(durationMinutes) || durationMinutes < -1) {
      return json({ error: 'durationMinutes must be a positive number or -1 for permanent' }, 400);
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

    return json({ punishment }, 201);
  }

  return handleApiNotFoundRoute(request);
});

const handleStaffPunishmentLift = requireRole('staff', async (request, staffUser) => {
  const url = new URL(request.url);
  const punishmentId = url.pathname.split('/')[4] as string;
  const punishment = await getPunishmentById(punishmentId);
  if (!punishment) {
    return json({ error: 'punishment not found' }, 404);
  }

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

  return json({ punishment });
}, { allowSuspended: true });

const handleStaffRoleUpdate = requireRole('owner', async (request) => {
  const url = new URL(request.url);
  const targetUuid = url.pathname.split('/')[4];

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  // eslint-disable-next-line no-useless-assignment
  let body: { role?: UserRole } | null = null;
  try {
    body = await request.json() as { role?: UserRole };
  } catch {
    body = null;
  }

  if (!body?.role || !['user', 'staff', 'owner'].includes(body.role)) {
    return json({ error: 'role must be user, staff, or owner' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  if (targetUser.role === 'owner' && body.role !== 'owner') {
    const ownerUsers = await getUsersByRole('owner');
    if (ownerUsers.length <= 1) {
      return json({ error: 'cannot remove the last owner' }, 409);
    }
  }

  const updatedUser = await updateUserRole(targetUuid, body.role);
  if (!updatedUser) {
    return json({ error: 'user not found' }, 404);
  }

  return json({ user: updatedUser });
});

export function handleStaffRoute(request: Request) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/staff/summary') {
    return handleUsersSummary(request);
  }

  if (request.method === 'GET' && url.pathname === '/api/staff/users') {
    return handleStaffUsers(request);
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/staff/role/')) {
    return handleStaffRoleUpdate(request);
  }

  if (request.method === 'POST' && url.pathname.startsWith('/api/staff/punishments/') && url.pathname.endsWith('/lift')) {
    return handleStaffPunishmentLift(request);
  }

  if ((request.method === 'GET' || request.method === 'POST') && url.pathname.startsWith('/api/staff/punishments')) {
    return handleStaffPunishments(request);
  }

  return handleApiNotFoundRoute(request);
}
