import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import { toPublicUser } from '../../lib/user';
import { isSocialLinkType, normalizeSocialHandle } from '@common/utils/social';
import { updateUser, getUserFromUuid, getCollection, createDomainVerification, getLatestDomainVerification, markDomainVerificationVerified } from '../../lib/db';
import { resolveDomainTxt } from '../../lib/dns';
import { reverifyUserDomains } from '../../lib/domainReverification';

function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return Promise.resolve(null);
  }
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function parseDomainType(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const raw =
    body.type ?? body.socialType ?? body.linkType ?? body.key ?? body.platform ?? body.socialLinkType ?? body.link;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : null;
}

function parseDomainValue(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const raw = body.domain ?? body.handle ?? body.value ?? body.website;
  return typeof raw === 'string' ? raw.trim() : null;
}

function isDomainSocialType(type: string): boolean {
  return type === 'website';
}

export const handleDomainChallenge = requireAuth(async (request, user) => {
  const body = await readBody(request);
  const type = parseDomainType(body);
  if (!type || !isSocialLinkType(type)) {
    return json({ error: 'invalid social link type' }, 400);
  }

  const value = parseDomainValue(body);
  if (!value) {
    return json({ error: 'domain is required' }, 400);
  }

  const domain = normalizeSocialHandle(type, value);
  if (!domain) {
    return json({ error: `"${value}" is not a valid ${type} handle` }, 400);
  }

  if (!isDomainSocialType(type)) {
    return json({ error: `${type} is not a domain social link` }, 400);
  }

  const existing = await getLatestDomainVerification(user.uuid, type, domain);
  let token: string;
  let expiresAt: Date;

  if (existing) {
    token = existing.token;
    expiresAt = existing.expiresAt;
  } else {
    token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const now = new Date();
    expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const id = crypto.randomUUID();

    await createDomainVerification({
      id,
      userUuid: user.uuid,
      socialType: type,
      domain,
      token,
      createdAt: now,
      expiresAt,
    });
  }

  const recordName = `_ayphr.${domain}`;
  return json({
    domain,
    type,
    socialType: type,
    token,
    challenge: token,
    challengeToken: token,
    verificationToken: token,
    recordName,
    recordValue: token,
    txtName: recordName,
    txtValue: token,
    name: recordName,
    value: token,
    expiresAt,
  });
});

export const handleDomainVerify = requireAuth(async (request, user) => {
  const body = await readBody(request);
  const type = parseDomainType(body);
  if (!type || !isSocialLinkType(type)) {
    return json({ error: 'invalid social link type' }, 400);
  }

  const value = parseDomainValue(body);
  const domain = value ? normalizeSocialHandle(type, value) : null;

  let tokenFromBody: string | undefined;
  if (typeof body?.token === 'string') {
    tokenFromBody = body.token;
  } else if (typeof body?.code === 'string') {
    tokenFromBody = body.code;
  } else if (typeof body?.challenge === 'string') {
    tokenFromBody = body.challenge;
  } else if (typeof body?.challengeToken === 'string') {
    tokenFromBody = body.challengeToken;
  } else if (typeof body?.verificationToken === 'string') {
    tokenFromBody = body.verificationToken;
  } else if (typeof body?.txtValue === 'string') {
    tokenFromBody = body.txtValue;
  }

  // eslint-disable-next-line no-useless-assignment
  let verification = null;
  if (domain) {
    verification = await getLatestDomainVerification(user.uuid, type, domain);
  } else {
    const domainVerifications = await getCollection('domainVerifications');
    const list = await domainVerifications.find({ userUuid: user.uuid, socialType: type }).sort({ createdAt: -1 }).limit(1).toArray();
    verification = list[0] ?? null;
  }

  if (!verification && domain && tokenFromBody) {
    verification = {
      id: crypto.randomUUID(),
      userUuid: user.uuid,
      socialType: type,
      domain,
      token: tokenFromBody,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  if (!verification) {
    return json({ error: 'no pending domain verification' }, 400);
  }

  const expectedToken = verification.token;
  const suppliedToken = tokenFromBody ?? expectedToken;
  if (suppliedToken !== expectedToken) {
    return json({ error: 'invalid verification token' }, 400);
  }

  const recordName = `_ayphr.${verification.domain}`;
  const records = await resolveDomainTxt(verification.domain);
  const normalizedRecords = records.map((value) => value.trim().toLowerCase());
  if (!normalizedRecords.includes(expectedToken.trim().toLowerCase())) {
    return json({ error: 'TXT record not found or does not match', recordName, resolved: records }, 400);
  }

  await markDomainVerificationVerified(verification.id);

  const targetUser = await getUserFromUuid(user.uuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }
  const nextSocialLinks = { ...targetUser.socialLinks };
  (nextSocialLinks as Record<string, string>)[type] = verification.domain;
  targetUser.socialLinks = nextSocialLinks;
  targetUser.socialLinkVerified = { ...targetUser.socialLinkVerified, [type]: true };
  await updateUser(targetUser);

  return json({ verified: true, success: true, ok: true, user: toPublicUser(targetUser) });
});

export const handleDomainReverify = requireAuth(async (_request, user) => {
  const targetUser = await getUserFromUuid(user.uuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }
  await reverifyUserDomains(targetUser);
  const refreshed = await getUserFromUuid(user.uuid);
  return json({ user: toPublicUser(refreshed ?? targetUser), reverified: true, success: true, ok: true });
});