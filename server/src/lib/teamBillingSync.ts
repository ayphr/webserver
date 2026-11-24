import type Stripe from 'stripe';
import type { BillingInterval, PaidSubscriptionStatus, Team } from '@common';
import { PLAN_FEATURES } from '@common';
import {
  clearUserTeamMembership,
  getTeamById,
  getTeamMembers,
} from './db/teams';
import { getCollection, trackMongoOperation, TEAMS_COLLECTION } from './db/internal';
import { logTeamAudit } from './teamAuditService';
import { notifyUser } from './notifications';
import { createLogger } from './logger';

const log = createLogger('team-billing');
import {
  getBillingIntervalFromStripeSubscription,
  resolveTierFromStripeSubscription,
  updateSubscriptionQuantity,
} from './stripe';

export async function syncTeamStripeSubscription(teamId: string, subscription: Stripe.Subscription): Promise<void> {
  const teams = await getCollection('teams');
  const tier = resolveTierFromStripeSubscription(subscription);
  const item = subscription.items.data[0];
  const interval: BillingInterval | undefined = getBillingIntervalFromStripeSubscription(subscription);
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne(
    { id: teamId },
    {
      $set: {
        ...(tier ? { tier } : {}),
        subscriptionStatus: subscription.status as PaidSubscriptionStatus,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
        stripeSubscriptionId: subscription.id,
        seats: item?.quantity ?? 1,
        ...(interval ? { billingInterval: interval } : {}),
        ...(item?.current_period_end ? { currentPeriodEnd: new Date(item.current_period_end * 1000) } : {}),
        updatedAt: new Date(),
      },
    },
  );

  const updated = await getTeamById(teamId);
  if (updated) {
    await enforceTeamMemberLimit(updated, { reason: 'Stripe subscription plan change' });
    await syncTeamMemberSubscriptions(updated);
  }
}

export async function clearTeamStripeSubscription(teamId: string, stripeSubscriptionId?: string): Promise<void> {
  const teams = await getCollection('teams');
  const filter = stripeSubscriptionId ? { id: teamId, stripeSubscriptionId } : { id: teamId };
  trackMongoOperation('updateOne', TEAMS_COLLECTION);
  await teams.updateOne(
    filter,
    {
      $set: { tier: 'free', subscriptionStatus: 'canceled', updatedAt: new Date() },
      $unset: { stripeSubscriptionId: '', seats: '', billingInterval: '', currentPeriodEnd: '' },
    },
  );

  const updated = await getTeamById(teamId);
  if (updated) {
    await enforceTeamMemberLimit(updated, { reason: 'Stripe subscription canceled or downgraded' });
    await syncTeamMemberSubscriptions(updated);
  }
}

export async function syncTeamMemberSubscriptions(team: Team): Promise<void> {
  const members = await getTeamMembers(team.id);
  const seats = Math.max(1, members.length);
  if (!team.stripeSubscriptionId || team.seats === seats) return;

  try {
    await updateSubscriptionQuantity(team.stripeSubscriptionId, seats);
    const teams = await getCollection('teams');
    trackMongoOperation('updateOne', TEAMS_COLLECTION);
    await teams.updateOne({ id: team.id }, { $set: { seats, updatedAt: new Date() } });
  } catch {
    // Best effort: billing quantity is reconciled by the next Stripe event.
  }
}

/**
 * Explicit policy: when a paid team drops below its member count, the newest
 * non-manager members are removed immediately to match the plan's seat limit.
 * The manager is never removed. Every removal is audited and the affected user
 * is notified so the change is never silent.
 */
export const DOWNGRADE_REMOVAL_POLICY =
  'newest non-manager members are removed on downgrade until the plan seat limit is met';

export type MemberLimitRemovalDeps = {
  getMembers: typeof getTeamMembers;
  removeMembership: typeof clearUserTeamMembership;
  logAudit: typeof logTeamAudit;
  notify: typeof notifyUser;
};

const defaultRemovalDeps: MemberLimitRemovalDeps = {
  getMembers: getTeamMembers,
  removeMembership: clearUserTeamMembership,
  logAudit: logTeamAudit,
  notify: notifyUser,
};

export async function enforceTeamMemberLimit(
  team: Team,
  options: { reason?: string; deps?: MemberLimitRemovalDeps } = {},
): Promise<void> {
  const deps = options.deps ?? defaultRemovalDeps;
  const reason = options.reason ?? 'plan seat limit';
  const members = await deps.getMembers(team.id);
  const limit = PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
  if (members.length <= limit) return;

  const removable = members
    .filter((member) => member.uuid !== team.managerUuid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const member of removable.slice(0, Math.max(0, members.length - limit))) {
    await deps.removeMembership(member.uuid, team.id);
    try {
      await deps.logAudit({
        teamId: team.id,
        actorUuid: team.managerUuid,
        actorUsername: 'system',
        action: 'team.member_removed_plan_limit',
        targetUuid: member.uuid,
        targetUsername: member.username,
        details: { reason, policy: DOWNGRADE_REMOVAL_POLICY, tier: team.tier },
      });
      await deps.notify({
        userUuid: member.uuid,
        type: 'team',
        title: 'Removed from team after plan downgrade',
        message: `${team.name ?? 'Your team'} now has fewer seats. ${DOWNGRADE_REMOVAL_POLICY}.`,
        link: '/dashboard/team',
      });
    } catch (error) {
      // The seat must still be freed even if auditing or notification fails.
      log.warn({ error, teamId: team.id, userUuid: member.uuid }, 'failed to record plan-limit removal side effects');
    }
  }
}
