import { json, parsePositiveInt, readJsonBody } from '../../lib/http';
import { randomUUID } from 'node:crypto';
import { createPasswordHash, requireRole } from '../auth';
import { createPunishment, deleteSessionsForUserUuid, getPunishmentById, getPunishmentsByType, getUserCount, getUserFromUsername, getUserFromUuid, getUsersByRole, listUsers, countUsers, updatePunishment, updateUser, updateUserRole, getActiveSuspensionForUserUuid, addAttachedSubscription, removeAttachedSubscription, getAttachedSubscriptionsForUserUuid, updateAttachedSubscription } from '../../lib/db';
import type { AttachedSubscription, Punishment, SubscriptionSource, SubscriptionTier, User, UserRole } from '@common';
import { isSubscriptionTier, resolveSubscription } from '@common';
import { getPasswordValidationErrors } from '@common/utils/password';
import { toPublicUser } from '../../lib/user';
import { punishmentsTotal, staffActionsTotal } from '../../lib/metrics';

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

type SubscriptionState = 'active' | 'expired' | 'none';

function getSubscriptionState(user: User): SubscriptionState {
  const resolved = resolveSubscription(user);
  if (resolved) return 'active';

  const hasAnySubscription =
    (user.paidSubscriptions?.length ?? 0) > 0 || (user.attachedSubscriptions?.length ?? 0) > 0;

  return hasAnySubscription ? 'expired' : 'none';
}

function matchesSubscriptionFilters(
  user: User,
  filters: { tier?: SubscriptionTier; source?: SubscriptionSource; status?: SubscriptionState },
) {
  const resolved = resolveSubscription(user);

  if (filters.status && getSubscriptionState(user) !== filters.status) {
    return false;
  }

  if (filters.tier) {
    const hasTier =
      resolved?.tier === filters.tier ||
      (user.paidSubscriptions ?? []).some((subscription) => subscription.tier === filters.tier) ||
      (user.attachedSubscriptions ?? []).some((subscription) => subscription.tier === filters.tier);
    if (!hasTier) return false;
  }

  if (filters.source) {
    const hasSource =
      resolved?.source === filters.source ||
      (filters.source === 'paid' && (user.paidSubscriptions?.length ?? 0) > 0) ||
      (filters.source === 'attached' && (user.attachedSubscriptions?.length ?? 0) > 0);
    if (!hasSource) return false;
  }

  return true;
}

const handleStaffUsers = requireRole('staff', async (request) => {
  const params = new URL(request.url).searchParams;

  const search = params.get('q')?.trim() || undefined;

  const roleParam = params.get('role');
  if (roleParam && roleParam !== 'user' && roleParam !== 'staff') {
    return json({ error: 'role must be user or staff' }, 400);
  }
  const role = (roleParam as UserRole | null) ?? undefined;

  const tierParam = params.get('tier');
  let tier: SubscriptionTier | undefined;
  if (tierParam) {
    if (!isSubscriptionTier(tierParam)) {
      return json({ error: 'tier must be a valid subscription tier' }, 400);
    }
    tier = tierParam;
  }

  const sourceParam = params.get('source');
  if (sourceParam && sourceParam !== 'paid' && sourceParam !== 'attached') {
    return json({ error: 'source must be paid or attached' }, 400);
  }
  const source = (sourceParam as SubscriptionSource | null) ?? undefined;

  const statusParam = params.get('status');
  if (statusParam && statusParam !== 'active' && statusParam !== 'expired' && statusParam !== 'none') {
    return json({ error: 'status must be active, expired or none' }, 400);
  }
  const status = (statusParam as SubscriptionState | null) ?? undefined;

  const page = parsePositiveInt(params.get('page'), 1);
  const pageSize = Math.min(parsePositiveInt(params.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const skip = (page - 1) * pageSize;

  const baseFilter = { search, role };
  const hasSubscriptionFilter = Boolean(tier || source || status);

  let pageUsers: User[];
  let total: number;

  if (hasSubscriptionFilter) {
    const allMatching = await listUsers(baseFilter);
    const filtered = allMatching.filter((user) => matchesSubscriptionFilters(user, { tier, source, status }));
    total = filtered.length;
    pageUsers = filtered.slice(skip, skip + pageSize);
  } else {
    const [users, count] = await Promise.all([
      listUsers(baseFilter, { skip, limit: pageSize }),
      countUsers(baseFilter),
    ]);
    pageUsers = users;
    total = count;
  }

  return json({
    users: pageUsers.map(toPublicUser),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
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

  return json({ punishment });
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
  return json({ user: toPublicUser(updatedUser) });
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
  await updateUser(targetUser);

  // Setting a password signs the user out of every device.
  await deleteSessionsForUserUuid(targetUser.uuid);

  staffActionsTotal.inc({ action: 'password_reset' });

  return json({ user: toPublicUser(targetUser) });
});

const handleStaffSubscriptionAttach = requireRole('staff', async (request, staffUser, params) => {
  const targetUuid = params.uuid;
  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const body = await readJsonBody(request);
  const tier = body?.tier;
  if (!isSubscriptionTier(tier)) {
    return json({ error: 'tier must be a valid subscription tier' }, 400);
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : undefined;
  if (reason && reason.length > MAX_REASON_LENGTH) {
    return json({ error: `reason must be at most ${MAX_REASON_LENGTH} characters` }, 400);
  }

  let expiresAt: Date | null = null;
  if (body?.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'string') {
      return json({ error: 'expiresAt must be an ISO 8601 date string or null' }, 400);
    }
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return json({ error: 'expiresAt must be a valid ISO 8601 date string' }, 400);
    }
    if (parsed.getTime() <= Date.now()) {
      return json({ error: 'expiresAt must be in the future' }, 400);
    }
    expiresAt = parsed;
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  const subscription: AttachedSubscription = {
    id: randomUUID(),
    tier,
    createdAt: new Date(),
    expiresAt,
    addedByUuid: staffUser.uuid,
    addedByUsername: staffUser.username,
    reason,
  };

  await addAttachedSubscription(targetUuid, subscription);

  staffActionsTotal.inc({ action: 'subscription_attach' });

  return json({
    user: toPublicUser({
      ...targetUser,
      attachedSubscriptions: [...(targetUser.attachedSubscriptions ?? []), subscription],
    }),
  }, 201);
});

const handleStaffSubscriptionDetach = requireRole('staff', async (_request, _staffUser, params) => {
  const targetUuid = params.uuid;
  const subscriptionId = params.id;

  if (!targetUuid || !subscriptionId) {
    return json({ error: 'user uuid and subscription id are required' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  const existing = (targetUser.attachedSubscriptions ?? []).some((subscription) => subscription.id === subscriptionId);
  if (!existing) {
    return json({ error: 'subscription not found' }, 404);
  }

  await removeAttachedSubscription(targetUuid, subscriptionId);

  staffActionsTotal.inc({ action: 'subscription_detach' });

  return json({
    user: toPublicUser({
      ...targetUser,
      attachedSubscriptions: (targetUser.attachedSubscriptions ?? []).filter((subscription) => subscription.id !== subscriptionId),
    }),
  });
});

const handleStaffSubscriptionList = requireRole('staff', async (_request, _staffUser, params) => {
  const targetUuid = params.uuid;
  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const subscriptions = await getAttachedSubscriptionsForUserUuid(targetUuid);
  return json({ subscriptions });
});

const handleStaffSubscriptionUpdate = requireRole('staff', async (request, _staffUser, params) => {
  const targetUuid = params.uuid;
  const subscriptionId = params.id;

  if (!targetUuid || !subscriptionId) {
    return json({ error: 'user uuid and subscription id are required' }, 400);
  }

  const body = await readJsonBody(request);
  if (!body) {
    return json({ error: 'invalid request body' }, 400);
  }

  const subscriptions = await getAttachedSubscriptionsForUserUuid(targetUuid);
  const existing = subscriptions.find((subscription) => subscription.id === subscriptionId);
  if (!existing) {
    return json({ error: 'subscription not found' }, 404);
  }

  if (body.tier !== undefined) {
    if (!isSubscriptionTier(body.tier)) {
      return json({ error: 'tier must be a valid subscription tier' }, 400);
    }
    existing.tier = body.tier;
  }

  if (body.reason !== undefined) {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > MAX_REASON_LENGTH) {
      return json({ error: `reason must be at most ${MAX_REASON_LENGTH} characters` }, 400);
    }
    existing.reason = reason || undefined;
  }

  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null) {
      existing.expiresAt = null;
    } else if (typeof body.expiresAt === 'string') {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return json({ error: 'expiresAt must be a valid ISO 8601 date string' }, 400);
      }
      existing.expiresAt = parsed;
    } else {
      return json({ error: 'expiresAt must be an ISO 8601 date string or null' }, 400);
    }
  }

  const updated = await updateAttachedSubscription(targetUuid, existing);
  if (!updated) {
    return json({ error: 'subscription not found' }, 404);
  }

  staffActionsTotal.inc({ action: 'subscription_update' });

  return json({ subscription: updated });
});

export {
  handleUsersSummary,
  handleStaffUsers,
  handleStaffPunishments,
  handleStaffPunishmentLift,
  handleStaffRoleUpdate,
  handleStaffPasswordUpdate,
  handleStaffSubscriptionAttach,
  handleStaffSubscriptionDetach,
  handleStaffSubscriptionList,
  handleStaffSubscriptionUpdate,
};