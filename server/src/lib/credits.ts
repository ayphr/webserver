import type { CreditBalance, User, TeamCredits } from '@common';
import { getCreditPeriodStart, getPlanTier, resolveCreditBalance } from '@common';
import { getUserFromUuid } from './db';
import { getTeamForUser, updateTeamCredits, getTeamSharedSeats } from './db/teams';

type CreditUser = Pick<User, 'uuid' | 'paidSubscriptions' | 'attachedSubscriptions' | 'teamId'>;

async function getTeamContext(user: CreditUser) {
  const team = await getTeamForUser(user as unknown as User);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : 1;
  const tier = (team?.tier ?? getPlanTier(user)) as Parameters<typeof resolveCreditBalance>[0];
  return { team, manager, seats, tier };
}

/** Resolves the credit balance for an already-loaded user. */
export async function getCreditBalance(user: CreditUser, now: Date = new Date()): Promise<CreditBalance> {
  const { team, seats, tier } = await getTeamContext(user);
  return resolveCreditBalance(tier, team?.credits, now, seats);
}

/** Loads a user and resolves their credit balance. */
export async function getCreditBalanceFromUuid(
  uuid: string,
  now: Date = new Date(),
): Promise<CreditBalance | null> {
  const user = await getUserFromUuid(uuid);
  if (!user) return null;
  return getCreditBalance(user, now);
}

function toStoredCredits(
  balance: CreditBalance,
  now: Date,
  overrides: Partial<Pick<TeamCredits, 'monthlyUsed' | 'additional' | 'onHold'>> = {},
): TeamCredits {
  return {
    periodStart: getCreditPeriodStart(now),
    monthlyUsed: overrides.monthlyUsed ?? balance.monthlyUsed,
    additional: overrides.additional ?? balance.additional,
    onHold: overrides.onHold ?? balance.onHold,
  };
}

export type CreditMutationResult = {
  credits: CreditBalance;
  /** False when the mutation was rejected or had no effect. */
  changed: boolean;
};

async function mutateCredits(
  userUuid: string,
  now: Date,
  apply: (balance: CreditBalance) => { stored: TeamCredits; changed: boolean },
): Promise<CreditMutationResult | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const { team, seats, tier } = await getTeamContext(user);
  if (!team) return null;

  const balance = resolveCreditBalance(tier, team.credits, now, seats);
  const { stored, changed } = apply(balance);
  if (!changed) return { credits: balance, changed: false };

  await updateTeamCredits(team.id, stored);
  return { credits: resolveCreditBalance(tier, stored, now, seats), changed: true };
}

/**
 * Adds purchased credits, capped at the user's plan limit. Additional credits
 * persist across monthly resets.
 */
export async function addAdditionalCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  return mutateCredits(userUuid, now, (balance) => {
    const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const added = Math.min(requested, balance.additionalCapacity);
    if (added <= 0) return { stored: toStoredCredits(balance, now), changed: false };
    return { stored: toStoredCredits(balance, now, { additional: balance.additional + added }), changed: true };
  });
}

/**
 * Reserves credits for pending work. Held credits are still owned by the user
 * but are removed from the spendable balance until released.
 */
export async function holdCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  return mutateCredits(userUuid, now, (balance) => {
    const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const held = Math.min(requested, balance.available);
    if (held <= 0) return { stored: toStoredCredits(balance, now), changed: false };
    return { stored: toStoredCredits(balance, now, { onHold: balance.onHold + held }), changed: true };
  });
}

/** Releases held credits so they can be spent again. */
export async function releaseCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  return mutateCredits(userUuid, now, (balance) => {
    const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    const released = Math.min(requested, balance.onHold);
    if (released <= 0) return { stored: toStoredCredits(balance, now), changed: false };
    return { stored: toStoredCredits(balance, now, { onHold: balance.onHold - released }), changed: true };
  });
}

/**
 * Spends credits, using the monthly allowance first and additional credits
 * second. Returns `changed: false` when the user cannot afford the cost.
 */
export async function consumeCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const { team, seats, tier } = await getTeamContext(user);
  if (!team) return null;

  const balance = resolveCreditBalance(tier, team.credits, now, seats);

  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (requested <= 0) return { credits: balance, changed: false };
  if (requested > balance.available) return { credits: balance, changed: false };

  const fromMonthly = Math.min(requested, balance.monthlyRemaining);
  const fromAdditional = requested - fromMonthly;
  const stored = toStoredCredits(balance, now, {
    monthlyUsed: balance.monthlyUsed + fromMonthly,
    additional: balance.additional - fromAdditional,
  });

  await updateTeamCredits(team.id, stored);

  return { credits: resolveCreditBalance(tier, stored, now, seats), changed: true };
}