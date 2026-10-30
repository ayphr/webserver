import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import { normalizeCountryCode, getSupportedCountries } from '@common';
import { toPublicUser } from '../../lib/user';
import { isSocialLinkType, normalizeSocialHandle } from '@common/utils/social';
import {
  BIO_MAX_LENGTH,
  BIO_MAX_SOURCE_LENGTH,
  DEFAULT_BIO,
  Markdown,
} from '@common/utils/markdown';
import { updateUser, getUserFromUuid, getCols } from '../../lib/db';
import { createDomainVerification, getLatestDomainVerification, markDomainVerificationVerified } from '../../lib/db';
import { resolveDomainTxt } from '../../lib/dns';
import { reverifyUserDomains } from '../../lib/domainReverification';
import { profileUpdatesTotal } from '../../lib/metrics';

type CountryUpdatePayload = {
  country?: string;
};

type ProfileEditPayload = {
  country?: string;
  bio?: string;
  socialLinks?: Record<string, string | undefined>;
};

const handleMe = requireAuth((_request, user) => {
  return json({ user: toPublicUser(user) });
}, { allowSuspended: true });

const handleCountries = requireAuth(() => {
  return json({ countries: getSupportedCountries() });
}, { allowSuspended: true });

const handleCountryUpdate = requireAuth(async (request, user) => {
  // eslint-disable-next-line no-useless-assignment
  let body: CountryUpdatePayload | null = null;
  try {
    body = await request.json() as CountryUpdatePayload;
  } catch {
    body = null;
  }

  if (typeof body?.country !== 'string') {
    return json({ error: 'country is required' }, 400);
  }

  const countryCode = normalizeCountryCode(body.country);
  if (!countryCode) {
    return json({ error: 'country must be a valid ISO 3166-1 alpha-2 code' }, 400);
  }

  user.country = countryCode;
  await updateUser(user);

  profileUpdatesTotal.inc({ field: 'country' });

  return json({ user: toPublicUser(user) });
}, { allowSuspended: true });

const handleProfileEdit = requireAuth(async (request, user, params) => {
  const targetUuid = params.uuid;

  if (!targetUuid) {
    return json({ error: 'invalid user uuid' }, 400);
  }

  const isStaff = user.role === 'staff';
  if (targetUuid !== user.uuid && !isStaff) {
    return json({ error: 'unauthorized' }, 403);
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }

  // eslint-disable-next-line no-useless-assignment
  let body: ProfileEditPayload | null = null;
  try {
    body = await request.json() as ProfileEditPayload;
  } catch {
    body = null;
  }

  if (!body || Object.keys(body).length === 0) {
    return json({ error: 'no fields to update' }, 400);
  }

  const unsetKeys: string[] = [];
  const changes = new Set<'country' | 'bio' | 'social'>();

  if (typeof body.country === 'string') {
    if (body.country.trim() === '') {
      delete targetUser.country;
      unsetKeys.push('country');
    } else {
      const countryCode = normalizeCountryCode(body.country);
      if (!countryCode) {
        return json({ error: 'country must be a valid ISO 3166-1 alpha-2 code' }, 400);
      }
      targetUser.country = countryCode;
    }
    changes.add('country');
  }

  if (typeof body.bio === 'string') {
    if (body.bio.length > BIO_MAX_SOURCE_LENGTH) {
      return json({ error: 'bio is too long' }, 400);
    }

    const extended = isStaff;
    const markdown = new Markdown(body.bio, extended);
    const bio = markdown.sanitize();

    if (markdown.visibleLength() > BIO_MAX_LENGTH) {
      return json({ error: `bio must be ${BIO_MAX_LENGTH} characters or fewer` }, 400);
    }

    targetUser.bio = bio.length > 0 ? bio : DEFAULT_BIO;
    targetUser.bioFormat = extended ? 'markdown' : 'limited';
    changes.add('bio');
  }

  if (body.socialLinks && typeof body.socialLinks === 'object') {
    const nextSocialLinks = { ...targetUser.socialLinks };

    for (const [key, value] of Object.entries(body.socialLinks)) {
      if (!isSocialLinkType(key)) {
        return json({ error: `unknown social link type: ${key}` }, 400);
      }

      if (typeof value !== 'string' || value.trim().length === 0) {
        delete nextSocialLinks[key];
        continue;
      }

      const handle = normalizeSocialHandle(key, value);

      if (!handle) {
        return json({ error: `"${value}" is not a valid ${key} handle` }, 400);
      }

      nextSocialLinks[key] = handle;
    }

    targetUser.socialLinks = nextSocialLinks;
    changes.add('social');
  }

  await updateUser(targetUser, unsetKeys);

  for (const field of changes) {
    profileUpdatesTotal.inc({ field });
  }

  return json({ user: toPublicUser(targetUser) });
}, { allowSuspended: true });

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

const handleDomainChallenge = requireAuth(async (request, user) => {
  const body = await readBody(request);
  const type = parseDomainType(body);
  if (!type || !isSocialLinkType(type)) {
    return json({ error: 'invalid social link type' }, 400);
  }

  const value = parseDomainValue(body);
  if (!value) {
    return json({ error: 'domain is required' }, 400);
  }

  const domain = normalizeSocialHandle(type as any, value);
  if (!domain) {
    return json({ error: `"${value}" is not a valid ${type} handle` }, 400);
  }

  if (!isDomainSocialType(type)) {
    return json({ error: `${type} is not a domain social link` }, 400);
  }

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
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

const handleDomainVerify = requireAuth(async (request, user) => {
  const body = await readBody(request);
  const type = parseDomainType(body);
  if (!type || !isSocialLinkType(type)) {
    return json({ error: 'invalid social link type' }, 400);
  }

  const value = parseDomainValue(body);
  const domain = value ? normalizeSocialHandle(type as any, value) : null;

  const tokenFromBody =
    typeof body?.token === 'string' ? body.token :
    typeof body?.code === 'string' ? body.code :
    typeof body?.challenge === 'string' ? body.challenge :
    typeof body?.challengeToken === 'string' ? body.challengeToken :
    typeof body?.verificationToken === 'string' ? body.verificationToken :
    typeof body?.txtValue === 'string' ? body.txtValue : undefined;

  let verification = null;
  if (domain) {
    verification = await getLatestDomainVerification(user.uuid, type, domain);
  } else {
    // fall back to most recent for this type
    const { domainVerifications } = await getCols();
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
    } as any;
  }

  if (!verification) {
    return json({ error: 'no pending domain verification' }, 400);
  }

  const expectedToken = verification.token;
  const suppliedToken = tokenFromBody ?? expectedToken;
  if (suppliedToken !== expectedToken) {
    return json({ error: 'invalid verification token' }, 400);
  }

  const records = await resolveDomainTxt(verification.domain);
  if (!records.includes(expectedToken)) {
    return json({ error: 'TXT record not found or does not match' }, 400);
  }

  await markDomainVerificationVerified(verification.id);

  const targetUser = await getUserFromUuid(user.uuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }
  const nextSocialLinks = { ...targetUser.socialLinks };
  (nextSocialLinks as Record<string, string>)[type] = verification.domain;
  targetUser.socialLinks = nextSocialLinks;
  targetUser.socialLinkVerified = { ...(targetUser.socialLinkVerified ?? {}), [type]: true };
  await updateUser(targetUser);

  return json({ verified: true, success: true, ok: true, user: toPublicUser(targetUser) });
});

const handleDomainReverify = requireAuth(async (_request, user) => {
  const targetUser = await getUserFromUuid(user.uuid);
  if (!targetUser) {
    return json({ error: 'user not found' }, 404);
  }
  await reverifyUserDomains(targetUser);
  const refreshed = await getUserFromUuid(user.uuid);
  return json({ user: toPublicUser(refreshed ?? targetUser), reverified: true, success: true, ok: true });
});

export {
  handleMe,
  handleCountries,
  handleCountryUpdate,
  handleProfileEdit,
  handleDomainChallenge,
  handleDomainVerify,
  handleDomainReverify,
};
