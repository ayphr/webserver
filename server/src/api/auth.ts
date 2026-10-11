import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Session, User, UserRole } from '@common';
import {
  createSession,
  deleteSession,
  deleteSessionsForUserUuid,
  deleteSessionByTokenHash,
  getActiveSuspensionForUserUuid,
  getSessionByTokenHash,
  getUserFromUuid,
  updateSessionLastActive,
  updateUser,
  updateUserLastActive,
} from '../workers/dbWriter';
import { getPolicyStatus } from '../lib/policies';
import { hashToken } from '../lib/tokens';
import { isSessionDeviceType, parseUserAgent, resolveLocationFromClient } from '../lib/session';
import type { RouteParams } from './types';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

export const TOKEN_EXPIRE_DURATION_SECONDS = 48 * 60 * 60; // 48 hours

const SESSION_ACTIVITY_THRESHOLD_MS = 60 * 1000;

const PASSWORD_HASH_ALGORITHM = 'scrypt';
const PASSWORD_HASH_LENGTH = 64;

export type ClientSessionMeta = {
  timezone?: string;
  locale?: string;
  deviceType?: string;
};

export type AuthenticatedHandler = (request: Request, user: User, params: RouteParams) => Promise<Response> | Response;

export type AuthGuardOptions = {
  allowSuspended?: boolean;
  /** Allow access even when the user has not accepted the latest policies. */
  allowPolicyPending?: boolean;
};

export type AuthErrorBody = {
  error: string;
};

export function getAuthError(message: string, status = 401): Response {
  return Response.json({ error: message } satisfies AuthErrorBody, { status });
}

export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, PASSWORD_HASH_LENGTH);
  return `${PASSWORD_HASH_ALGORITHM}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, passwordHash?: string): Promise<boolean> {
  if (!passwordHash) return false;

  const [algorithm, salt, derivedHash] = passwordHash.split('$');
  if (algorithm !== PASSWORD_HASH_ALGORITHM || !salt || !derivedHash) return false;

  const stored = Buffer.from(derivedHash, 'hex');
  const computed = await scrypt(password, salt, PASSWORD_HASH_LENGTH);

  if (computed.length !== stored.length) return false;

  return timingSafeEqual(computed, stored);
}

export async function startSession(user: User, request: Request, meta: ClientSessionMeta = {}) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const parsedUserAgent = parseUserAgent(userAgent);

  const session: Session = {
    id: crypto.randomUUID(),
    userUuid: user.uuid,
    tokenHash: hashToken(token),
    createdAt: now,
    lastActive: now,
    expiresAt: getExpiryDate(now),
    userAgent,
    browser: parsedUserAgent.browser,
    os: parsedUserAgent.os,
    deviceType: isSessionDeviceType(meta.deviceType) ? meta.deviceType : parsedUserAgent.deviceType,
    location: resolveLocationFromClient(meta),
  };

  await createSession(session);

  user.lastActive = now;
  await updateUserLastActive(user.uuid, now);

  return token;
}

export async function endCurrentSession(request: Request) {
  const token = getBearerToken(request);
  if (token) await deleteSessionByTokenHash(hashToken(token));
}

export async function endAllSessions(user: User) {
  await deleteSessionsForUserUuid(user.uuid);
}

export async function createUserRecord(user: User, password: string) {
  user.auth.passwordHash = await createPasswordHash(password);
  await updateUser(user);
  return user;
}

export function getExpiryDate(date: Date): Date {
  return new Date(date.getTime() + TOKEN_EXPIRE_DURATION_SECONDS * 1000);
}

export function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') ?? request.headers.get('Authentication');

  if (!authHeader?.startsWith('Bearer ')) return null;

  return authHeader.substring(7).trim();
}

export async function getUserFromRequest(request: Request): Promise<User | null> {
  const token = getBearerToken(request);

  if (!token) return null;

  const session = await getSessionByTokenHash(hashToken(token));
  if (!session) return null;

  if (Date.now() > session.expiresAt.getTime()) {
    await deleteSession(session.id);
    return null;
  }

  const user = await getUserFromUuid(session.userUuid);
  if (!user) {
    await deleteSession(session.id);
    return null;
  }

  const now = new Date();

  if (now.getTime() - session.lastActive.getTime() > SESSION_ACTIVITY_THRESHOLD_MS) {
    await updateSessionLastActive(session.id, now);
  }

  if (now.getTime() - user.lastActive.getTime() > SESSION_ACTIVITY_THRESHOLD_MS) {
    user.lastActive = now;
    await updateUserLastActive(user.uuid, now);
  }

  return user;
}

const roleRank: Record<UserRole, number> = {
  user: 0,
  staff: 1
};

export function hasRoleAtLeast(userRole: UserRole, minimumRole: UserRole) {
  return (roleRank[userRole] || 0) >= (roleRank[minimumRole] || 0);
}

export function requireAuth(handler: AuthenticatedHandler, options: AuthGuardOptions = {}) {
  return async (request: Request, params: RouteParams) => {
    const user = await getUserFromRequest(request);

    if (!user) {
      return getAuthError('Unauthorized');
    }

    const activeSuspension = await getActiveSuspensionForUserUuid(user.uuid);
    if (activeSuspension && !options.allowSuspended) {
      return Response.json(
        {
          error: 'Account suspended',
          suspension: activeSuspension,
        },
        { status: 403 },
      );
    }

    if (!options.allowPolicyPending) {
      const policyStatus = await getPolicyStatus(user);
      if (!policyStatus) {
        return Response.json(
          { error: 'Unable to verify policy status, please try again later' },
          { status: 503 },
        );
      }

      if (!policyStatus.upToDate) {
        return Response.json(
          {
            error: 'Policy acceptance required',
            policyStatus,
          },
          { status: 403 },
        );
      }
    }

    return handler(request, user, params);
  };
}

export function requireRole(minimumRole: UserRole, handler: AuthenticatedHandler, options: AuthGuardOptions = {}) {
  return requireAuth(async (request, user, params) => {
    if (!hasRoleAtLeast(user.role, minimumRole)) {
      return getAuthError('Forbidden', 403);
    }

    return handler(request, user, params);
  }, options);
}
