import type { BadgeId, User } from '@common';
import { getUserSubscription } from './subscriptions';

export function getBadgesForUser(
  user: Pick<User, 'role' | 'paidSubscriptions' | 'attachedSubscriptions'>,
): BadgeId[] {
  const badges: BadgeId[] = [];

  if (user.role === 'staff') {
    badges.push('staff');
  }

  const subscription = getUserSubscription(user);
  if (subscription && !badges.includes(subscription.tier)) {
    badges.push(subscription.tier);
  }

  return badges;
}