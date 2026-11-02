import { describe, expect, test } from 'bun:test';
import { ALLOWED_AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, buildAvatarUrl, isAllowedAvatarContentType } from './avatars';

describe('avatars', () => {
  test('isAllowedAvatarContentType accepts allowed types', () => {
    for (const type of ALLOWED_AVATAR_CONTENT_TYPES) {
      expect(isAllowedAvatarContentType(type)).toBe(true);
    }
  });

  test('isAllowedAvatarContentType rejects unknown types', () => {
    expect(isAllowedAvatarContentType('image/bmp')).toBe(false);
    expect(isAllowedAvatarContentType('')).toBe(false);
  });

  test('AVATAR_MAX_BYTES is 4MB', () => {
    expect(AVATAR_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  test('buildAvatarUrl returns undefined without avatar', () => {
    expect(buildAvatarUrl({ uuid: 'u1', avatar: undefined } as never)).toBeUndefined();
  });

  test('buildAvatarUrl includes uuid and version', () => {
    const url = buildAvatarUrl({ uuid: 'u1', avatar: { updatedAt: new Date('2026-01-01T00:00:00Z') } } as never);
    expect(url).toContain('/api/avatars/u1?');
    expect(url).toContain('v=');
  });
});