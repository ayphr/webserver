import { beforeEach, describe, expect, it, mock } from 'bun:test';

type Mutation = { kind: string; amount: number };

const mutations: Mutation[] = [];
const team = {
  id: 'team-1',
  managerUuid: 'user-1',
  tier: 'plus',
  credits: {
    periodStart: null,
    monthlyUsed: 0,
    additional: 100,
    onHold: 0,
  },
};
let chargeAccepted = true;

mock.module('./db', () => ({
  getUserFromUuid: async () => ({ uuid: 'user-1', teamId: 'team-1' }),
}));
mock.module('./db/teams', () => ({
  getTeamForUser: async () => team,
  getTeamSharedSeats: async () => 1,
}));
mock.module('./db/creditLedger', () => ({
  mutateCreditsAtomically: async (kind: string, context: { amount: number }) => {
    mutations.push({ kind, amount: context.amount });
    if (kind === 'hold') {
      if (team.credits.onHold + context.amount > team.credits.additional) {
        return { changed: false, team };
      }
      team.credits.onHold += context.amount;
    } else if (kind === 'release') {
      if (team.credits.onHold < context.amount) return { changed: false, team };
      team.credits.onHold -= context.amount;
    } else if (kind === 'charge') {
      if (!chargeAccepted || team.credits.additional < context.amount) {
        return { changed: false, team };
      }
      team.credits.additional -= context.amount;
    }
    return { changed: true, team };
  },
}));

const { holdCredits, settleCreditHold } = await import('./credits');

describe('settleCreditHold', () => {
  beforeEach(() => {
    mutations.length = 0;
    team.credits.additional = 100;
    team.credits.onHold = 0;
    chargeAccepted = true;
  });

  it('does not release a second hold when the charge is rejected', async () => {
    expect((await holdCredits('user-1', 10))?.changed).toBe(true);
    expect((await holdCredits('user-1', 10))?.changed).toBe(true);
    expect(team.credits.onHold).toBe(20);

    chargeAccepted = false;
    const settled = await settleCreditHold('user-1', 10, 4);

    expect(settled).toBe(-1);
    expect(mutations.filter((mutation) => mutation.kind === 'release')).toHaveLength(1);
    // The unrelated stream's hold must remain reserved.
    expect(team.credits.onHold).toBe(10);
  });

  it('charges the held amount once when settlement succeeds', async () => {
    expect((await holdCredits('user-1', 10))?.changed).toBe(true);

    const settled = await settleCreditHold('user-1', 10, 4);

    expect(settled).toBe(4);
    expect(mutations.filter((mutation) => mutation.kind === 'release')).toHaveLength(1);
    expect(mutations.filter((mutation) => mutation.kind === 'charge')).toHaveLength(1);
    expect(team.credits.onHold).toBe(0);
    expect(team.credits.additional).toBe(96);
  });
});
