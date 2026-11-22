import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import { Button, Card, CardBody, CardHeader, CodeInput, Input } from '../common';
import { EMAIL_CODE_LENGTH, getEmailValidationError, normalizeEmail } from '@common/utils/email';
import './EmailGate.css';

type GateState = 'loading' | 'ready' | 'required';
type GateStep = 'email' | 'code';

export const EmailGate = ({
  children,
  loadingFallback,
}: {
  children: ReactNode;
  loadingFallback?: ReactNode;
}) => {
  const navigate = useNavigate();
  const [state, setState] = useState<GateState>('loading');
  const [step, setStep] = useState<GateStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

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
            if (cancelled) clearTimeout(t);
          });
          if (cancelled) return;
        }
        try {
          const { user } = await api.auth.me();
          if (cancelled) return;
          setIsRetrying(false);
          if (user.email) {
            setState('ready');
          } else {
            setState('required');
          }
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) {
            setIsRetrying(false);
            await navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
            return;
          }
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

  useEffect(() => {
    const handler = () => setRetryKey((k) => k + 1);
    window.addEventListener('online', handler);
    return () => window.removeEventListener('online', handler);
  }, []);

  const handleRequestCode = async () => {
    setError(null);
    const emailError = getEmailValidationError(email.trim());
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }
    setIsLoading(true);
    try {
      await api.auth.requestEmailChange({ email: normalizeEmail(email), currentPassword: password });
      setCode('');
      setResendCooldown(30);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    setError(null);
    if (code.length !== EMAIL_CODE_LENGTH) {
      setError(`Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`);
      return;
    }
    setIsLoading(true);
    try {
      await api.auth.confirmEmailChange({ email: normalizeEmail(email), code });
      api.users.invalidateMe();
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      await api.auth.requestEmailChange({ email: normalizeEmail(email), currentPassword: password });
      setCode('');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setIsLoading(false);
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

  if (loadError) {
    return (
      <div className="email-gate">
        <div className="email-gate__container">
          <Card elevated className="email-gate__card">
            <CardHeader>
              <h1>Couldn&apos;t load your account</h1>
            </CardHeader>
            <CardBody>
              <p className="email-gate__error">{loadError}</p>
              <div className="email-gate__actions">
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
    if (loadingFallback) return <>{loadingFallback}</>;
    return (
      <div className="email-gate">
        <div className="email-gate__container">
          <p className="email-gate__loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (state === 'ready') return <>{children}</>;

  return (
    <div className="email-gate">
      <div className="email-gate__container">
        <Card elevated className="email-gate__card">
          <CardHeader>
            <h1>Add your email</h1>
            <p>Ayphr now requires a verified email address on every account. Add one to continue.</p>
          </CardHeader>
          <CardBody>
            {error && <div className="email-gate__error" role="alert">{error}</div>}

            {step === 'email' && (
              <form className="email-gate__form" onSubmit={(e) => { e.preventDefault(); void handleRequestCode(); }}>
                <Input
                  label="Email address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                <Input
                  label="Current password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  revealable
                  placeholder="Enter your current password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit">
                  Send verification code
                </Button>
                <Button variant="secondary" fullWidth disabled={isLoading} onClick={handleLogout}>
                  Log out
                </Button>
              </form>
            )}

            {step === 'code' && (
              <form className="email-gate__form" onSubmit={(e) => { e.preventDefault(); void handleConfirm(); }}>
                <p className="email-gate__hint">
                  We sent a {EMAIL_CODE_LENGTH}-digit code to <strong>{email}</strong>. Enter it to verify your email.
                </p>
                <CodeInput value={code} onChange={setCode} disabled={isLoading} autoFocus />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit">
                  Verify email
                </Button>
                <div className="email-gate__resend">
                  <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isLoading}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={() => { setStep('email'); setCode(''); setError(null); }} disabled={isLoading}>
                    Change email
                  </Button>
                </div>
                <Button variant="secondary" fullWidth disabled={isLoading} onClick={handleLogout}>
                  Log out
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};