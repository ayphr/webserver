import type { PublicUser, User } from '@common';
import { getBadgesForUser } from './badges';
import { getUserSubscription } from './subscriptions';
import { buildAvatarUrl } from './avatars';

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, stripeCustomerId, paidSubscriptions, attachedSubscriptions, credits, avatar, ...rest } = user;
  const resolved = getUserSubscription(user);

  return {
    ...rest,
    badges: getBadgesForUser(user),
    avatarUrl: buildAvatarUrl(user),
    subscription: resolved
      ? { tier: resolved.tier, source: resolved.source, expiresAt: resolved.expiresAt }
      : null,
  };
}