import type { User } from '@common';

export const AVATAR_MAX_BYTES = 4 * 1024 * 1024;

export const ALLOWED_AVATAR_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type AvatarContentType = (typeof ALLOWED_AVATAR_CONTENT_TYPES)[number];

export function isAllowedAvatarContentType(value: string): value is AvatarContentType {
  return (ALLOWED_AVATAR_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Builds a cache-busted, client-resolvable URL for a user's avatar. */
export function buildAvatarUrl(user: Pick<User, 'uuid' | 'avatar'>): string | undefined {
  if (!user.avatar) return undefined;

  const updatedAt = user.avatar.updatedAt instanceof Date
    ? user.avatar.updatedAt
    : new Date(user.avatar.updatedAt);
  const version = Number.isNaN(updatedAt.getTime()) ? 0 : updatedAt.getTime();

  return `/api/avatars/${encodeURIComponent(user.uuid)}?v=${version}`;
}
