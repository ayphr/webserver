import type { BillingInterval, SubscriptionTier, Team, User } from '@common';
import {
  createTeamStripeCustomer,
  createTeamCheckoutSession,
  createBillingPortalSession,
  changeTeamStripeSubscription,
  cancelTeamStripeSubscription,
  getPriceIdForTier,
  getStripe,
  stripeCustomerExists,
} from './stripe';
import {
  getTeamById,
  getTeamMembers,
  setTeamStripeCustomerId,
} from './db/teams';
import { getCollection } from './db/internal';
import { CLIENT_URL } from '../env';
import { createLogger } from './logger';
import { subscriptionEventsTotal } from './metrics';
import { clearTeamStripeSubscription, syncTeamStripeSubscription } from './teamBillingSync';
export { getStripeCustomerId, processStripeEvent } from './subscriptionSync';

const log = createLogger('subscriptions');

type CheckoutResult =
  | { kind: 'updated'; url: string }
  | { kind: 'created'; url: string }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

function dashboardUrl(path: string): string {
  return `${CLIENT_URL}/dashboard${path}`;
}

async function clearStaleBillingState(teamId: string): Promise<void> {
  const teams = await getCollection('teams');
  await teams.updateOne(
    { id: teamId },
    {
      $unset: {
        stripeCustomerId: '',
        stripeSubscriptionId: '',
        subscriptionStatus: '',
        seats: '',
        billingInterval: '',
        currentPeriodEnd: '',
      },
      $set: { updatedAt: new Date() },
    },
  );
}

async function ensureCustomer(team: Team, user: User): Promise<string | null> {
  if (team.stripeCustomerId && await stripeCustomerExists(team.stripeCustomerId)) {
    return team.stripeCustomerId;
  }

  if (team.stripeCustomerId) {
    await clearStaleBillingState(team.id);
  }

  const customerId = await createTeamStripeCustomer({
    teamId: team.id,
    name: team.name ?? `${user.username}'s Team`,
  });
  if (!customerId) return null;

  await setTeamStripeCustomerId(team.id, customerId);
  return customerId;
}

async function getTeamQuantity(teamId: string): Promise<number> {
  const members = await getTeamMembers(teamId);
  return Math.max(1, members.length);
}

export async function createTeamCheckout(
  team: Team,
  user: User,
  tier: SubscriptionTier,
  interval: BillingInterval,
): Promise<CheckoutResult> {
  const priceId = getPriceIdForTier(tier, interval);
  if (!priceId || !getStripe()) return { kind: 'unavailable' };

  const quantity = await getTeamQuantity(team.id);
  if (team.stripeSubscriptionId) {
    try {
      const updated = await changeTeamStripeSubscription(team.stripeSubscriptionId, priceId, quantity);
      if (updated) {
        await syncTeamStripeSubscription(team.id, updated);
        subscriptionEventsTotal.inc({ event: 'auto_renew_enabled', result: 'success' });
        return { kind: 'updated', url: dashboardUrl('?tab=team&checkout=success') };
      }
    } catch (error) {
      log.warn({ error, teamId: team.id, stripeSubscriptionId: team.stripeSubscriptionId }, 'stored subscription unavailable');
      await clearTeamStripeSubscription(team.id, team.stripeSubscriptionId);
    }
  }

  const customerId = await ensureCustomer(team, user);
  if (!customerId) return { kind: 'failed' };

  const checkout = {
    customerId,
    priceId,
    tier,
    teamId: team.id,
    quantity,
    successUrl: dashboardUrl('?tab=team&checkout=success'),
    cancelUrl: dashboardUrl('?tab=team&checkout=cancel'),
  };

  try {
    const url = await createTeamCheckoutSession(checkout);
    if (!url) return { kind: 'failed' };
    subscriptionEventsTotal.inc({ event: 'auto_renew_enabled', result: 'success' });
    return { kind: 'created', url };
  } catch (error) {
    if (customerId !== team.stripeCustomerId) throw error;

    log.warn({ error, teamId: team.id, customerId }, 'checkout customer rejected; retrying with replacement');
    const replacement = await createTeamStripeCustomer({
      teamId: team.id,
      name: team.name ?? `${user.username}'s Team`,
    });
    if (!replacement) return { kind: 'failed' };

    await setTeamStripeCustomerId(team.id, replacement);
    const url = await createTeamCheckoutSession({ ...checkout, customerId: replacement });
    if (!url) return { kind: 'failed' };
    subscriptionEventsTotal.inc({ event: 'auto_renew_enabled', result: 'success' });
    return { kind: 'created', url };
  }
}

export async function downgradeTeamToFree(team: Team): Promise<Team | null> {
  if (team.stripeSubscriptionId) {
    const canceled = await cancelTeamStripeSubscription(team.stripeSubscriptionId);
    if (!canceled) return null;
    await clearTeamStripeSubscription(team.id, team.stripeSubscriptionId);
  } else {
    await clearTeamStripeSubscription(team.id);
  }

  const updated = await getTeamById(team.id);
  if (updated) {
    subscriptionEventsTotal.inc({ event: 'auto_renew_disabled', result: 'success' });
  }
  return updated;
}

export async function createTeamBillingPortal(team: Team): Promise<
  { kind: 'missing' } | { kind: 'unavailable' } | { kind: 'created'; url: string } | { kind: 'failed' }
> {
  if (!team.stripeCustomerId) return { kind: 'missing' };
  if (!await stripeCustomerExists(team.stripeCustomerId)) {
    await clearStaleBillingState(team.id);
    return { kind: 'missing' };
  }

  const url = await createBillingPortalSession({
    customerId: team.stripeCustomerId,
    returnUrl: dashboardUrl('?tab=team'),
  });
  if (!url) return { kind: 'unavailable' };
  return { kind: 'created', url };
}
