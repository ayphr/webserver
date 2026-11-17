import type { PlanTier, PublicUser, SelfUser, SubscriptionTier, User } from '@common';
import { getBadgesForUser } from './badges';
import { buildAvatarUrl } from './avatars';
import { getTeamById, getTeamForUser, getTeamSeatLimit } from './db/teams';
import { getUserFromUuid } from './db';

export async function toPublicUser(user: User, teamSeats?: number): Promise<PublicUser> {
  const team = user.teamId
    ? await getTeamById(user.teamId)
    : await getTeamForUser(user);
  const teamTier: PlanTier = (team?.tier ?? 'free') as PlanTier;

  let seats = teamSeats;
  if (seats === undefined && team) {
    const manager = await getUserFromUuid(team.managerUuid);
    if (manager) {
      seats = await getTeamSeatLimit(team, manager);
    }
  }
  const resolvedSeats = seats ?? 1;

  const { auth, avatar, email, emailVerifiedAt, ...rest } = user;

  return {
    ...rest,
    badges: getBadgesForUser(user, teamTier),
    avatarUrl: buildAvatarUrl(user),
    subscription: teamTier !== 'free'
      ? {
          tier: teamTier as SubscriptionTier,
          expiresAt: team?.currentPeriodEnd ?? null,
          seats: resolvedSeats > 1 ? resolvedSeats : undefined,
        }
      : null,
  };
}

export async function toSelfUser(user: User, teamSeats?: number): Promise<SelfUser> {
  const publicUser = await toPublicUser(user, teamSeats);
  return {
    ...publicUser,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}