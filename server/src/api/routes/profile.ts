import type { User } from '../../../../common';
import { requireAuth } from '../auth';
import { normalizeCountryCode, getSupportedCountries } from '../../lib/country';
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

  // Check authorization: only owner/staff can edit others, users can only edit themselves
  const isOwner = user.role === 'owner' || user.role === 'staff';
  if (targetUuid !== user.uuid && !isOwner) {
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
    const bio = body.bio.trim();
    targetUser.bio = bio.length > 0 ? bio : "Hi! I'm a Ayphr user";
  }

  if (body.socialLinks && typeof body.socialLinks === 'object') {
    const nextSocialLinks = { ...targetUser.socialLinks };
    for (const [key, value] of Object.entries(body.socialLinks)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          nextSocialLinks[key as keyof typeof nextSocialLinks] = trimmed;
        } else {
          delete nextSocialLinks[key as keyof typeof nextSocialLinks];
        }
      } else if (value === undefined || value === null) {
        delete nextSocialLinks[key as keyof typeof nextSocialLinks];
      }
    }
    targetUser.socialLinks = nextSocialLinks;
  }

  await updateUser(targetUser);

  return json({ user: publicUser(targetUser) });
}, { allowSuspended: true });

export { handleMe, handleCountries, handleCountryUpdate, handleProfileEdit };
