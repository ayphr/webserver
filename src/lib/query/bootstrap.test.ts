import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './keys';
import { bootstrapQueryOptions } from './bootstrap';

describe('bootstrap query', () => {
  test('bootstrap cache hit is available synchronously', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.bootstrap(), {
      user: { uuid: 'u1', username: 'alice', email: 'a@b.com', role: 'user', badges: [], hasAvatar: false },
      policyStatus: { upToDate: true, current: { tos: 1, privacy: 1 }, accepted: { tos: 1, privacy: 1 }, pending: [], updatedDates: { tos: null, privacy: null } },
      activeSuspension: null,
      credits: { available: 0, monthlyAllowance: 0, monthlyUsed: 0, purchased: 0, held: 0, plan: 'free', nextRefreshAt: new Date().toISOString() },
    });
    expect(qc.getQueryData(queryKeys.bootstrap())).toBeTruthy();
  });

  test('bootstrapQueryOptions uses bootstrap key', () => {
    const opts = bootstrapQueryOptions({ users: { me: async () => ({}) } } as never);
    expect(opts.queryKey as readonly unknown[]).toEqual(['bootstrap']);
  });
});
