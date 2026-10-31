import type { CreditBalance, User, UserCredits } from '@common';
import { getCreditPeriodStart, getPlanTier, resolveCreditBalance } from '@common';
import { getUserFromUuid, updateUserCredits } from './db';

type CreditUser = Pick<User, 'paidSubscriptions' | 'attachedSubscriptions' | 'credits'>;

/** Resolves the credit balance for an already-loaded user. */
export function getCreditBalance(user: CreditUser, now: Date = new Date()): CreditBalance {
  return resolveCreditBalance(getPlanTier(user), user.credits, now);
}

/** Loads a user and resolves their credit balance. */
export async function getCreditBalanceFromUuid(
  uuid: string,
  now: Date = new Date(),
): Promise<CreditBalance | null> {
  const user = await getUserFromUuid(uuid);
  return user ? getCreditBalance(user, now) : null;
}

function toStoredCredits(
  balance: CreditBalance,
  now: Date,
  overrides: Partial<Pick<UserCredits, 'monthlyUsed' | 'additional' | 'onHold'>> = {},
): UserCredits {
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

/**
 * Adds purchased credits, capped at the user's plan limit. Additional credits
 * persist across monthly resets.
 */
export async function addAdditionalCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const balance = getCreditBalance(user, now);
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const added = Math.min(requested, balance.additionalCapacity);

  if (added <= 0) {
    return { credits: balance, changed: false };
  }

  const stored = toStoredCredits(balance, now, { additional: balance.additional + added });
  await updateUserCredits(userUuid, stored);

  return { credits: resolveCreditBalance(balance.plan, stored, now), changed: true };
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
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const balance = getCreditBalance(user, now);
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const held = Math.min(requested, balance.available);

  if (held <= 0) {
    return { credits: balance, changed: false };
  }

  const stored = toStoredCredits(balance, now, { onHold: balance.onHold + held });
  await updateUserCredits(userUuid, stored);

  return { credits: resolveCreditBalance(balance.plan, stored, now), changed: true };
}

/** Releases held credits so they can be spent again. */
export async function releaseCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const balance = getCreditBalance(user, now);
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const released = Math.min(requested, balance.onHold);

  if (released <= 0) {
    return { credits: balance, changed: false };
  }

  const stored = toStoredCredits(balance, now, { onHold: balance.onHold - released });
  await updateUserCredits(userUuid, stored);

  return { credits: resolveCreditBalance(balance.plan, stored, now), changed: true };
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

  const balance = getCreditBalance(user, now);
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;

  if (requested <= 0) {
    return { credits: balance, changed: false };
  }

  if (requested > balance.available) {
    return { credits: balance, changed: false };
  }

  const fromMonthly = Math.min(requested, balance.monthlyRemaining);
  const fromAdditional = requested - fromMonthly;

  const stored = toStoredCredits(balance, now, {
    monthlyUsed: balance.monthlyUsed + fromMonthly,
    additional: balance.additional - fromAdditional,
  });
  await updateUserCredits(userUuid, stored);

  return { credits: resolveCreditBalance(balance.plan, stored, now), changed: true };
}
