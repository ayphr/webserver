import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import type { PolicyKey, PolicyStatus } from '@common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input } from '../common';
import { bootstrapQueryOptions } from '../../lib/query/bootstrap';
import { queryKeys } from '../../lib/query';
import './PolicyGate.css';

const POLICY_META: Record<PolicyKey, { title: string; to: string }> = {
  tos: { title: 'Terms of Service', to: '/policies/terms' },
  privacy: { title: 'Privacy Policy', to: '/policies/privacy' },
};

type GateState = 'loading' | 'ready' | 'required';

export const PolicyGate = ({
  children,
  loadingFallback,
}: {
  children: ReactNode;
  loadingFallback?: ReactNode;
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ ...bootstrapQueryOptions(api), retry: 2 });
  const [status, setStatus] = useState<PolicyStatus | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bootstrap.data?.policyStatus) setStatus(bootstrap.data.policyStatus);
  }, [bootstrap.data?.policyStatus]);

  useEffect(() => {
    const err = bootstrap.error;
    if (err instanceof ApiError && err.status === 401) {
      void navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
    }
  }, [bootstrap.error, navigate]);

  useEffect(() => {
    const handler = () => { void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() }); };
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, [queryClient]);

  // Poll the session so this device is signed out shortly after another
  // device revokes it. A 401 triggers the global unauthorized handler.
  // Only poll while the tab is visible to avoid background work.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() });
      }, 20000);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [queryClient]);

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);

    try {
      await api.auth.acceptPolicies();
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept the updated policies');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Ignore logout failures, the local session is cleared regardless.
    }
    await navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await api.auth.deleteAccount({ password: deletePassword });
      await navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete your account');
      setIsDeleting(false);
      setIsConfirmOpen(false);
    }
  };

  const closeDeleteConfirm = () => {
    setIsConfirmOpen(false);
    setDeletePassword('');
  };

  const loadError = bootstrap.error instanceof ApiError && bootstrap.error.status === 401
    ? null
    : bootstrap.error instanceof Error
      ? bootstrap.error.message
      : bootstrap.error
        ? 'Failed to load your account. Please try again.'
        : null;

  if (loadError && !bootstrap.data) {
    return (
      <div className="policy-gate">
        <div className="policy-gate__container">
          <Card elevated className="policy-gate__card">
            <CardHeader>
              <h1>Couldn&apos;t load your account</h1>
            </CardHeader>
            <CardBody>
              <p className="policy-gate__error" role="alert">{loadError}</p>
              <div className="policy-gate__actions">
                <Button variant="primary" fullWidth isLoading={bootstrap.isFetching} onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() })}>
                  {bootstrap.isFetching ? 'Retrying...' : 'Try again'}
                </Button>
                <Button variant="secondary" fullWidth onClick={() => navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true })}>
                  Back to sign in
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  const policyStatus = bootstrap.data?.policyStatus ?? status;
  const needsPolicy = Boolean(policyStatus && !policyStatus.upToDate);

  if (!bootstrap.data && bootstrap.isPending) {
    if (loadingFallback) {
      return <>{loadingFallback}</>;
    }

    return (
      <div className="policy-gate">
        <div className="policy-gate__container">
          <p className="policy-gate__loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (!needsPolicy || !policyStatus) {
    return <>{children}</>;
  }

  return (
    <div className="policy-gate">
      <div className="policy-gate__container">
        <Card elevated className="policy-gate__card">
          <CardHeader>
            <h1>Updated Policies</h1>
            <p>We&apos;ve updated our policies. Please review and accept them to continue.</p>
          </CardHeader>
          <CardBody>
            <ul className="policy-gate__list">
              {policyStatus.pending.map((key) => (
                <li key={key} className="policy-gate__item">
                  <a href={POLICY_META[key].to} target="_blank" rel="noreferrer">
                    {POLICY_META[key].title}
                  </a>
                  <span className="policy-gate__version">Updated {policyStatus.updatedDates[key] ?? `v${policyStatus.current[key]}`}</span>
                </li>
              ))}
            </ul>

            {error && <div className="policy-gate__error" role="alert">{error}</div>}

            <div className="policy-gate__actions">
              <Button
                variant="primary"
                fullWidth
                isLoading={isAccepting}
                disabled={isAccepting || isDeleting}
                onClick={handleAccept}
              >
                Accept &amp; Continue
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={isAccepting || isDeleting}
                onClick={handleLogout}
              >
                Log Out
              </Button>
              <Button
                variant="danger"
                fullWidth
                disabled={isAccepting || isDeleting}
                onClick={() => setIsConfirmOpen(true)}
              >
                Delete Account
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title="Delete Account"
        confirmText="Delete Account"
        isDangerous
        confirmDisabled={!deletePassword}
        onConfirm={handleDelete}
        onCancel={closeDeleteConfirm}
      >
        <p>
          This will permanently delete your account and all associated data. This action cannot be
          undone. Confirm your password to continue.
        </p>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          revealable
          value={deletePassword}
          placeholder="Enter your password"
          onChange={(e) => setDeletePassword(e.target.value)}
          fullWidth
        />
      </ConfirmDialog>
    </div>
  );
};
