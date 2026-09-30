import type { User } from '@common';
import { requireAuth } from '../auth';
import { normalizeCountryCode, getSupportedCountries } from '../../lib/country';
import { isSocialLinkType, normalizeSocialHandle } from '@common/utils/social';
import { BIO_MAX_LENGTH, BIO_MAX_LENGTH_MARKDOWN, DEFAULT_BIO, sanitizeBioMarkdown } from '@common/utils/bio';
import { updateUser, getUserFromUuid } from '../../workers/dbWriter';

type CountryUpdatePayload = {
  country?: string;
};

type ProfileEditPayload = {
  country?: string;
  bio?: string;
  bioFormat?: string;
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

const handleMe = requireAuth(async (_request, user) => {
  return json({ user: publicUser(user) });
}, { allowSuspended: true });

const handleCountries = requireAuth(async () => {
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

  // Check authorization: only staff can edit others, users can only edit themselves
  const isStaff = user.role === 'staff';
  if (targetUuid !== user.uuid && !isStaff) {
    return json({ error: 'unauthorized' }, 403);
  }

  // Get the target user
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

  // Update country if provided
  if (typeof body.country === 'string') {
    const countryCode = normalizeCountryCode(body.country);
    if (!countryCode) {
      return json({ error: 'country must be a valid ISO 3166-1 alpha-2 code' }, 400);
    }
    targetUser.country = countryCode;
  }

  if (typeof body.bio === 'string') {
    // The full markdown dialect is staff-only, so the requester decides which
    // dialect the bio is validated and stored as.
    const extended = isStaff && body.bioFormat === 'markdown';
    const bio = sanitizeBioMarkdown(body.bio, extended);
    const maxLength = extended ? BIO_MAX_LENGTH_MARKDOWN : BIO_MAX_LENGTH;

    if (bio.length > maxLength) {
      return json({ error: `bio must be ${maxLength} characters or fewer` }, 400);
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

  await updateUser(targetUser);

  return json({ user: publicUser(targetUser) });
}, { allowSuspended: true });

export { handleMe, handleCountries, handleCountryUpdate, handleProfileEdit };
