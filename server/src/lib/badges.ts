import type { BadgeId, User } from '@common';

export function getBadgesForUser(user: Pick<User, 'role'>): BadgeId[] {
  if (user.role !== 'staff') {
    return [];
  }

  return ['staff', 'ultra'];
}