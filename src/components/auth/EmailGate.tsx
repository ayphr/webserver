import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
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
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const { user } = await api.auth.me();
        if (!active) return;
        if (user.email) {
          setState('ready');
        } else {
          setState('required');
        }
      } catch {
        if (!active) return;
        await navigate(`/auth/login?redirect=${encodeURIComponent(globalThis.location.pathname + globalThis.location.search)}`, { replace: true });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [navigate]);

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
            {error && <div className="email-gate__error">{error}</div>}

            {step === 'email' && (
              <div className="email-gate__form">
                <Input
                  label="Email address"
                  name="email"
                  type="email"
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
                  placeholder="Enter your current password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} onClick={handleRequestCode}>
                  Send verification code
                </Button>
                <Button variant="secondary" fullWidth disabled={isLoading} onClick={handleLogout}>
                  Log out
                </Button>
              </div>
            )}

            {step === 'code' && (
              <div className="email-gate__form">
                <p className="email-gate__hint">
                  We sent a {EMAIL_CODE_LENGTH}-digit code to <strong>{email}</strong>. Enter it to verify your email.
                </p>
                <CodeInput value={code} onChange={setCode} disabled={isLoading} />
                <Button variant="primary" fullWidth isLoading={isLoading} onClick={handleConfirm}>
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
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};