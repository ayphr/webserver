import type { Team } from '@common';
import { PLAN_FEATURES } from '@common';

export function getTeamSeatLimit(team: Team, _memberCount: number): number {
  const planMax = PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
  if (team.seats && team.stripeSubscriptionId) return Math.min(team.seats, planMax);
  return planMax;
}

export function getSharedSeatCount(team: Team, memberCount: number): number {
  if (team.seats && team.stripeSubscriptionId) return Math.max(1, team.seats);
  return Math.max(1, memberCount);
}
