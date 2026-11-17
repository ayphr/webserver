import type Stripe from 'stripe';
import type { BillingInterval, PaidSubscriptionStatus, Team } from '@common';
import { PLAN_FEATURES } from '@common';
import {
  clearUserTeamMembership,
  getTeamById,
  getTeamMembers,
} from './db/teams';
import { getCollection, trackMongoOperation } from './db/internal';
import {
  getBillingIntervalFromStripeSubscription,
  resolveTierFromStripeSubscription,
  updateSubscriptionQuantity,
} from './stripe';

const TEAMS_COLLECTION = 'teams';

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
    await enforceTeamMemberLimit(updated);
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
    await enforceTeamMemberLimit(updated);
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

export async function enforceTeamMemberLimit(team: Team): Promise<void> {
  const members = await getTeamMembers(team.id);
  const limit = PLAN_FEATURES[team.tier]?.maxUsers ?? 1;
  if (members.length <= limit) return;

  const removable = members
    .filter((member) => member.uuid !== team.managerUuid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const member of removable.slice(0, Math.max(0, members.length - limit))) {
    await clearUserTeamMembership(member.uuid, team.id);
  }
}
