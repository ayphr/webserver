import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import type { PolicyKey, PolicyStatus } from '@common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog, Input } from '../common';
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
  const [state, setState] = useState<GateState>('loading');
  const [status, setStatus] = useState<PolicyStatus | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadError(null);
      setIsRetrying(false);
      const MAX_ATTEMPTS = 3;
      const DELAYS = [0, 700, 2000];

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        if (cancelled) return;
        if (i > 0) {
          setIsRetrying(true);
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, DELAYS[i]);
            // allow cleanup to cancel the pending retry
            if (cancelled) clearTimeout(t);
          });
          if (cancelled) return;
        }
        try {
          const { policyStatus } = await api.users.me();
          if (cancelled) return;
          setIsRetrying(false);
          if (policyStatus && !policyStatus.upToDate) {
            setStatus(policyStatus);
            setState('required');
          } else {
            setState('ready');
          }
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) {
            setIsRetrying(false);
            await navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
            return;
          }
          // Transient failure: retry a few times before surfacing.
          if (i === MAX_ATTEMPTS - 1) {
            setIsRetrying(false);
            setLoadError(err instanceof Error ? err.message : 'Failed to load your account. Please try again.');
          }
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [navigate, retryKey]);

  // Auto-retry when the network comes back online.
  useEffect(() => {
    const handler = () => setRetryKey((k) => k + 1);
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, []);

  // Poll the session so this device is signed out shortly after another
  // device revokes it. A 401 triggers the global unauthorized handler.
  // Only poll while the tab is visible to avoid background work.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        void api.users.me().catch(() => undefined);
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
  }, []);

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);

    try {
      await api.auth.acceptPolicies();
      setState('ready');
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

  if (loadError) {
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
                <Button variant="primary" fullWidth isLoading={isRetrying} onClick={() => setRetryKey((k) => k + 1)}>
                  {isRetrying ? 'Retrying...' : 'Try again'}
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

  if (state === 'loading') {
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

  if (state === 'ready' || !status) {
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
              {status.pending.map((key) => (
                <li key={key} className="policy-gate__item">
                  <a href={POLICY_META[key].to} target="_blank" rel="noreferrer">
                    {POLICY_META[key].title}
                  </a>
                  <span className="policy-gate__version">Updated {status.updatedDates[key] ?? `v${status.current[key]}`}</span>
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
