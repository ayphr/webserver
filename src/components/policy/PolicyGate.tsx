import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { PolicyKey, PolicyStatus } from '../../../common';
import { Button, Card, CardBody, CardHeader, ConfirmDialog } from '../common';
import './PolicyGate.css';

const POLICY_META: Record<PolicyKey, { title: string; to: string }> = {
  tos: { title: 'Terms of Service', to: '/policies/terms' },
  privacy: { title: 'Privacy Policy', to: '/policies/privacy' },
};

type GateState = 'loading' | 'ready' | 'required';

export const PolicyGate = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>('loading');
  const [status, setStatus] = useState<PolicyStatus | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const { policyStatus } = await api.auth.me();
        if (!active) return;

        if (policyStatus && !policyStatus.upToDate) {
          setStatus(policyStatus);
          setState('required');
        } else {
          setState('ready');
        }
      } catch {
        if (!active) return;
        navigate('/auth', { replace: true });
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [navigate]);

  // Poll the session so this device is signed out shortly after another
  // device revokes it. A 401 triggers the global unauthorized handler.
  useEffect(() => {
    const interval = setInterval(() => {
      void api.auth.me().catch(() => undefined);
    }, 20000);

    return () => clearInterval(interval);
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
    navigate('/auth', { replace: true });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      await api.auth.deleteAccount();
      navigate('/auth', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete your account');
      setIsDeleting(false);
      setIsConfirmOpen(false);
    }
  };

  if (state === 'loading') {
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

            {error && <div className="policy-gate__error">{error}</div>}

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
        onConfirm={handleDelete}
        onCancel={() => setIsConfirmOpen(false)}
      >
        <p>
          This will permanently delete your account and all associated data. This action cannot be
          undone.
        </p>
      </ConfirmDialog>
    </div>
  );
};
