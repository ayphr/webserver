import { randomInt, timingSafeEqual } from 'node:crypto';
import { EMAIL_CODE_LENGTH, getEmailValidationError, normalizeEmail } from '@common';
import { EMAIL_CODE_TTL_MS } from '../../env';
import {
  createEmailCode,
  deleteEmailCodeByHash,
  deleteEmailCodesForTarget,
  getEmailCodeForTarget,
  incrementEmailCodeAttempts,
  markEmailCodeUsed,
} from '../db';
import type { EmailCodePurpose } from '../db/internal';
import { hashToken } from '../tokens';
export type { EmailCodePurpose } from '../db/internal';
import { createRateLimiter } from '../rateLimit';
import { buildCodeEmail } from './templates';
import { sendEmail } from './sender';

const MAX_VERIFY_ATTEMPTS = 5;
const SEND_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const SEND_RATE_LIMIT_MAX = 5;

const sendLimiter = createRateLimiter(SEND_RATE_LIMIT_WINDOW_MS, SEND_RATE_LIMIT_MAX, 'email-code');

export type SendEmailCodeResult =
  | { status: 'sent'; expiresAt: Date }
  | { status: 'rate_limited'; retryAfterMs: number }
  | { status: 'not_configured' }
  | { status: 'send_failed' };

export type VerifyEmailCodeResult = { status: 'verified' } | { status: 'invalid' };

function generateCode(): string {
  let code = '';
  for (let i = 0; i < EMAIL_CODE_LENGTH; i += 1) {
    code += String(randomInt(10));
  }
  return code;
}

export async function sendEmailCode(params: {
  email: string;
  purpose: EmailCodePurpose;
  userUuid?: string;
}): Promise<SendEmailCodeResult> {
  const email = normalizeEmail(params.email);
  if (getEmailValidationError(email)) {
    return { status: 'send_failed' };
  }

  const rateCheck = await sendLimiter.check(`${params.purpose}:${email}`);
  if (!rateCheck.allowed) {
    return { status: 'rate_limited', retryAfterMs: rateCheck.retryAfterMs };
  }

  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MS);

  await deleteEmailCodesForTarget(email, params.purpose, params.userUuid);
  await createEmailCode({
    codeHash: hashToken(code),
    email,
    purpose: params.purpose,
    ...(params.userUuid ? { userUuid: params.userUuid } : {}),
    createdAt: now,
    expiresAt,
    attempts: 0,
  });

  const template = buildCodeEmail({
    purpose: params.purpose,
    code,
    ttlMinutes: Math.round(EMAIL_CODE_TTL_MS / (60 * 1000)),
  });

  const sendResult = await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.sent) {
    await deleteEmailCodeByHash(hashToken(code));
    return { status: sendResult.reason };
  }

  return { status: 'sent', expiresAt };
}

export async function verifyEmailCode(params: {
  email: string;
  purpose: EmailCodePurpose;
  code: string;
  userUuid?: string;
}): Promise<VerifyEmailCodeResult> {
  const email = normalizeEmail(params.email);
  const stored = await getEmailCodeForTarget(email, params.purpose, params.userUuid);
  if (!stored) return { status: 'invalid' };

  if (stored.used || stored.expiresAt.getTime() <= Date.now() || stored.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { status: 'invalid' };
  }

  const expectedBuffer = Buffer.from(stored.codeHash, 'hex');
  const computedBuffer = Buffer.from(hashToken(params.code.trim()), 'hex');
  const matches =
    expectedBuffer.length === computedBuffer.length && timingSafeEqual(expectedBuffer, computedBuffer);

  if (!matches) {
    await incrementEmailCodeAttempts(stored.codeHash);
    return { status: 'invalid' };
  }

  const consumed = await markEmailCodeUsed(stored.codeHash);
  if (!consumed) return { status: 'invalid' };

  return { status: 'verified' };
}