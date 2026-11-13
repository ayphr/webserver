import { json } from '../../lib/http';
import { getCachedActiveSuspension, requireAuth, verifyPassword } from '../auth';
import { getActiveSuspensionForUserUuid, getUserFromUuid, getUserFromUsername, updateUser } from '../../lib/db';
import { getPolicyStatus } from '../../lib/policies';
import { toPublicUser, toSelfUser } from '../../lib/user';
import { getCreditBalance } from '../../lib/credits';
import { getUsernameValidationError } from '@common/utils/username';

const handleMe = requireAuth(async (request, user) => {
  const activeSuspension = getCachedActiveSuspension(request) ?? await getActiveSuspensionForUserUuid(user.uuid);
  const policyStatus = await getPolicyStatus(user);
  return json({
    user: toSelfUser(user),
    activeSuspension,
    policyStatus,
    credits: getCreditBalance(user),
  });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleUserByUuid = requireAuth(async (_request, user, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  return json({ user: toPublicUser(targetUser), requestedBy: toPublicUser(user) });
}, { allowSuspended: true });



const handleDeveloperToggle = requireAuth(async (request, user) => {
  const body = await request.json().catch(() => null) as { enabled?: boolean } | null;
  const enabled = body?.enabled === true;
  user.developerAccount = enabled;
  await updateUser(user);
  return json({ user: toSelfUser(user) });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const USERNAME_CHANGE_COOLDOWN_MS = 29 * 24 * 60 * 60 * 1000;

const handleUsernameChange = requireAuth(async (request, user) => {
  const body = await request.json().catch(() => null) as { username?: string; currentPassword?: string } | null;
  const newUsername = typeof body?.username === 'string' ? body.username.trim() : '';
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';

  const usernameError = getUsernameValidationError(newUsername);
  if (usernameError) {
    return json({ error: usernameError }, 400);
  }

  if (newUsername === user.username) {
    return json({ error: 'new username must be different from your current username' }, 400);
  }

  if (!currentPassword) {
    return json({ error: 'current password is required' }, 400);
  }

  if (!(await verifyPassword(currentPassword, user.auth.passwordHash))) {
    return json({ error: 'invalid current password' }, 401);
  }

  const lastChanged = user.usernameChangedAt ? new Date(user.usernameChangedAt) : null;
  if (lastChanged) {
    const nextAllowed = new Date(lastChanged.getTime() + USERNAME_CHANGE_COOLDOWN_MS);
    if (Date.now() < nextAllowed.getTime()) {
      return json({ error: `You can change your username again on ${nextAllowed.toLocaleDateString('en-GB')}` }, 429);
    }
  }

  const existing = await getUserFromUsername(newUsername);
  if (existing && existing.uuid !== user.uuid) {
    return json({ error: 'username already exists' }, 409);
  }

  user.username = newUsername;
  user.usernameChangedAt = new Date();
  await updateUser(user);

  return json({ user: toSelfUser(user) });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

export { handleMe, handleUserByUuid, handleDeveloperToggle, handleUsernameChange };
