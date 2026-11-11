import { isDuplicateKeyError, json, readJsonBody, readValidatedJsonBody } from '../../lib/http';
import {
  createPasswordHash,
  endAllSessions,
  endCurrentSession,
  endOtherSessions,
  getCachedActiveSuspension,
  getExpiryDate,
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
import { getCreditPeriodStart, normalizeCountryCode, optionalBoolean, optionalString, requireJsonObject, type JsonObject } from '@common';
import { toSelfUser } from '../../lib/user';
import { DEFAULT_BIO } from '@common/utils/markdown';
import { getPasswordValidationErrors } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';
import { normalizeEmail, getEmailValidationError } from '@common/utils/email';
import { getUserByEmail } from '../../lib/db';
import { verifyEmailCode, sendEmailCode, buildNotificationEmail, sendEmail } from '../../lib/email';
import { hashToken } from '../../lib/tokens';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { authEventsTotal, userRegistrationsByCountry } from '../../lib/metrics';
import { getUserCount } from '../../lib/db/users';
import { setTotalUsers } from '../../lib/metrics';
import { getPolicyStatus, getPolicyVersions } from '../../lib/policies';

type AuthPayload = JsonObject & {
  username?: string;
  password?: string;
  email?: string;
  code?: string;
  currentPassword?: string;
  newPassword?: string;
  country?: string;
  acceptPolicies?: boolean;
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

function validateAuthPayload(value: unknown): AuthPayload {
  const body = requireJsonObject(value);
  return {
    ...body,
    username: optionalString(body, 'username', { maxLength: 64 }),
    password: optionalString(body, 'password', { maxLength: 256, trim: false }),
    email: optionalString(body, 'email', { maxLength: 254 }),
    code: optionalString(body, 'code', { maxLength: 32 }),
    currentPassword: optionalString(body, 'currentPassword', { maxLength: 256, trim: false }),
    newPassword: optionalString(body, 'newPassword', { maxLength: 256, trim: false }),
    country: optionalString(body, 'country', { maxLength: 2 }),
    acceptPolicies: optionalBoolean(body, 'acceptPolicies'),
    timezone: optionalString(body, 'timezone', { maxLength: 64 }),
    locale: optionalString(body, 'locale', { maxLength: 64 }),
    deviceType: optionalString(body, 'deviceType', { maxLength: 32 }),
  };
}

const POLICY_FETCH_ERROR = 'Unable to load the latest policies, please try again later';

const registerLimiter = createRateLimiter(60 * 60 * 1000, 10, 'register');

function deviceFingerprint(request: Request): string | null {
  const userAgent = request.headers.get('user-agent');
  if (!userAgent) return null;
  return hashToken(userAgent);
}
const loginLimiter = createRateLimiter(15 * 60 * 1000, 20, 'login');
async function handleRegister(request: Request) {
  const ipCheck = await registerLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'register', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateAuthPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

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

  const email = body.email ? normalizeEmail(body.email) : '';
  const emailError = getEmailValidationError(email);
  if (emailError) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: emailError }, 400);
  }
  if (!body.code) {
    authEventsTotal.inc({ event: 'register', result: 'invalid' });
    return json({ error: 'email verification code is required' }, 400);
  }

  const verifyResult = await verifyEmailCode({ email, purpose: 'register', code: body.code });
  if (verifyResult.status !== 'verified') {
    authEventsTotal.inc({ event: 'register', result: 'invalid_code' });
    return json({ error: 'invalid or expired email verification code' }, 400);
  }

  const existingEmail = await getUserByEmail(email);
  if (existingEmail) {
    authEventsTotal.inc({ event: 'register', result: 'conflict' });
    return json({ error: 'email is already registered' }, 409);
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
    email,
    emailVerifiedAt: now,
    trustedDevices: deviceFingerprint(request) ? [deviceFingerprint(request)!] : undefined,
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
    credits: {
      periodStart: getCreditPeriodStart(now),
      monthlyUsed: 0,
      additional: 0,
      onHold: 0,
    },
  };

  try {
    await createUser(user);
  } catch (error) {
    // The unique username/email indexes are the source of truth, closing the
    // check-then-insert race.
    if (isDuplicateKeyError(error)) {
      const [existingUsername, existingEmail] = await Promise.all([
        getUserFromUsername(username),
        getUserByEmail(email),
      ]);
      if (existingUsername) {
        authEventsTotal.inc({ event: 'register', result: 'conflict' });
        return json({ error: 'username already exists' }, 409);
      }
      if (existingEmail) {
        authEventsTotal.inc({ event: 'register', result: 'conflict' });
        return json({ error: 'email is already registered' }, 409);
      }
      authEventsTotal.inc({ event: 'register', result: 'conflict' });
      return json({ error: 'username already exists' }, 409);
    }
    throw error;
  }

  authEventsTotal.inc({ event: 'register', result: 'success' });
  userRegistrationsByCountry.inc({ country: country ?? 'unknown' });
  try {
    setTotalUsers(await getUserCount());
  } catch {
    // best effort
  }

  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  const policyStatus = await getPolicyStatus(user);

  return json({ user: toSelfUser(user), token, policyStatus, expiresAt: getExpiryDate(now) }, 201);
}

async function handleLogin(request: Request) {
  const ipCheck = await loginLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'login', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateAuthPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

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

  const fingerprint = deviceFingerprint(request);
  const trusted = user.trustedDevices ?? [];
  const isNewDevice = Boolean(fingerprint) && trusted.length > 0 && !trusted.includes(fingerprint!) && Boolean(user.email && user.emailVerifiedAt);

  if (isNewDevice) {
    const result = await sendEmailCode({ email: user.email!, purpose: 'login', userUuid: user.uuid });
    if (result.status === 'sent') {
      authEventsTotal.inc({ event: 'login', result: 'device_verification' });
      return json({ requiresDeviceVerification: true, expiresAt: result.expiresAt }, 200);
    }
    if (result.status === 'rate_limited') {
      authEventsTotal.inc({ event: 'login', result: 'rate_limited' });
      return tooManyRequests(result.retryAfterMs);
    }
    // Fall through to normal login if email delivery fails, to avoid lockout.
    authEventsTotal.inc({ event: 'login', result: 'email_delivery_failed' });
  }

  // Trust this device (first login or already trusted).
  if (fingerprint && !trusted.includes(fingerprint)) {
    user.trustedDevices = [...trusted, fingerprint];
    await updateUser(user);
  }

  const now = new Date();
  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  authEventsTotal.inc({ event: 'login', result: 'success' });

  const policyStatus = await getPolicyStatus(user);

  return json({
    user: toSelfUser(user),
    token,
    suspension: activeSuspension,
    policyStatus,
    expiresAt: getExpiryDate(now),
  });
}

const loginVerifyLimiter = createRateLimiter(15 * 60 * 1000, 10, 'login-verify');

async function handleVerifyLogin(request: Request) {
  const ipCheck = await loginVerifyLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'login_verify', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateAuthPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  if (!body?.username || !body.code) {
    authEventsTotal.inc({ event: 'login_verify', result: 'invalid' });
    return json({ error: 'username and verification code are required' }, 400);
  }

  const username = body.username.trim();
  const code = body.code.trim();

  const user = await getUserFromUsername(username);
  if (!user || !user.email || !user.emailVerifiedAt) {
    authEventsTotal.inc({ event: 'login_verify', result: 'invalid' });
    return json({ error: 'invalid or expired code' }, 400);
  }

  const verifyResult = await verifyEmailCode({ email: user.email, purpose: 'login', code, userUuid: user.uuid });
  if (verifyResult.status !== 'verified') {
    authEventsTotal.inc({ event: 'login_verify', result: 'invalid_code' });
    return json({ error: 'invalid or expired code' }, 400);
  }

  const fingerprint = deviceFingerprint(request);
  const trusted = user.trustedDevices ?? [];
  if (fingerprint && !trusted.includes(fingerprint)) {
    user.trustedDevices = [...trusted, fingerprint];
    await updateUser(user);
  }

  const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);

  const now = new Date();
  const token = await startSession(user, request, { timezone: body.timezone, locale: body.locale, deviceType: body.deviceType });

  authEventsTotal.inc({ event: 'login_verify', result: 'success' });

  const policyStatus = await getPolicyStatus(user);

  return json({
    user: toSelfUser(user),
    token,
    suspension: activeSuspension,
    policyStatus,
    expiresAt: getExpiryDate(now),
  });
}

const handleMe = requireAuth(async (request, user) => {
  const activeSuspension = getCachedActiveSuspension(request) ?? await getActiveSuspensionForUserUuid(user.uuid);
  const policyStatus = await getPolicyStatus(user);

  return json({
    user: toSelfUser(user),
    suspension: activeSuspension,
    policyStatus,
  });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleLogout = requireAuth(async (request) => {
  await endCurrentSession(request);
  authEventsTotal.inc({ event: 'logout', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleLogoutAll = requireAuth(async (_request, user) => {
  await endAllSessions(user);
  authEventsTotal.inc({ event: 'logout_all', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleLogoutOthers = requireAuth(async (request, user) => {
  await endOtherSessions(user, request);
  authEventsTotal.inc({ event: 'logout_others', result: 'success' });
  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

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

  return json({ user: toSelfUser(user), policyStatus });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

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
  user.trustedDevices = [];
  await updateUser(user);

  // Changing the password signs out every device, including this one.
  await endAllSessions(user);
  authEventsTotal.inc({ event: 'password_change', result: 'success' });

  if (user.email) {
    const template = buildNotificationEmail({
      subject: 'Your Ayphr password was changed',
      heading: 'Password changed',
      intro: 'The password for your Ayphr account was just changed.',
      lines: ['If you made this change, no further action is needed.'],
    });
    void sendEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
  }

  return new Response(null, { status: 204 });
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

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
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

export { handleRegister, handleLogin, handleVerifyLogin, handleMe, handleLogout, handleLogoutAll, handleLogoutOthers, handleAcceptPolicies, handleChangePassword, handleDeleteAccount };
