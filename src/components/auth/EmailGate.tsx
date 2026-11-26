import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import { Button, Card, CardBody, CardHeader, CodeInput, Input } from '../common';
import { EMAIL_CODE_LENGTH, getEmailValidationError, normalizeEmail } from '@common/utils/email';
import { bootstrapQueryOptions } from '../../lib/query/bootstrap';
import { queryKeys } from '../../lib/query';
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
  const queryClient = useQueryClient();
  const bootstrap = useQuery({ ...bootstrapQueryOptions(api), retry: 2 });
  const [step, setStep] = useState<GateStep>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

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
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() });
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

  const loadError = bootstrap.error instanceof ApiError && bootstrap.error.status === 401
    ? null
    : bootstrap.error instanceof Error
      ? bootstrap.error.message
      : bootstrap.error
        ? 'Failed to load your account. Please try again.'
        : null;

  if (loadError && !bootstrap.data) {
    return (
      <div className="email-gate">
        <div className="email-gate__container">
          <Card elevated className="email-gate__card">
            <CardHeader>
              <h1>Couldn&apos;t load your account</h1>
            </CardHeader>
            <CardBody>
              <p className="email-gate__error" role="alert">{loadError}</p>
              <div className="email-gate__actions">
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

  if (!bootstrap.data && bootstrap.isPending) {
    if (loadingFallback) return <>{loadingFallback}</>;
    return (
      <div className="email-gate">
        <div className="email-gate__container">
          <p className="email-gate__loading">Loading...</p>
        </div>
      </div>
    );
  }

  if (bootstrap.data?.user.email) return <>{children}</>;

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