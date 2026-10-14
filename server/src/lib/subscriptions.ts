import type { ResolvedSubscription, User } from '@common';
import { resolveSubscription, getSubscriptionTier } from '@common';
import { getUserFromUuid } from './db';

export function getUserSubscription(user: Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'>): ResolvedSubscription | null {
  return resolveSubscription(user);
}

export async function getUserSubscriptionFromUuid(uuid: string): Promise<ResolvedSubscription | null> {
  const user = await getUserFromUuid(uuid);
  if (!user) return null;

  return resolveSubscription(user);
}

export function getUserSubscriptionTier(user: Pick<User, 'paidSubscriptions' | 'attachedSubscriptions'>) {
  return getSubscriptionTier(user);
}
