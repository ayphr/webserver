import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { getStoredAccounts, updateStoredAccount, type StoredAccount } from '../../lib/accounts';
import type { CreditBalance, Punishment, SelfUser, UserMePayload } from '@common';
import { bootstrapQueryOptions } from '../../lib/query/bootstrap';
import { queryKeys } from '../../lib/query';

export type DashboardUserData = {
  user: SelfUser | null;
  credits: CreditBalance | null;
  activeSuspension: Punishment | null;
  accounts: StoredAccount[];
  isLoading: boolean;
  loadError: string | null;
  reload: () => void;
  setUser: (user: SelfUser | null) => void;
  setCredits: (credits: CreditBalance | null) => void;
  setActiveSuspension: (suspension: Punishment | null) => void;
  setAccounts: (accounts: StoredAccount[]) => void;
};

export function useDashboardUser(): DashboardUserData {
  const queryClient = useQueryClient();
  const bootstrap = useQuery(bootstrapQueryOptions(api));
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());

  useEffect(() => {
    const data = bootstrap.data;
    if (!data) return;
    const token = api.getAuthToken();
    if (token) {
      updateStoredAccount(token, data.user);
      // Sync local account list after token-user update.
      queueMicrotask(() => setAccounts(getStoredAccounts()));
    }
  }, [bootstrap.data]);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() });
  }, [queryClient]);

  const setUser = useCallback((user: SelfUser | null) => {
    queryClient.setQueryData<UserMePayload | undefined>(queryKeys.bootstrap(), (old) => {
      if (!old || !user) return old;
      return { ...old, user };
    });
  }, [queryClient]);

  const setCredits = useCallback((credits: CreditBalance | null) => {
    queryClient.setQueryData<UserMePayload | undefined>(queryKeys.bootstrap(), (old) => {
      if (!old || !credits) return old;
      return { ...old, credits };
    });
  }, [queryClient]);

  const setActiveSuspension = useCallback((activeSuspension: Punishment | null) => {
    queryClient.setQueryData<UserMePayload | undefined>(queryKeys.bootstrap(), (old) => {
      if (!old) return old;
      return { ...old, activeSuspension };
    });
  }, [queryClient]);

  const loadError = bootstrap.error instanceof Error ? bootstrap.error.message : bootstrap.error ? 'Failed to load dashboard data' : null;

  return useMemo(() => ({
    user: bootstrap.data?.user ?? null,
    credits: bootstrap.data?.credits ?? null,
    activeSuspension: bootstrap.data?.activeSuspension ?? null,
    accounts,
    isLoading: !bootstrap.data && bootstrap.isPending,
    loadError,
    reload,
    setUser,
    setCredits,
    setActiveSuspension,
    setAccounts,
  }), [accounts, bootstrap.data, bootstrap.isPending, loadError, reload, setActiveSuspension, setCredits, setUser]);
}