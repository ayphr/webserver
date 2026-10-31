import type { PlanTier } from './plans';

/**
 * Credit state stored on a user document.
 *
 * `monthlyUsed` only applies to the calendar month (in the server's timezone)
 * recorded in `periodStart`.
 * `additional` and `onHold` are not tied to a period and persist across resets.
 */
export type UserCredits = {
  periodStart?: Date | null;
  monthlyUsed: number;
  additional: number;
  onHold: number;
};

/** A fully resolved credit balance for the user's current plan. */
export type CreditBalance = {
  plan: PlanTier;
  /** IANA timezone the monthly reset boundary is based on. */
  timezone: string;
  /** Credits granted by the plan each month. */
  monthlyAllowance: number;
  /** Credits consumed from this month's allowance. */
  monthlyUsed: number;
  /** Allowance remaining for this month. */
  monthlyRemaining: number;
  /** When the monthly allowance next resets. */
  monthlyResetsAt: Date;
  /** Purchased credits that carry over between months. */
  additional: number;
  /** Maximum additional credits the plan allows. */
  additionalLimit: number;
  /** How many more additional credits can still be bought. */
  additionalCapacity: number;
  /** Credits reserved for pending work; owned but not spendable. */
  onHold: number;
  /** Monthly remaining plus additional credits, before holds. */
  total: number;
  /** Credits that can be spent right now. */
  available: number;
};

export type CreditsMePayload = {
  credits: CreditBalance;
};
