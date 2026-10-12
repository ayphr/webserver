import { requireAuth } from '../auth';
import type { RouteParams } from '../types';
import { getUserFromUuid, updateUser } from '../../workers/dbWriter';
import { toPublicUser } from '../../lib/user';
import { createLogger } from '../../lib/logger';
import { deleteObject, getObject, isStorageConfigured, putObject } from '../../lib/storage';
import {
  AVATAR_MAX_BYTES,
  avatarObjectKey,
  isAllowedAvatarContentType,
} from '../../lib/avatars';
import type { User } from '@common';

const log = createLogger('avatars');

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

const MAX_AVATAR_MB = Math.round(AVATAR_MAX_BYTES / (1024 * 1024));

type ResolvedTarget = { user: User } | { error: Response };

async function resolveTargetUser(request: Request, actor: User): Promise<ResolvedTarget> {
  const targetUuid = new URL(request.url).searchParams.get('userUuid') ?? actor.uuid;

  if (targetUuid !== actor.uuid && actor.role !== 'staff') {
    return { error: json({ error: 'forbidden' }, 403) };
  }

  if (targetUuid === actor.uuid) {
    return { user: actor };
  }

  const targetUser = await getUserFromUuid(targetUuid);
  if (!targetUser) {
    return { error: json({ error: 'user not found' }, 404) };
  }

  return { user: targetUser };
}

const handleAvatarUpload = requireAuth(async (request, user) => {
  if (!isStorageConfigured()) {
    return json({ error: 'File storage is not configured' }, 503);
  }

  const target = await resolveTargetUser(request, user);
  if ('error' in target) return target.error;

  const form = await request.formData().catch(() => null);
  const file = form?.get('avatar');

  if (!(file instanceof Blob)) {
    return json({ error: 'avatar file is required' }, 400);
  }

  const contentType = file.type || 'application/octet-stream';
  if (!isAllowedAvatarContentType(contentType)) {
    return json({ error: 'avatar must be a PNG, JPEG, WEBP, or GIF image' }, 400);
  }

  if (file.size === 0) {
    return json({ error: 'avatar file is empty' }, 400);
  }

  if (file.size > AVATAR_MAX_BYTES) {
    return json({ error: `avatar must be at most ${MAX_AVATAR_MB} MB` }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    await putObject(avatarObjectKey(target.user.uuid), bytes, {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  } catch (error) {
    log.warn({ error, userUuid: target.user.uuid }, 'failed to upload avatar to storage');
    return json({ error: 'Failed to upload avatar' }, 500);
  }

  target.user.avatar = {
    contentType,
    size: bytes.byteLength,
    updatedAt: new Date(),
  };
  try {
    await updateUser(target.user);
  } catch (error) {
    log.warn({ error, userUuid: target.user.uuid }, 'failed to persist avatar metadata');
    return json({ error: 'Failed to update profile' }, 500);
  }

  return json({ user: toPublicUser(target.user) });
}, { allowSuspended: true });

const handleAvatarDelete = requireAuth(async (request, user) => {
  const target = await resolveTargetUser(request, user);
  if ('error' in target) return target.error;

  if (!target.user.avatar) {
    return json({ user: toPublicUser(target.user) });
  }

  await deleteObject(avatarObjectKey(target.user.uuid));

  delete target.user.avatar;
  await updateUser(target.user, ['avatar']);

  return json({ user: toPublicUser(target.user) });
}, { allowSuspended: true });

const handleAvatarGet = async (_request: Request, params: RouteParams) => {
  const uuid = params.uuid;
  if (!uuid) {
    return json({ error: 'user uuid is required' }, 400);
  }

  const user = await getUserFromUuid(uuid);
  if (!user?.avatar) {
    return json({ error: 'avatar not found' }, 404);
  }

  const object = await getObject(avatarObjectKey(uuid));
  if (!object) {
    return json({ error: 'avatar not found' }, 404);
  }

  const headers: Record<string, string> = {
    'Content-Type': object.contentType ?? user.avatar.contentType,
    'Content-Length': String(object.data.byteLength),
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  if (object.etag) {
    headers.ETag = object.etag;
  }

  return new Response(object.data, { status: 200, headers });
};

export { handleAvatarUpload, handleAvatarDelete, handleAvatarGet };
