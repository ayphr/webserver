import type { User } from '@common';
import { requireAuth } from '../auth';
import { normalizeCountryCode, getSupportedCountries } from '../../lib/country';
import { isSocialLinkType, normalizeSocialHandle } from '@common/utils/social';
import {
  BIO_MAX_LENGTH,
  BIO_MAX_SOURCE_LENGTH,
  DEFAULT_BIO,
  bioVisibleLength,
  sanitizeBioMarkdown,
} from '@common/utils/bio';
import { updateUser, getUserFromUuid } from '../../workers/dbWriter';

type CountryUpdatePayload = {
  country?: string;
};

type ProfileEditPayload = {
  country?: string;
  bio?: string;
  socialLinks?: Record<string, string | undefined>;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function publicUser(user: User) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return rest;
}

const handleMe = requireAuth((_request, user) => {
  return json({ user: publicUser(user) });
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

  return json({ user: publicUser(user) });
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
  }

  if (typeof body.bio === 'string') {
    if (body.bio.length > BIO_MAX_SOURCE_LENGTH) {
      return json({ error: 'bio is too long' }, 400);
    }

    const extended = isStaff;
    const bio = sanitizeBioMarkdown(body.bio, extended);

    if (bioVisibleLength(bio, extended) > BIO_MAX_LENGTH) {
      return json({ error: `bio must be ${BIO_MAX_LENGTH} characters or fewer` }, 400);
    }

    targetUser.bio = bio.length > 0 ? bio : DEFAULT_BIO;
    targetUser.bioFormat = extended ? 'markdown' : 'limited';
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
  }

  await updateUser(targetUser, unsetKeys);

  return json({ user: publicUser(targetUser) });
}, { allowSuspended: true });

export { handleMe, handleCountries, handleCountryUpdate, handleProfileEdit };
