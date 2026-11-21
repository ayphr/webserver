import type { PlanFeatures, Team, User } from '@common';
import { getPlanFeatures } from '@common';
import { json } from './http';
import { getTeamContext } from './teamContext';

const ALERTS_PLAN_ERROR = 'Alerts and webhooks require a Plus or team plan';

/** Plan features for the scope a user is operating in (their team, or free). */
export function getTeamPlanFeatures(team: Team | null): PlanFeatures {
  return getPlanFeatures(team?.tier ?? 'free');
}

export function teamSupportsAlertsAndWebhooks(team: Team | null): boolean {
  return getTeamPlanFeatures(team).alertsAndWebhooks;
}

/** Shared 403 guard for every alerts/integrations endpoint. */
export async function requireAlertsAndWebhooksPlan(user: User): Promise<Response | null> {
  const { team } = await getTeamContext(user);
  return teamSupportsAlertsAndWebhooks(team) ? null : json({ error: ALERTS_PLAN_ERROR }, 403);
}
