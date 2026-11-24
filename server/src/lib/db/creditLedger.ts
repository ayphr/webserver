import { randomUUID } from 'node:crypto';
import type { CreditTransaction, Team } from '@common';
import { CREDIT_TIMEZONE } from '@common';
import {
  CREDIT_TRANSACTIONS_COLLECTION,
  getCollection,
  log,
  normalizeDateValues,
  TEAMS_COLLECTION,
  trackMongoOperation,
} from './internal';

export type CreditMutationKind = 'grant' | 'hold' | 'release' | 'charge';

export type CreditMutationContext = {
  teamId: string;
  /** Plan allowance for the current month, multiplied by shared seats. */
  monthlyAllowance: number;
  additionalLimit: number;
  /** Current Sydney-month start, used for the lazy monthly reset. */
  periodStart: Date;
  now: Date;
  amount: number;
  actorUuid?: string;
  referenceId?: string;
  reason?: string;
};

export type CreditMutationPlan = {
  /** Includes an `$expr` guard so insufficient balances cannot be committed. */
  filter: Record<string, unknown>;
  update: Array<Record<string, unknown>>;
};

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CREDIT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
});

/** Month key matching the `$dateToString` format used in the Mongo pipeline. */
export const creditMonthKey = (date: Date): string => {
  const parts = Object.fromEntries(
    monthFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
};

const expr = {
  storedPeriod: { $ifNull: ['$credits.periodStart', new Date(0)] },
  monthlyUsed: (currentKey: string) => ({
    $cond: [
      {
        $eq: [
          { $dateToString: { date: { $ifNull: ['$credits.periodStart', new Date(0)] }, format: '%Y-%m', timezone: CREDIT_TIMEZONE } },
          currentKey,
        ],
      },
      { $ifNull: ['$credits.monthlyUsed', 0] },
      0,
    ],
  }),
  onHold: { $ifNull: ['$credits.onHold', 0] },
  additional: { $ifNull: ['$credits.additional', 0] },
};

const max = (left: unknown, right: unknown) => ({ $max: [left, right] });
const subtract = (left: unknown, right: unknown) => ({ $subtract: [left, right] });
const add = (left: unknown, right: unknown) => ({ $add: [left, right] });

/**
 * Builds a single guarded `findOneAndUpdate` pipeline. The guard and the new
 * counters are evaluated atomically by MongoDB, removing the read-modify-write
 * race in the previous credit helpers.
 *
 * Unlike the legacy helpers, requests that exceed the balance are rejected
 * instead of being silently capped. Callers already treat `changed: false` as
 * insufficient credits, so this makes the outcome explicit.
 */
export function buildCreditMutation(
  kind: CreditMutationKind,
  context: CreditMutationContext,
): CreditMutationPlan {
  const amount = Math.max(0, Number.isFinite(context.amount) ? context.amount : 0);
  const currentKey = creditMonthKey(context.periodStart);
  const monthlyUsed = expr.monthlyUsed(currentKey);
  const monthlyRemaining = max(0, subtract(context.monthlyAllowance, monthlyUsed));
  const available = max(0, subtract(add(monthlyRemaining, expr.additional), expr.onHold));

  let guard: Record<string, unknown>;
  let nextMonthlyUsed: unknown = monthlyUsed;
  let nextAdditional: unknown = expr.additional;
  let nextOnHold: unknown = expr.onHold;

  switch (kind) {
    case 'grant':
      guard = { $lte: [add(expr.additional, amount), context.additionalLimit] };
      nextAdditional = add(expr.additional, amount);
      break;
    case 'hold':
      guard = { $gte: [available, amount] };
      nextOnHold = add(expr.onHold, amount);
      break;
    case 'release':
      guard = { $gte: [expr.onHold, amount] };
      nextOnHold = subtract(expr.onHold, amount);
      break;
    case 'charge': {
      guard = { $gte: [available, amount] };
      const fromMonthly = { $min: [amount, monthlyRemaining] };
      nextMonthlyUsed = add(monthlyUsed, fromMonthly);
      nextAdditional = subtract(expr.additional, subtract(amount, fromMonthly));
      break;
    }
  }

  return {
    filter: { id: context.teamId, $expr: guard },
    update: [
      {
        $set: {
          credits: {
            periodStart: context.periodStart,
            monthlyUsed: nextMonthlyUsed,
            additional: nextAdditional,
            onHold: nextOnHold,
          },
          updatedAt: context.now,
        },
      },
    ],
  };
}

export type CreditMutationOutcome = {
  changed: boolean;
  team: Team | null;
};

/** Applies the guarded mutation and writes its immutable ledger entry. */
export async function mutateCreditsAtomically(
  kind: CreditMutationKind,
  context: CreditMutationContext,
): Promise<CreditMutationOutcome> {
  const amount = Math.max(0, Number.isFinite(context.amount) ? context.amount : 0);
  if (amount <= 0) return { changed: false, team: null };

  const plan = buildCreditMutation(kind, context);
  const teams = await getCollection('teams');
  trackMongoOperation('findOneAndUpdate', TEAMS_COLLECTION);
  const updated = await teams.findOneAndUpdate(plan.filter, plan.update, {
    returnDocument: 'after',
  }) as Team | null;
  if (!updated) return { changed: false, team: null };

  const ledger: CreditTransaction = {
    id: randomUUID(),
    teamId: context.teamId,
    ...(context.actorUuid ? { actorUuid: context.actorUuid } : {}),
    kind,
    amount,
    monthlyUsed: updated.credits?.monthlyUsed ?? 0,
    additional: updated.credits?.additional ?? 0,
    onHold: updated.credits?.onHold ?? 0,
    ...(context.referenceId ? { referenceId: context.referenceId } : {}),
    ...(context.reason ? { reason: context.reason } : {}),
    createdAt: context.now,
  };

  try {
    const transactions = await getCollection('creditTransactions');
    trackMongoOperation('insertOne', CREDIT_TRANSACTIONS_COLLECTION);
    await transactions.insertOne(normalizeDateValues(ledger) as CreditTransaction);
  } catch (error) {
    // The balance update commits first; a failed ledger insert must not roll
    // back a charge that the caller may have already reported as successful.
    log.warn({ error, teamId: context.teamId, kind }, 'failed to record credit transaction');
  }

  return { changed: true, team: updated };
}

/** Returns the most recent credit transactions for a team, newest first. */
export async function listCreditTransactions(teamId: string, limit = 50): Promise<CreditTransaction[]> {
  const transactions = await getCollection('creditTransactions');
  trackMongoOperation('find', CREDIT_TRANSACTIONS_COLLECTION);
  return transactions
    .find({ teamId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .toArray() as Promise<CreditTransaction[]>;
}
