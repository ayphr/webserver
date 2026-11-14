import { json, readValidatedJsonBody } from '../../lib/http';
import { requireAuth, verifyPassword, createPasswordHash, endAllSessions } from '../auth';
import {
  getUserByEmail,
  getUserFromUsername,
  updateUser,
} from '../../lib/db';
import type { User } from '@common';
import { optionalString, requireJsonObject, type JsonObject } from '@common';
import { toSelfUser } from '../../lib/user';
import { getPasswordValidationErrors } from '@common/utils/password';
import { normalizeEmail, getEmailValidationError } from '@common/utils/email';
import { getClientIp } from '../../lib/requestContext';
import { createRateLimiter, tooManyRequests } from '../../lib/rateLimit';
import { authEventsTotal } from '../../lib/metrics';
import { verifyEmailCode, sendEmailCode, buildNotificationEmail, sendEmail } from '../../lib/email';
import { notifyUser } from '../../lib/notifications';

type EmailPayload = JsonObject & {
  email?: string;
  code?: string;
  identifier?: string;
  currentPassword?: string;
  newPassword?: string;
};

function validateEmailPayload(value: unknown): EmailPayload {
  const body = requireJsonObject(value);
  return {
    ...body,
    email: optionalString(body, 'email', { maxLength: 254 }),
    code: optionalString(body, 'code', { maxLength: 32 }),
    identifier: optionalString(body, 'identifier', { maxLength: 254 }),
    currentPassword: optionalString(body, 'currentPassword', { maxLength: 256, trim: false }),
    newPassword: optionalString(body, 'newPassword', { maxLength: 256, trim: false }),
  };
}

function resolveUser(identifier: string): Promise<User | null> {
  const trimmed = identifier.trim();
  if (trimmed.includes('@')) {
    return getUserByEmail(normalizeEmail(trimmed));
  }
  return getUserFromUsername(trimmed);
}

const emailCodeRequestLimiter = createRateLimiter(15 * 60 * 1000, 10, 'email-code-request');
const passwordForgotLimiter = createRateLimiter(15 * 60 * 1000, 5, 'password-forgot');
const passwordForgotUserLimiter = createRateLimiter(15 * 60 * 1000, 3, 'password-forgot-user');
const passwordResetLimiter = createRateLimiter(15 * 60 * 1000, 10, 'password-reset');

async function handleRequestEmailCode(request: Request) {
  const ipCheck = await emailCodeRequestLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'email_code', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateEmailPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  const email = body.email ? normalizeEmail(body.email) : '';
  const emailError = getEmailValidationError(email);
  if (emailError) {
    authEventsTotal.inc({ event: 'email_code', result: 'invalid' });
    return json({ error: emailError }, 400);
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    authEventsTotal.inc({ event: 'email_code', result: 'conflict' });
    return json({ error: 'email is already registered' }, 409);
  }

  const result = await sendEmailCode({ email, purpose: 'register' });
  switch (result.status) {
    case 'sent':
      authEventsTotal.inc({ event: 'email_code', result: 'sent' });
      return json({ expiresAt: result.expiresAt }, 201);
    case 'rate_limited':
      authEventsTotal.inc({ event: 'email_code', result: 'rate_limited' });
      return tooManyRequests(result.retryAfterMs);
    case 'not_configured':
      authEventsTotal.inc({ event: 'email_code', result: 'error' });
      return json({ error: 'email delivery is not configured, please try again later' }, 503);
    case 'send_failed':
      authEventsTotal.inc({ event: 'email_code', result: 'error' });
      return json({ error: 'failed to send email, please try again later' }, 502);
  }
}

async function handleForgotPassword(request: Request) {
  const ipCheck = await passwordForgotLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'password_forgot', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateEmailPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  const identifier = body.identifier?.trim();
  if (!identifier) {
    authEventsTotal.inc({ event: 'password_forgot', result: 'invalid' });
    return json({ error: 'email or username is required' }, 400);
  }

  const userCheck = await passwordForgotUserLimiter.check(`id:${identifier.toLowerCase()}`);
  if (!userCheck.allowed) {
    authEventsTotal.inc({ event: 'password_forgot', result: 'rate_limited' });
    return tooManyRequests(userCheck.retryAfterMs);
  }

  const user = await resolveUser(identifier);
  if (user?.email && user.emailVerifiedAt) {
    const result = await sendEmailCode({ email: user.email, purpose: 'reset', userUuid: user.uuid });
    if (result.status === 'sent') {
      authEventsTotal.inc({ event: 'password_forgot', result: 'sent' });
    } else if (result.status === 'rate_limited') {
      authEventsTotal.inc({ event: 'password_forgot', result: 'rate_limited' });
    } else {
      authEventsTotal.inc({ event: 'password_forgot', result: 'error' });
    }
  } else {
    authEventsTotal.inc({ event: 'password_forgot', result: 'not_found' });
  }

  return json({ message: 'If an account exists with that email, a code has been sent to it' }, 200);
}

async function handleResetPassword(request: Request) {
  const ipCheck = await passwordResetLimiter.check(`ip:${getClientIp(request)}`);
  if (!ipCheck.allowed) {
    authEventsTotal.inc({ event: 'password_reset', result: 'rate_limited' });
    return tooManyRequests(ipCheck.retryAfterMs);
  }

  const parsed = await readValidatedJsonBody(request, validateEmailPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  const identifier = body.identifier?.trim();
  const code = body.code?.trim();
  const newPassword = body.newPassword;

  if (!identifier || !code || !newPassword) {
    authEventsTotal.inc({ event: 'password_reset', result: 'invalid' });
    return json({ error: 'email or username, code, and new password are required' }, 400);
  }

  const user = await resolveUser(identifier);
  if (!user?.email || !user.emailVerifiedAt) {
    authEventsTotal.inc({ event: 'password_reset', result: 'invalid' });
    return json({ error: 'invalid or expired code' }, 400);
  }

  const passwordErrors = getPasswordValidationErrors(newPassword);
  if (passwordErrors.length > 0) {
    authEventsTotal.inc({ event: 'password_reset', result: 'invalid' });
    return json({ error: passwordErrors[0] }, 400);
  }

  const verifyResult = await verifyEmailCode({ email: user.email, purpose: 'reset', code, userUuid: user.uuid });
  if (verifyResult.status !== 'verified') {
    authEventsTotal.inc({ event: 'password_reset', result: 'invalid_code' });
    return json({ error: 'invalid or expired code' }, 400);
  }

  user.auth.passwordHash = await createPasswordHash(newPassword);
  user.trustedDevices = [];
  await updateUser(user);
  await endAllSessions(user);

  authEventsTotal.inc({ event: 'password_reset', result: 'success' });

  await notifyUser({
    userUuid: user.uuid,
    type: 'security',
    title: 'Your password was reset',
    message: 'The password for your account was reset and all devices were signed out.',
    link: '/dashboard?tab=account-settings',
  });

  if (user.email) {
    const template = buildNotificationEmail({
      subject: 'Your Ayphr password was reset',
      heading: 'Password reset',
      intro: 'The password for your Ayphr account was just reset.',
      lines: ['If you made this change, no further action is needed.'],
    });
    void sendEmail({ to: user.email, subject: template.subject, html: template.html, text: template.text });
  }

  return new Response(null, { status: 204 });
}

const handleEmailChangeRequest = requireAuth(async (request, user) => {
  const parsed = await readValidatedJsonBody(request, validateEmailPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  const email = body.email ? normalizeEmail(body.email) : '';
  const currentPassword = body.currentPassword;

  const emailError = getEmailValidationError(email);
  if (emailError) {
    authEventsTotal.inc({ event: 'email_change', result: 'invalid' });
    return json({ error: emailError }, 400);
  }

  if (!currentPassword) {
    authEventsTotal.inc({ event: 'email_change', result: 'invalid' });
    return json({ error: 'current password is required' }, 400);
  }

  if (!(await verifyPassword(currentPassword, user.auth.passwordHash))) {
    authEventsTotal.inc({ event: 'email_change', result: 'invalid_credentials' });
    return json({ error: 'invalid current password' }, 401);
  }

  if (email === user.email) {
    authEventsTotal.inc({ event: 'email_change', result: 'invalid' });
    return json({ error: 'this is already your email' }, 400);
  }

  const existing = await getUserByEmail(email);
  if (existing && existing.uuid !== user.uuid) {
    authEventsTotal.inc({ event: 'email_change', result: 'conflict' });
    return json({ error: 'email is already registered' }, 409);
  }

  const result = await sendEmailCode({ email, purpose: 'change', userUuid: user.uuid });
  switch (result.status) {
    case 'sent':
      authEventsTotal.inc({ event: 'email_change', result: 'sent' });
      return json({ expiresAt: result.expiresAt }, 200);
    case 'rate_limited':
      authEventsTotal.inc({ event: 'email_change', result: 'rate_limited' });
      return tooManyRequests(result.retryAfterMs);
    case 'not_configured':
      authEventsTotal.inc({ event: 'email_change', result: 'error' });
      return json({ error: 'email delivery is not configured, please try again later' }, 503);
    case 'send_failed':
      authEventsTotal.inc({ event: 'email_change', result: 'error' });
      return json({ error: 'failed to send email, please try again later' }, 502);
  }
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

const handleEmailConfirm = requireAuth(async (request, user) => {
  const parsed = await readValidatedJsonBody(request, validateEmailPayload);
  if ('error' in parsed) return parsed.error;
  const body = parsed.value;

  const email = body.email ? normalizeEmail(body.email) : '';
  const code = body.code?.trim();

  const emailError = getEmailValidationError(email);
  if (emailError) {
    authEventsTotal.inc({ event: 'email_confirm', result: 'invalid' });
    return json({ error: emailError }, 400);
  }
  if (!code) {
    authEventsTotal.inc({ event: 'email_confirm', result: 'invalid' });
    return json({ error: 'code is required' }, 400);
  }

  const verifyResult = await verifyEmailCode({ email, purpose: 'change', code, userUuid: user.uuid });
  if (verifyResult.status !== 'verified') {
    authEventsTotal.inc({ event: 'email_confirm', result: 'invalid_code' });
    return json({ error: 'invalid or expired code' }, 400);
  }

  const previousEmail = user.email && user.email !== email ? user.email : null;

  user.email = email;
  user.emailVerifiedAt = new Date();
  user.trustedDevices = [];
  await updateUser(user);

  authEventsTotal.inc({ event: 'email_confirm', result: 'success' });

  await notifyUser({
    userUuid: user.uuid,
    type: 'security',
    title: 'Your email address was changed',
    message: `Your account email address is now ${email}.`,
    link: '/dashboard?tab=account-settings',
  });

  if (previousEmail) {
    const template = buildNotificationEmail({
      subject: 'Your Ayphr email was changed',
      heading: 'Email changed',
      intro: 'The email address on your Ayphr account was just changed.',
      lines: [`Your new email address is ${email}.`],
    });
    void sendEmail({ to: previousEmail, subject: template.subject, html: template.html, text: template.text });
  }

  const welcome = buildNotificationEmail({
    subject: 'Your Ayphr email is confirmed',
    heading: 'Email confirmed',
    intro: 'Your email address has been confirmed for your Ayphr account.',
    lines: ['You can now use this address for account recovery.'],
  });
  void sendEmail({ to: email, subject: welcome.subject, html: welcome.html, text: welcome.text });

  return json({ user: toSelfUser(user) }, 200);
}, { allowSuspended: true, allowPolicyPending: true, allowEmailMissing: true });

export {
  handleRequestEmailCode,
  handleForgotPassword,
  handleResetPassword,
  handleEmailChangeRequest,
  handleEmailConfirm,
};