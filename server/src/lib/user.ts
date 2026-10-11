import type { PublicUser, User } from '@common';
import { getBadgesForUser } from './badges';
import { getUserSubscription } from './subscriptions';

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, stripeCustomerId, paidSubscriptions, attachedSubscriptions, ...rest } = user;
  const resolved = getUserSubscription(user);

  return {
    ...rest,
    badges: getBadgesForUser(user),
    subscription: resolved
      ? { tier: resolved.tier, source: resolved.source, expiresAt: resolved.expiresAt }
      : null,
  };
}