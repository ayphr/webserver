import { describe, expect, it } from 'bun:test';
import { buildCreditMutation, creditMonthKey } from './creditLedger';

const now = new Date('2026-11-05T00:00:00.000Z');
const base = {
  teamId: 'team-1',
  monthlyAllowance: 100,
  additionalLimit: 50,
  periodStart: now,
  now,
  amount: 10,
};

const creditsOf = (plan: ReturnType<typeof buildCreditMutation>) => {
  const set = plan.update[0]?.$set as Record<string, unknown> | undefined;
  return set?.credits as Record<string, unknown> | undefined;
};
const guardOf = (plan: ReturnType<typeof buildCreditMutation>) => plan.filter.$expr;

describe('atomic credit mutation', () => {
  it('derives the same Sydney month key used by the balance resolver', () => {
    expect(creditMonthKey(now)).toBe('2026-11');
    // 13:00 UTC is already the next day in Sydney.
    expect(creditMonthKey(new Date('2026-11-30T14:00:00.000Z'))).toBe('2026-12');
  });

  it('guards a hold against the full available balance', () => {
    const plan = buildCreditMutation('hold', base);
    expect(plan.filter).toMatchObject({ id: 'team-1' });
    expect(JSON.stringify(guardOf(plan))).toContain('$gte');
    expect(creditsOf(plan)).toMatchObject({ onHold: { $add: [{ $ifNull: ['$credits.onHold', 0] }, 10] } });
  });

  it('guards a release against the held balance', () => {
    const plan = buildCreditMutation('release', base);
    expect(JSON.stringify(guardOf(plan))).toContain('$gte');
    expect(JSON.stringify(guardOf(plan))).toContain('$credits.onHold');
  });

  it('splits a charge between monthly allowance and additional credits', () => {
    const plan = buildCreditMutation('charge', base);
    const stored = creditsOf(plan);
    if (!stored) throw new Error('credit mutation did not produce a $set.credits pipeline');
    expect(JSON.stringify(stored.monthlyUsed)).toContain('$min');
    expect(JSON.stringify(stored.additional)).toContain('$subtract');
  });

  it('caps a grant by the plan additional-credit limit', () => {
    const plan = buildCreditMutation('grant', { ...base, amount: 100 });
    expect(JSON.stringify(guardOf(plan))).toContain('50');
  });

  it('resets monthly usage in the pipeline when the stored period is stale', () => {
    const plan = buildCreditMutation('charge', base);
    const serialized = JSON.stringify(creditsOf(plan));
    expect(serialized).toContain('%Y-%m');
    expect(serialized).toContain('Australia/Sydney');
    expect(serialized).toContain('$cond');
  });
});
