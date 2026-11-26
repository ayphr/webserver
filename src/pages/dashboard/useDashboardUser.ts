import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { getStoredAccounts, updateStoredAccount, type StoredAccount } from '../../lib/accounts';
import type { CreditBalance, Punishment, SelfUser } from '@common';

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
  const [user, setUser] = useState<SelfUser | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [activeSuspension, setActiveSuspension] = useState<Punishment | null>(null);
  const [accounts, setAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const userData = await api.users.me();
      setUser(userData.user);
      setCredits(userData.credits);
      setActiveSuspension(userData.activeSuspension);
      const token = api.getAuthToken();
      if (token) updateStoredAccount(token, userData.user);
      setAccounts(getStoredAccounts());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
      setLoadError(message);
      console.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    user,
    credits,
    activeSuspension,
    accounts,
    isLoading,
    loadError,
    reload,
    setUser,
    setCredits,
    setActiveSuspension,
    setAccounts,
  };
}