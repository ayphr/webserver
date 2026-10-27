import { json } from '../../lib/http';
import { requireAuth } from '../auth';
import type { RouteParams } from '../types';
import { deleteAvatar, getAvatar, getUserFromUuid, putAvatar, updateUser } from '../../lib/db';
import type { AvatarMetadata } from '../../lib/db';
import { toPublicUser } from '../../lib/user';
import { createLogger } from '../../lib/logger';
import { AVATAR_MAX_BYTES, isAllowedAvatarContentType } from '../../lib/avatars';
import { avatarEventsTotal } from '../../lib/metrics';
import type { User } from '@common';

const log = createLogger('avatars');

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

  let avatar: AvatarMetadata;
  try {
    avatar = await putAvatar(target.user.uuid, bytes, contentType);
  } catch (error) {
    log.warn({ error, userUuid: target.user.uuid }, 'failed to store avatar');
    return json({ error: 'Failed to upload avatar' }, 500);
  }

  target.user.avatar = avatar;
  try {
    await updateUser(target.user);
  } catch (error) {
    log.warn({ error, userUuid: target.user.uuid }, 'failed to persist avatar metadata');
    return json({ error: 'Failed to update profile' }, 500);
  }

  avatarEventsTotal.inc({ event: 'uploaded' });

  return json({ user: toPublicUser(target.user) });
}, { allowSuspended: true });

const handleAvatarDelete = requireAuth(async (request, user) => {
  const target = await resolveTargetUser(request, user);
  if ('error' in target) return target.error;

  if (!target.user.avatar) {
    return json({ user: toPublicUser(target.user) });
  }

  await deleteAvatar(target.user.uuid);

  delete target.user.avatar;
  await updateUser(target.user, ['avatar']);

  avatarEventsTotal.inc({ event: 'deleted' });

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

  const avatar = await getAvatar(uuid);
  if (!avatar) {
    return json({ error: 'avatar not found' }, 404);
  }

  const headers: Record<string, string> = {
    'Content-Type': avatar.contentType,
    'Content-Length': String(avatar.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
  };

  return new Response(avatar.data.value(), { status: 200, headers });
};

export { handleAvatarUpload, handleAvatarDelete, handleAvatarGet };
