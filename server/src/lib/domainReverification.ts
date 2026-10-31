import type { SocialLinkType, User } from '@common';
import { getUsers, updateUser } from './db';
import { getLatestDomainVerification } from './db';
import { resolveDomainTxt } from './dns';

function isDomainSocialType(type: string): boolean {
  return type === 'website';
}

export async function reverifyUserDomains(user: User): Promise<User> {
  const socialLinks = user.socialLinks ?? {};

  // Most users have no website link at all; skip them without touching the
  // database (updateUser would also flush the global auth cache).
  const hasWebsite = Object.entries(socialLinks).some(
    ([type, domain]) => isDomainSocialType(type) && typeof domain === 'string' && domain.length > 0,
  );
  if (!hasWebsite) return user;

  const verified: Partial<Record<SocialLinkType, boolean>> = { ...(user.socialLinkVerified ?? {}) };

  for (const [type, domain] of Object.entries(socialLinks)) {
    if (!domain || typeof domain !== 'string') continue;
    if (!isDomainSocialType(type)) continue;

    const verification = await getLatestDomainVerification(user.uuid, type, domain);
    const token = verification?.token;
    let isVerified = false;
    if (token) {
      const records = await resolveDomainTxt(domain);
      isVerified = records.includes(token);
    }
    verified[type as SocialLinkType] = isVerified;
  }

  const previous = user.socialLinkVerified ?? {};
  const changed = Object.entries(verified).some(
    ([type, value]) => previous[type as SocialLinkType] !== value,
  );

  if (!changed) return user;

  user.socialLinkVerified = verified;
  await updateUser(user);
  return user;
}

export async function reverifyAllDomains(): Promise<void> {
  const users = await getUsers();
  for (const user of users) {
    try {
      await reverifyUserDomains(user);
    } catch {
      // ignore
    }
  }
}