import {
  createPasswordHash,
  endAllSessions,
  endCurrentSession,
  requireAuth,
  startSession,
  verifyPassword,
} from '../auth';
import {
  createUser,
  deleteDevicesForOwnerUuid,
  deletePunishmentsForUserUuid,
  deleteSessionsForUserUuid,
  deleteUser,
  getActiveSuspensionForUserUuid,
  getUserFromUsername,
  updateUser,
} from '../../workers/dbWriter';
import type { User } from '@common';
import { normalizeCountryCode } from '../../lib/country';
import { DEFAULT_BIO } from '@common/utils/markdown';
import { getPasswordValidationErrors } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { getPolicyStatus, getPolicyVersions } from '../../lib/policies';

type AuthPayload = {
  username?: string;
  password?: string;
  country?: string;
  acceptPolicies?: boolean;
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

const POLICY_FETCH_ERROR = 'Unable to load the latest policies, please try again later';

const registerLimiter = createRateLimiter(60 * 60 * 1000, 10);
const loginLimiter = createRateLimiter(15 * 60 * 1000, 20);

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

async function readJsonBody(request: Request): Promise<AuthPayload | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return null;
  }

  try {
    return await request.json() as AuthPayload;
  } catch {
    return null;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

async function handleRegister(request: Request) {
  const ipCheck = registerLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  const usernameError = getUsernameValidationError(username);
  if (usernameError) {
    return json({ error: usernameError }, 400);
  }

  if (body.acceptPolicies !== true) {
    return json({ error: 'You must agree to the Terms of Service and Privacy Policy' }, 400);
  }

  const passwordValidationErrors = getPasswordValidationErrors(password);
  if (passwordValidationErrors.length > 0) {
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  const policyVersions = await getPolicyVersions();
  if (!policyVersions) {
    return json({ error: POLICY_FETCH_ERROR }, 503);
  }

  let country: string | undefined;
  if (typeof body.country === 'string') {
    const countryCode = normalizeCountryCode(body.country);
    if (!countryCode) {
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
      return json({ error: 'username already exists' }, 409);
    }
    throw error;
  }

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  const policyStatus = await getPolicyStatus(user);

  return json({ user: publicUser(user), token, policyStatus }, 201);
}

async function handleLogin(request: Request) {
  const ipCheck = loginLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck.retryAfterMs);

  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  const userCheck = loginLimiter.check(`user:${username.toLowerCase()}`);
  if (!userCheck.allowed) return tooManyRequests(userCheck.retryAfterMs);

  const user = await getUserFromUsername(username);
  if (!user || !(await verifyPassword(password, user.auth.passwordHash))) {
    return json({ error: 'invalid username or password' }, 401);
  }

  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  const policyStatus = await getPolicyStatus(user);

  return json({
    user: publicUser(user),
    token,
    suspension: activeSuspension,
    policyStatus,
  });
}

const handleMe = requireAuth(async (_request, user) => {
  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
  const policyStatus = await getPolicyStatus(user);

  return json({
    user: publicUser(user),
    suspension: activeSuspension,
    policyStatus,
  });
}, { allowSuspended: true, allowPolicyPending: true });

const handleLogout = requireAuth(async (request) => {
  await endCurrentSession(request);
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleLogoutAll = requireAuth(async (_request, user) => {
  await endAllSessions(user);
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

const handleAcceptPolicies = requireAuth(async (_request, user) => {
  const policyVersions = await getPolicyVersions();
  if (!policyVersions) {
    return json({ error: POLICY_FETCH_ERROR }, 503);
  }

  user.policyAgreements = {
    tos: policyVersions.tos,
    privacy: policyVersions.privacy,
  };
  await updateUser(user);

  const policyStatus = await getPolicyStatus(user);

  return json({ user: publicUser(user), policyStatus });
}, { allowSuspended: true, allowPolicyPending: true });

const handleDeleteAccount = requireAuth(async (request, user) => {
  const body = await readJsonBody(request);

  if (!body?.password) {
    return json({ error: 'password is required' }, 400);
  }

  if (!(await verifyPassword(body.password, user.auth.passwordHash))) {
    return json({ error: 'invalid password' }, 401);
  }

  await Promise.all([
    deletePunishmentsForUserUuid(user.uuid),
    deleteDevicesForOwnerUuid(user.uuid),
    deleteSessionsForUserUuid(user.uuid),
  ]);
  await deleteUser(user.uuid);

  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleRegister, handleLogin, handleMe, handleLogout, handleLogoutAll, handleAcceptPolicies, handleDeleteAccount };
