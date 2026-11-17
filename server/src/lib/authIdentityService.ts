import type { User } from '@common';
import { getUserByEmail, getUserFromUsername } from './db';
import { normalizeEmail } from '@common/utils/email';

export async function findUserByLoginIdentifier(identifier: string): Promise<User | null> {
  return identifier.includes('@')
    ? getUserByEmail(normalizeEmail(identifier))
    : getUserFromUsername(identifier);
}

export function getDeviceFingerprint(userAgent: string | null): string | null {
  if (!userAgent) return null;
  return userAgent;
}

export function isTrustedDevice(user: Pick<User, 'trustedDevices'>, fingerprint: string | null): boolean {
  return fingerprint !== null && (user.trustedDevices ?? []).includes(fingerprint);
}

export function shouldVerifyNewDevice(
  user: Pick<User, 'trustedDevices' | 'email' | 'emailVerifiedAt'>,
  fingerprint: string | null,
): boolean {
  const trusted = user.trustedDevices ?? [];
  return Boolean(fingerprint) &&
    trusted.length > 0 &&
    !isTrustedDevice(user, fingerprint) &&
    Boolean(user.email && user.emailVerifiedAt);
}
