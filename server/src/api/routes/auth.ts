import { createPasswordHash, endAllSessions, endCurrentSession, requireAuth, startSession, verifyPassword } from '../auth';
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

async function handleRegister(request: Request) {
  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  if (body.acceptPolicies !== true) {
    return json({ error: 'You must agree to the Terms of Service and Privacy Policy' }, 400);
  }

  const passwordValidationErrors = getPasswordValidationErrors(password);
  if (passwordValidationErrors.length > 0) {
    return json({ error: passwordValidationErrors[0] }, 400);
  }

  const existingUser = await getUserFromUsername(username);
  if (existingUser) {
    return json({ error: 'username already exists' }, 409);
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
      passwordHash: createPasswordHash(password),
    },
    createdAt: now,
    lastActive: now,
    country,
  };

  await createUser(user);

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  const policyStatus = await getPolicyStatus(user);

  return json({ user: publicUser(user), token, policyStatus }, 201);
}

async function handleLogin(request: Request) {
  const body = await readJsonBody(request);

  if (!body?.username || !body.password) {
    return json({ error: 'username and password are required' }, 400);
  }

  const username = body.username.trim();
  const password = body.password.trim();

  const user = await getUserFromUsername(username);
  if (!user || !verifyPassword(password, user.auth.passwordHash)) {
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

const handleLogout = requireAuth(async (request, user) => {
  await endCurrentSession(request, user);
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

const handleDeleteAccount = requireAuth(async (_request, user) => {
  await Promise.all([
    deletePunishmentsForUserUuid(user.uuid),
    deleteDevicesForOwnerUuid(user.uuid),
    deleteSessionsForUserUuid(user.uuid),
  ]);
  await deleteUser(user.uuid);

  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true });

export { handleRegister, handleLogin, handleMe, handleLogout, handleLogoutAll, handleAcceptPolicies, handleDeleteAccount };
