import { isDuplicateKeyError, json, readJsonBody } from '../../lib/http';
import {
  createPasswordHash,
  endAllSessions,
  endCurrentSession,
  endOtherSessions,
  getCachedActiveSuspension,
  requireAuth,
  startSession,
  verifyPassword,
} from '../auth';
import {
  createUser,
  deleteAvatar,
  deleteDevicesForOwnerUuid,
  deletePunishmentsForUserUuid,
  deleteSessionsForUserUuid,
  deleteUser,
  getActiveSuspensionForUserUuid,
  getUserFromUsername,
  updateUser,
} from '../../lib/db';
import type { User } from '@common';
import { normalizeCountryCode } from '@common';
import { toPublicUser } from '../../lib/user';
import { DEFAULT_BIO } from '@common/utils/markdown';
import { getPasswordValidationErrors } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { authEventsTotal, userRegistrationsByCountry } from '../../lib/metrics';
import { getPolicyStatus, getPolicyVersions } from '../../lib/policies';

type AuthPayload = {
  username?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
  country?: string;
  acceptPolicies?: boolean;
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

const POLICY_FETCH_ERROR = 'Unable to load the latest policies, please try again later';

const registerLimiter = createRateLimiter(60 * 60 * 1000, 10, 'register');
const loginLimiter = createRateLimiter(15 * 60 * 1000, 20, 'login');
async function handleRegister(request: Request) {
  const ipCheck = await registerLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'register', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const body = await readJsonBody<AuthPayload>(request);

  if (!body?.username || !body.password) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  const usernameError = getUsernameValidationError(username);
  if (usernameError) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: usernameError }, 400);
  }

  if (body.acceptPolicies !== true) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: 'You must agree to the Terms of Service and Privacy Policy' }, 400);
  }

  const passwordValidationErrors = getPasswordValidationErrors(password);
  if (passwordValidationErrors.length > 0) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  const policyVersions = await getPolicyVersions();
  if (!policyVersions) {
    authEventsTotal.inc({ event: 'register', result: 'error' });
    return json({ error: POLICY_FETCH_ERROR }, 503);
  }

  let country: string | undefined;
  if (typeof body.country === 'string') {
    const countryCode = normalizeCountryCode(body.country);
    if (!countryCode) {
      authEventsTotal.inc({ event: 'register', result: 'invalid' });
      return json({ error: 'country must be a valid ISO 3166-1 alpha-2 code' }, 400);
    }
    country = countryCode;
  }

  const now = new Date();
  const user: User = {
    uuid: crypto.randomUUID(),
    username,
    role: 'user',
    bio: DEFAULT_BIO,
    socialLinks: {},
    policyAgreements: {
      tos: policyVersions.tos,
      privacy: policyVersions.privacy,
    },
    auth: {
      passwordHash: await createPasswordHash(password),
    },
    createdAt: now,
    lastActive: now,
    country,
  };

  try {
    await createUser(user);
  } catch (error) {
    // The unique username index is the source of truth, closing the check-then-insert race.
    if (isDuplicateKeyError(error) || (await getUserFromUsername(username))) {
      authEventsTotal.inc({ event: 'register', result: 'conflict' });
      return json({ error: 'username already exists' }, 409);
    }
    throw error;
  }

  authEventsTotal.inc({ event: 'register', result: 'success' });
  userRegistrationsByCountry.inc({ country: country ?? 'unknown' });

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  const policyStatus = await getPolicyStatus(user);

  return json({ user: toPublicUser(user), token, policyStatus }, 201);
}

async function handleLogin(request: Request) {
  const ipCheck = await loginLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'login', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const body = await readJsonBody<AuthPayload>(request);

  if (!body?.username || !body.password) {
    authEventsTotal.inc({ event: 'login', result: 'invalid' });
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  const userCheck = await loginLimiter.check(`user:${username.toLowerCase()}`);
  if (!userCheck.allowed) {
    authEventsTotal.inc({ event: 'login', result: 'rate_limited' });
    return tooManyRequests(userCheck.retryAfterMs);
  }

  const user = await getUserFromUsername(username);
  if (!user || !(await verifyPassword(password, user.auth.passwordHash))) {
    authEventsTotal.inc({ event: 'login', result: 'invalid_credentials' });
    return json({ error: 'invalid username or password' }, 401);
  }

  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  authEventsTotal.inc({ event: 'login', result: 'success' });

  const policyStatus = await getPolicyStatus(user);

  return json({
    user: toPublicUser(user),
    token,
    suspension: activeSuspension,
    policyStatus,
  });
}

const handleMe = requireAuth(async (request, user) => {
  const activeSuspension = getCachedActiveSuspension(request) ?? await getActiveSuspensionForUserUuid(user.uuid);
  const policyStatus = await getPolicyStatus(user);

  return json({
    user: toPublicUser(user),
    suspension: activeSuspension,
    policyStatus,
  });
}, { allowSuspended: true, allowPolicyPending: true });

const handleLogout = requireAuth(async (request) => {
  await endCurrentSession(request);
  authEventsTotal.inc({ event: 'logout', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleLogoutAll = requireAuth(async (_request, user) => {
  await endAllSessions(user);
  authEventsTotal.inc({ event: 'logout_all', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleLogoutOthers = requireAuth(async (request, user) => {
  await endOtherSessions(user, request);
  authEventsTotal.inc({ event: 'logout_others', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleAcceptPolicies = requireAuth(async (_request, user) => {
  const policyVersions = await getPolicyVersions();
  if (!policyVersions) {
    authEventsTotal.inc({ event: 'policy_accept', result: 'error' });
    return json({ error: POLICY_FETCH_ERROR }, 503);
  }

  user.policyAgreements = {
    tos: policyVersions.tos,
    privacy: policyVersions.privacy,
  };
  await updateUser(user);
  authEventsTotal.inc({ event: 'policy_accept', result: 'success' });

  const policyStatus = await getPolicyStatus(user);

  return json({ user: toPublicUser(user), policyStatus });
}, { allowSuspended: true, allowPolicyPending: true });

const handleChangePassword = requireAuth(async (request, user) => {
  const body = await readJsonBody<AuthPayload>(request);

  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : undefined;
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : undefined;

  if (!currentPassword) {
    authEventsTotal.inc({ event: 'password_change', result: 'invalid' });
    return json({ error: 'current password is required' }, 400);
  }

  if (!newPassword) {
    authEventsTotal.inc({ event: 'password_change', result: 'invalid' });
    return json({ error: 'new password is required' }, 400);
  }

  if (!(await verifyPassword(currentPassword, user.auth.passwordHash))) {
    authEventsTotal.inc({ event: 'password_change', result: 'invalid_credentials' });
    return json({ error: 'invalid current password' }, 401);
  }

  const passwordValidationErrors = getPasswordValidationErrors(newPassword);
  if (passwordValidationErrors.length > 0) {
    authEventsTotal.inc({ event: 'password_change', result: 'invalid' });
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  user.auth.passwordHash = await createPasswordHash(newPassword);
  await updateUser(user);

  // Changing the password signs out every device, including this one.
  await endAllSessions(user);
  authEventsTotal.inc({ event: 'password_change', result: 'success' });

  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleDeleteAccount = requireAuth(async (request, user) => {
  const body = await readJsonBody<AuthPayload>(request);

  if (!body?.password) {
    authEventsTotal.inc({ event: 'account_delete', result: 'invalid' });
    return json({ error: 'password is required' }, 400);
  }

  if (!(await verifyPassword(body.password, user.auth.passwordHash))) {
    authEventsTotal.inc({ event: 'account_delete', result: 'invalid_credentials' });
    return json({ error: 'invalid password' }, 401);
  }

  await Promise.all([
    deletePunishmentsForUserUuid(user.uuid),
    deleteDevicesForOwnerUuid(user.uuid),
    deleteSessionsForUserUuid(user.uuid),
    deleteAvatar(user.uuid),
  ]);
  await deleteUser(user.uuid);
  authEventsTotal.inc({ event: 'account_delete', result: 'success' });

  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleRegister, handleLogin, handleMe, handleLogout, handleLogoutAll, handleLogoutOthers, handleAcceptPolicies, handleChangePassword, handleDeleteAccount };
