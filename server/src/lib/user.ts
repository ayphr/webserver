import type { PlanTier, PublicUser, SelfUser, SubscriptionTier, Team, User } from '@common';
import { getBadgesForUser } from './badges';
import { buildAvatarUrl } from './avatars';
import { getTeamById, getTeamForUser, getTeamsForUsers } from './db/teams';
import { getTeamSeatLimit } from './teamBillingPolicy';

function buildPublicUser(user: User, team: Team | null, teamSeats?: number): PublicUser {
  const teamTier: PlanTier = (team?.tier ?? 'free') as PlanTier;
  const resolvedSeats = teamSeats ?? (team ? getTeamSeatLimit(team) : 1);

  const { auth, avatar, email, emailVerifiedAt, ...rest } = user;
  void auth;
  void avatar;
  void email;
  void emailVerifiedAt;

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

export async function toPublicUser(user: User, teamSeats?: number): Promise<PublicUser> {
  const team = user.teamId
    ? await getTeamById(user.teamId)
    : await getTeamForUser(user);
  return buildPublicUser(user, team, teamSeats);
}

/** Batch variant for list endpoints: resolves every user's team up front. */
export async function toPublicUsers(users: User[]): Promise<PublicUser[]> {
  if (users.length === 0) return [];
  const teams = await getTeamsForUsers(users);
  return users.map((user) => buildPublicUser(user, teams.get(user.uuid) ?? null));
}

export async function toSelfUser(user: User, teamSeats?: number): Promise<SelfUser> {
  const publicUser = await toPublicUser(user, teamSeats);
  return {
    ...publicUser,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}
