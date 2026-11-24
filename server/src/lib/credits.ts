import type { CreditBalance, User } from '@common';
import { getCreditPeriodStart, resolveCreditBalance } from '@common';
import { getUserFromUuid } from './db';
import { getTeamForUser, getTeamSharedSeats } from './db/teams';
import { mutateCreditsAtomically } from './db/creditLedger';
import { createLogger } from './logger';

const log = createLogger('credits');

type CreditUser = Pick<User, 'uuid' | 'teamId'>;

async function getTeamContext(user: CreditUser) {
  const team = await getTeamForUser(user as unknown as User);
  const manager = team ? await getUserFromUuid(team.managerUuid) : null;
  const seats = team && manager ? await getTeamSharedSeats(team, manager) : 1;
  const tier = (team?.tier ?? 'free') as Parameters<typeof resolveCreditBalance>[0];
  return { team, manager, seats, tier };
}

/** Resolves the credit balance for an already-loaded user. */
export async function getCreditBalance(user: CreditUser, now: Date = new Date()): Promise<CreditBalance> {
  const { team, seats, tier } = await getTeamContext(user);
  return resolveCreditBalance(tier, team?.credits, now, seats);
}

/** Loads a user and resolves their credit balance. */
export async function getCreditBalanceFromUuid(
  userUuid: string,
  now: Date = new Date(),
): Promise<CreditBalance | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;
  return getCreditBalance(user, now);
}

export type CreditMutationResult = {
  credits: CreditBalance;
  /** False when the mutation was rejected or had no effect. */
  changed: boolean;
};

export type CreditMutationOptions = {
  referenceId?: string;
  reason?: string;
};

/**
 * Applies a guarded atomic credit mutation. The balance check and counter
 * update happen in a single MongoDB pipeline, so concurrent streams cannot
 * both spend the same credits, and every change gets a ledger entry.
 */
async function applyCreditMutation(
  kind: 'grant' | 'hold' | 'release' | 'charge',
  userUuid: string,
  amount: number,
  now: Date,
  options?: CreditMutationOptions,
): Promise<CreditMutationResult | null> {
  const user = await getUserFromUuid(userUuid);
  if (!user) return null;

  const { team, seats, tier } = await getTeamContext(user);
  if (!team) return null;

  const balance = resolveCreditBalance(tier, team.credits, now, seats);
  const requested = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  if (requested <= 0) return { credits: balance, changed: false };

  const outcome = await mutateCreditsAtomically(kind, {
    teamId: team.id,
    actorUuid: userUuid,
    amount: requested,
    monthlyAllowance: balance.monthlyAllowance,
    additionalLimit: balance.additionalLimit,
    periodStart: getCreditPeriodStart(now),
    now,
    ...options,
  });

  if (!outcome.changed || !outcome.team) {
    return { credits: balance, changed: false };
  }
  return {
    credits: resolveCreditBalance(tier, outcome.team.credits, now, seats),
    changed: true,
  };
}

/** Adds purchased credits, capped at the user's plan limit. */
export async function addAdditionalCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
): Promise<CreditMutationResult | null> {
  return applyCreditMutation('grant', userUuid, amount, now, {
    reason: 'additional_credits_granted',
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
  options?: CreditMutationOptions,
): Promise<CreditMutationResult | null> {
  return applyCreditMutation('hold', userUuid, amount, now, options);
}

/** Releases held credits so they can be spent again. */
export async function releaseCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
  options?: CreditMutationOptions,
): Promise<CreditMutationResult | null> {
  return applyCreditMutation('release', userUuid, amount, now, options);
}

/**
 * Spends credits, using the monthly allowance first and additional credits
 * second. Returns `changed: false` when the user cannot afford the cost.
 */
export async function consumeCredits(
  userUuid: string,
  amount: number,
  now: Date = new Date(),
  options?: CreditMutationOptions,
): Promise<CreditMutationResult | null> {
  return applyCreditMutation('charge', userUuid, amount, now, options);
}

const RELEASE_ATTEMPTS = 3;
const CHARGE_ATTEMPTS = 3;

/**
 * Settles an assistant hold into an actual charge. Returns the number of
 * credits charged, or `-1` when settlement could not be completed. A failed
 * settlement must never be reported to the client as a successful stream: the
 * held credits would otherwise stay reserved forever.
 */
export async function settleCreditHold(
  userUuid: string,
  heldCredits: number,
  chargeCredits: number,
  options: CreditMutationOptions = {},
  now: Date = new Date(),
): Promise<number> {
  const held = Number.isFinite(heldCredits) ? Math.max(0, heldCredits) : 0;
  const requested = Number.isFinite(chargeCredits) ? Math.max(0, chargeCredits) : 0;
  const cost = Math.min(held, requested);

  if (held <= 0) return cost > 0 ? -1 : 0;

  let released = false;
  for (let attempt = 0; attempt < RELEASE_ATTEMPTS; attempt += 1) {
    const result = await releaseCredits(userUuid, held, now, {
      ...options,
      reason: options.reason ?? 'assistant_stream_release',
    });
    if (result?.changed) {
      released = true;
      break;
    }
  }
  if (!released) {
    log.warn({ userUuid, referenceId: options.referenceId }, 'failed to release assistant credit hold');
    return -1;
  }

  if (cost <= 0) return 0;

  for (let attempt = 0; attempt < CHARGE_ATTEMPTS; attempt += 1) {
    const result = await consumeCredits(userUuid, cost, now, {
      ...options,
      reason: options.reason ?? 'assistant_stream_charge',
    });
    if (result?.changed) return cost;
    log.warn(
      { userUuid, attempt, referenceId: options.referenceId },
      'assistant credit charge was rejected; reconciling hold and retrying',
    );
    // The hold may have been re-acquired by a concurrent stream; release it
    // again before retrying the charge.
    await releaseCredits(userUuid, held, now, {
      ...options,
      reason: options.reason ?? 'assistant_stream_release',
    });
  }
  return -1;
}
