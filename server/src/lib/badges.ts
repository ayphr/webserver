import type { BadgeId, PlanTier, User } from '@common';

export function getBadgesForUser(
  user: Pick<User, 'role'>,
  teamTier: PlanTier = 'free',
): BadgeId[] {
  const badges: BadgeId[] = [];

  if (user.role === 'staff') {
    badges.push('staff');
  }

  if (teamTier && teamTier !== 'free' && !badges.includes(teamTier as BadgeId)) {
    badges.push(teamTier as BadgeId);
  }

  return badges;
}