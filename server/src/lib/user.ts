import type { PublicUser, User } from '@common';
import { getBadgesForUser } from './badges';

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { auth, ...rest } = user;
  return { ...rest, badges: getBadgesForUser(user) };
}