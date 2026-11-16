import type { PublicUser, SelfUser, User } from '@common';
import { getBadgesForUser } from './badges';
import { getUserSubscription } from './subscriptions';
import { buildAvatarUrl } from './avatars';

export function toPublicUser(user: User, teamSeats?: number): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, stripeCustomerId, paidSubscriptions, attachedSubscriptions, avatar, email, emailVerifiedAt, ...rest } = user;
  const resolved = getUserSubscription(user);
  const seats = teamSeats ?? resolved?.seats;

  return {
    ...rest,
    badges: getBadgesForUser(user),
    avatarUrl: buildAvatarUrl(user),
    subscription: resolved
      ? {
          tier: resolved.tier,
          source: resolved.source,
          expiresAt: resolved.expiresAt,
          seats: (seats ?? 1) > 1 ? (seats ?? 1) : undefined,
        }
      : null,
  };
}

export function toSelfUser(user: User, teamSeats?: number): SelfUser {
  const publicUser = toPublicUser(user, teamSeats);
  return {
    ...publicUser,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}