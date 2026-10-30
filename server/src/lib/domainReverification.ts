import { getUsers, getUserFromUuid, updateUser } from './db';
import { getLatestDomainVerification } from './db';
import { resolveDomainTxt } from './dns';

function isDomainSocialType(type: string): boolean {
  return type === 'website';
}

export async function reverifyUserDomains(user: any): Promise<any> {
  const socialLinks = user.socialLinks ?? {};
  const verified = { ...(user.socialLinkVerified ?? {}) };

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
    verified[type] = isVerified;
  }

  user.socialLinkVerified = verified;
  await updateUser(user);
  return user;
}

export async function reverifyAllDomains(): Promise<void> {
  const users = await getUsers();
  for (const user of users) {
    try {
      const full = await getUserFromUuid(user.uuid);
      if (!full) continue;
      await reverifyUserDomains(full);
    } catch {
      // ignore
    }
  }
}