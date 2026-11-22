import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import './AuthPage.css';
import { Button, Card, CardHeader, CardBody, CardFooter, Checkbox, Input, UsernameDisplay, CodeInput } from '../../components/common';
import { getActiveToken, getAllStoredAccounts, isStoredAccountExpired, removeStoredAccount, setActiveToken, type StoredAccount } from '../../lib/accounts';
import { getSafeRedirect, stripInviteParam, withInviteParam } from '../../lib/redirects';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import { PASSWORD_RULES, getPasswordValidationChecks, getPasswordValidationErrors, type PasswordValidationChecks } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';
import { getEmailValidationError } from '@common/utils/email';
import { EMAIL_CODE_LENGTH } from '@common';

type AuthMode = 'login' | 'signup';
type AuthStep = 'form' | 'email-code' | 'forgot' | 'forgot-code' | 'device-code';

interface FormData {
  username: string;
  password: string;
  confirmPassword?: string;
  email?: string;
}

interface AuthErrorState {
  message: string;
  retryUntil: number | null;
}

interface AuthErrorResult {
  error: AuthErrorState;
  now: number;
}

type SignupField = 'username' | 'email' | 'password' | 'confirmPassword';

const SIGNUP_FIELDS: SignupField[] = ['username', 'email', 'password', 'confirmPassword'];

function getSignupFieldError(field: SignupField, data: FormData): string | undefined {
  switch (field) {
    case 'username': {
      const username = data.username.trim();
      if (!username) return 'Username is required';
      return getUsernameValidationError(username) ?? undefined;
    }
    case 'email': {
      const email = data.email?.trim() ?? '';
      if (!email) return 'Email is required';
      return getEmailValidationError(email) ?? undefined;
    }
    case 'password': {
      if (!data.password) return 'Password is required';
      return getPasswordValidationErrors(data.password)[0] ?? undefined;
    }
    case 'confirmPassword': {
      if (!data.confirmPassword) return 'Please confirm your password';
      if (data.password !== data.confirmPassword) return 'Passwords do not match';
      return undefined;
    }
  }
}

/** Single place that turns API failures into user-facing auth errors. */
function formatAuthError(error: unknown, fallback: string): AuthErrorResult {
  const now = Date.now();
  if (error instanceof ApiError && error.status === 429) {
    const seconds = Math.max(1, Math.ceil(error.retryAfterSeconds ?? 1));
    return {
      error: { message: 'Too many requests.', retryUntil: now + seconds * 1000 },
      now,
    };
  }
  return {
    error: { message: error instanceof Error ? error.message : fallback, retryUntil: null },
    now,
  };
}

function createCodeExpiry(value: Date | string | number | null | undefined) {
  const now = Date.now();
  const date = value === null || value === undefined ? null : (value instanceof Date ? value : new Date(value));
  return { expiresAt: date && !Number.isNaN(date.getTime()) ? date : null, now };
}

const RESEND_COOLDOWN_SECONDS = 30;

export interface AuthPageProps {
  initialMode?: AuthMode;
}

function PasswordChecklist({ checks }: Readonly<{ checks: PasswordValidationChecks }>) {
  return (
    <ul className="auth-form__password-checklist" aria-live="polite">
      {PASSWORD_RULES.filter((rule) => !checks[rule.key]).map((rule) => (
        <li key={rule.key} className="is-invalid">
          <span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

export const AuthPage = ({ initialMode }: AuthPageProps = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const requestedRedirect = getSafeRedirect(searchParams.get('redirect'));
  // A pending invite must travel with the user to the dashboard so it is accepted once.
  const redirectTo = inviteToken ? withInviteParam(requestedRedirect, inviteToken) : requestedRedirect;
  // Registration consumes the invite on the server, so never carry it forward from there.
  const signupRedirect = stripInviteParam(redirectTo);
  const mode: AuthMode = initialMode ?? (location.pathname.includes('register') ? 'signup' : 'login');

  const [step, setStep] = useState<AuthStep>('form');
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
    email: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormData, boolean>>>({});
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>(() => getAllStoredAccounts());
  const [codeExpiresAt, setCodeExpiresAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeToken = getActiveToken();

  useEffect(() => {
    const refresh = () => setStoredAccounts(getAllStoredAccounts());
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('ayphr-accounts-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ayphr-accounts-changed', refresh);
    };
  }, []);

  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    const retryUntil = authError?.retryUntil ?? null;
    if (!codeExpiresAt && !retryUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeExpiresAt, authError?.retryUntil]);

  const rateLimitRemaining = authError?.retryUntil
    ? Math.max(0, Math.ceil((authError.retryUntil - now) / 1000))
    : 0;
  const isRateLimited = rateLimitRemaining > 0;
  const visibleError = authError
    ? authError.retryUntil
      ? isRateLimited
        ? `Too many requests. Try again in ${rateLimitRemaining}s.`
        : 'Too many requests. You can try again now.'
      : authError.message
    : null;
  const codeSecondsRemaining = codeExpiresAt
    ? Math.max(0, Math.ceil((codeExpiresAt.getTime() - now) / 1000))
    : null;

  const applyAuthError = (error: unknown, fallback: string) => {
    const formatted = formatAuthError(error, fallback);
    setNow(formatted.now);
    setAuthError(formatted.error);
  };

  const setCodeExpiry = (value: Date | string | number | null | undefined) => {
    const expiry = createCodeExpiry(value);
    setNow(expiry.now);
    setCodeExpiresAt(expiry.expiresAt);
  };

  const renderCodeExpiry = () => {
    if (codeSecondsRemaining === null) {
      return <p className="auth-form__code-expiry">Check your email for the code.</p>;
    }
    if (codeSecondsRemaining === 0) {
      return (
        <p className="auth-form__code-expiry auth-form__code-expiry--expired" role="status">
          Code expired — request a new one
        </p>
      );
    }
    return (
      <p className="auth-form__code-expiry" role="timer">
        Code expires in {Math.floor(codeSecondsRemaining / 60)}:{String(codeSecondsRemaining % 60).padStart(2, '0')}
      </p>
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const field = name as keyof FormData;
    const nextData = { ...formData, [field]: value };
    setFormData(nextData);

    if (mode === 'signup') {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const fieldsToValidate: SignupField[] = field === 'password'
        ? ['password', 'confirmPassword']
        : SIGNUP_FIELDS.filter((item) => item === field);

      setErrors((prev) => {
        const next = { ...prev };
        for (const item of fieldsToValidate) {
          if (!touched[item] && item !== field) continue;
          const error = getSignupFieldError(item, nextData);
          if (error) next[item] = error;
          else delete next[item];
        }
        return next;
      });
      return;
    }

    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  const handleFieldBlur = (field: SignupField) => {
    if (mode !== 'signup') return;
    setTouched((prev) => ({ ...prev, [field]: true }));
    const error = getSignupFieldError(field, formData);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  };

  const handleChooseAccount = async (token: string) => {
    setActiveToken(token);
    api.users.invalidateMe();
    try {
      await api.users.me();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        removeStoredAccount(token);
        setStoredAccounts(getAllStoredAccounts());
        return;
      }
      // Transient failure: fall through and let the dashboard/gates retry.
    }
    navigate(redirectTo);
  };

  const handleRemoveAccount = (account: StoredAccount) => {
    if (!window.confirm(`Remove ${account.user.username} from this device?`)) return;
    const wasActive = account.token === activeToken;
    removeStoredAccount(account.token);
    if (wasActive) api.users.invalidateMe();
    setStoredAccounts(getAllStoredAccounts());
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (mode === 'login') {
      if (!formData.username.trim()) newErrors.username = 'Email or username is required';
      if (!formData.password) newErrors.password = 'Password is required';
    } else {
      for (const field of SIGNUP_FIELDS) {
        const error = getSignupFieldError(field, formData);
        if (error) newErrors[field] = error;
      }
      setTouched({ username: true, email: true, password: true, confirmPassword: true });
      setPolicyError(acceptedPolicies ? null : 'You must agree to the Terms of Service and Privacy Policy');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0 && (mode !== 'signup' || acceptedPolicies);
  };

  const validateResetPassword = (): string | null => {
    if (!resetPassword) return 'Password is required';
    const errs = getPasswordValidationErrors(resetPassword);
    if (errs.length > 0) return errs[0];
    if (resetPassword !== resetConfirmPassword) return 'Passwords do not match';
    return null;
  };

  const resetFormState = () => {
    setFormData({ username: '', password: '', confirmPassword: '', email: '' });
    setErrors({});
    setTouched({});
    setAcceptedPolicies(false);
    setPolicyError(null);
    setAuthError(null);
    setNotice(null);
    setCode('');
    setIdentifier('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResendCooldown(0);
    setCodeExpiresAt(null);
  };

  const toggleMode = () => {
    resetFormState();
    setStep('form');
    void navigate(`${mode === 'login' ? '/auth/register' : '/auth/login'}${location.search}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (mode === 'signup' && step === 'email-code') {
      if (code.length !== EMAIL_CODE_LENGTH) {
        setAuthError({ message: `Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`, retryUntil: null });
        return;
      }
      setIsLoading(true);
      try {
        await api.auth.register({
          username: formData.username,
          password: formData.password,
          email: formData.email!.trim(),
          code,
          acceptPolicies: acceptedPolicies,
          ...(inviteToken ? { inviteToken } : {}),
        });
        navigate(signupRedirect);
      } catch (error) {
        applyAuthError(error, 'Registration failed. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === 'login' && step === 'forgot') {
      if (!identifier.trim()) {
        setAuthError({ message: 'Email or username is required', retryUntil: null });
        return;
      }
      setIsLoading(true);
      try {
        const result = await api.auth.forgotPassword({ identifier: identifier.trim() });
        setCode('');
        setCodeExpiry(result.expiresAt);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setStep('forgot-code');
      } catch (error) {
        applyAuthError(error, 'Failed to send reset code. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === 'login' && step === 'forgot-code') {
      if (code.length !== EMAIL_CODE_LENGTH) {
        setAuthError({ message: `Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`, retryUntil: null });
        return;
      }
      const resetError = validateResetPassword();
      if (resetError) {
        setAuthError({ message: resetError, retryUntil: null });
        return;
      }
      setIsLoading(true);
      try {
        await api.auth.resetPassword({ identifier: identifier.trim(), code, newPassword: resetPassword });
        setNotice('Your password has been reset. Sign in with your new password.');
        setStep('form');
        resetFormState();
        // keep the notice
        setNotice('Your password has been reset. Sign in with your new password.');
      } catch (error) {
        applyAuthError(error, 'Failed to reset password. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === 'login' && step === 'device-code') {
      if (code.length !== EMAIL_CODE_LENGTH) {
        setAuthError({ message: `Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`, retryUntil: null });
        return;
      }
      setIsLoading(true);
      try {
        await api.auth.verifyDeviceLogin({ username: formData.username, code });
        navigate(redirectTo);
      } catch (error) {
        applyAuthError(error, 'Failed to verify code. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // default: form step
    if (!validateForm()) return;
    setIsLoading(true);
    try {
      if (mode === 'login') {
        const result = await api.auth.login({ username: formData.username, password: formData.password });
        if ('requiresDeviceVerification' in result && result.requiresDeviceVerification) {
          setCode('');
          setCodeExpiry(result.expiresAt);
          setStep('device-code');
        } else {
          navigate(redirectTo);
        }
      } else {
        const result = await api.auth.requestEmailCode({ email: formData.email!.trim() });
        setCode('');
        setCodeExpiry(result.expiresAt);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setStep('email-code');
      }
    } catch (error) {
      applyAuthError(error, 'Authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading || isRateLimited) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      if (mode === 'signup') {
        const result = await api.auth.requestEmailCode({ email: formData.email!.trim() });
        setCodeExpiry(result.expiresAt);
      } else {
        const result = await api.auth.forgotPassword({ identifier: identifier.trim() });
        setCodeExpiry(result.expiresAt);
      }
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      applyAuthError(error, 'Failed to resend code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendDeviceCode = async () => {
    if (resendCooldown > 0 || isLoading || isRateLimited) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      const result = await api.auth.login({ username: formData.username, password: formData.password });
      if ('requiresDeviceVerification' in result && result.requiresDeviceVerification) {
        setCode('');
        setCodeExpiry(result.expiresAt);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        navigate(redirectTo);
      }
    } catch (error) {
      applyAuthError(error, 'Failed to resend code.');
    } finally {
      setIsLoading(false);
    }
  };

  const leaveCodeStep = () => {
    setStep('form');
    setCode('');
    setCodeExpiresAt(null);
    setAuthError(null);
  };

  const isSignup = mode === 'signup';
  const passwordChecks = getPasswordValidationChecks(formData.password);
  const hasEnteredPassword = formData.password.length > 0;
  const hasUnsatisfiedPasswordRequirements =
    !passwordChecks.minLength ||
    !passwordChecks.lowercase ||
    !passwordChecks.uppercase ||
    !passwordChecks.number ||
    !passwordChecks.symbol;

  const resetPasswordChecks = getPasswordValidationChecks(resetPassword);
  const resetHasUnsatisfied =
    !resetPasswordChecks.minLength ||
    !resetPasswordChecks.lowercase ||
    !resetPasswordChecks.uppercase ||
    !resetPasswordChecks.number ||
    !resetPasswordChecks.symbol;

  let title = isSignup ? 'Sign Up' : 'Log In';
  if (isSignup && step === 'email-code') title = 'Verify Your Email';
  if (mode === 'login' && step === 'forgot') title = 'Reset Password';
  if (mode === 'login' && step === 'forgot-code') title = 'Reset Password';
  if (mode === 'login' && step === 'device-code') title = 'Verify Your Login';

  return (
    <div className="auth-page">
      <div className="auth-page__container">
        <div className="auth-page__header">
          <h1>Ayphr</h1>
        </div>

        <Card elevated className="auth-page__card">
          <CardHeader>
            <h2 aria-live="polite">{title}</h2>
          </CardHeader>

          <CardBody>
            {mode === 'login' && step === 'form' && storedAccounts.length > 0 && (
              <div className="auth-accounts">
                <p className="auth-accounts__title">Choose an account</p>
                <div className="auth-accounts__list">
                  {storedAccounts.map((account) => {
                    const isExpired = isStoredAccountExpired(account);
                    const isActive = account.token === activeToken;
                    const statusLabel = isExpired
                      ? 'Expired — sign in again'
                      : isActive
                        ? 'Currently signed in'
                        : null;
                    return (
                      <div
                        key={account.user.uuid}
                        className={`auth-accounts__item${isExpired ? ' auth-accounts__item--expired' : ''}`}
                      >
                        <button
                          type="button"
                          className="auth-accounts__select"
                          onClick={() => handleChooseAccount(account.token)}
                          disabled={isExpired || isLoading}
                        >
                          <UsernameDisplay username={account.user.username} badges={account.user.badges} country={account.user.country} avatarUrl={account.user.avatarUrl} avatarSize={28} />
                          {statusLabel && <span className="auth-accounts__status">{statusLabel}</span>}
                        </button>
                        <button
                          type="button"
                          className="auth-accounts__remove"
                          aria-label={`Remove ${account.user.username} from this device`}
                          title="Remove from this device"
                          onClick={() => handleRemoveAccount(account)}
                          disabled={isLoading}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
                <p className="auth-accounts__divider">or sign in with another account</p>
              </div>
            )}

            {visibleError && (
              <div className="auth-form__error-banner" role="alert">{visibleError}</div>
            )}

            {notice && (
              <div className="auth-form__notice" role="status" aria-live="polite">{notice}</div>
            )}

            {mode === 'signup' && step === 'email-code' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <p className="auth-form__code-hint">
                  We sent a {EMAIL_CODE_LENGTH}-digit code to <strong>{formData.email}</strong>. Enter it below to verify your email and finish creating your account.
                </p>
                <CodeInput value={code} onChange={setCode} autoFocus />
                {renderCodeExpiry()}
                <Button variant="primary" fullWidth isLoading={isLoading} disabled={isRateLimited} type="submit" className="auth-form__submit">
                  Verify &amp; Create Account
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isLoading || isRateLimited}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={leaveCodeStep} disabled={isLoading}>
                    Use a different email
                  </Button>
                </div>
              </form>
            )}

            {mode === 'login' && step === 'forgot' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <Input
                  label="Email or username"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Enter your email or username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} disabled={isRateLimited} type="submit" className="auth-form__submit">
                  Send Reset Code
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={() => { setStep('form'); setIdentifier(''); setCodeExpiresAt(null); setAuthError(null); setNotice(null); }} disabled={isLoading}>
                    Back to log in
                  </Button>
                </div>
              </form>
            )}

            {mode === 'login' && step === 'forgot-code' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <p className="auth-form__code-hint">
                  If an account exists for <strong>{identifier}</strong>, we've sent a {EMAIL_CODE_LENGTH}-digit code to its email address.
                </p>
                <CodeInput value={code} onChange={setCode} autoFocus />
                {renderCodeExpiry()}
                <Input
                  label="New password"
                  name="resetPassword"
                  type="password"
                  autoComplete="new-password"
                  revealable
                  placeholder="Create a new password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                {resetPassword.length > 0 && resetHasUnsatisfied && (
                  <PasswordChecklist checks={resetPasswordChecks} />
                )}
                <Input
                  label="Confirm new password"
                  name="resetConfirmPassword"
                  type="password"
                  autoComplete="new-password"
                  revealable
                  placeholder="Re-enter the new password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} disabled={isRateLimited} type="submit" className="auth-form__submit">
                  Reset Password
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isLoading || isRateLimited}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={leaveCodeStep} disabled={isLoading}>
                    Back to log in
                  </Button>
                </div>
              </form>
            )}

            {mode === 'login' && step === 'device-code' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <p className="auth-form__code-hint">
                  We noticed a sign-in from a new device. We sent a {EMAIL_CODE_LENGTH}-digit code to your email. Enter it to finish signing in.
                </p>
                <CodeInput value={code} onChange={setCode} autoFocus />
                {renderCodeExpiry()}
                <Button variant="primary" fullWidth isLoading={isLoading} disabled={isRateLimited} type="submit" className="auth-form__submit">
                  Verify &amp; Sign In
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={handleResendDeviceCode} disabled={isLoading || resendCooldown > 0 || isRateLimited}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={leaveCodeStep} disabled={isLoading}>
                    Back to log in
                  </Button>
                </div>
              </form>
            )}

            {step === 'form' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <Input
                  label={isSignup ? 'Username' : 'Email or username'}
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={isSignup ? 'Enter your username' : 'Enter your email or username'}
                  value={formData.username}
                  onChange={handleInputChange}
                  onBlur={isSignup ? () => handleFieldBlur('username') : undefined}
                  error={errors.username}
                  disabled={isLoading}
                  fullWidth
                />

                {isSignup && (
                  <Input
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="Enter your email"
                    value={formData.email || ''}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('email')}
                    error={errors.email}
                    disabled={isLoading}
                    fullWidth
                  />
                )}

                <Input
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  revealable
                  placeholder={isSignup ? 'Create a password' : 'Enter your password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  onBlur={isSignup ? () => handleFieldBlur('password') : undefined}
                  error={errors.password}
                  disabled={isLoading}
                  fullWidth
                />

                {mode === 'login' && step === 'form' && (
                  <div className="auth-form__aux">
                    <button
                      type="button"
                      className="auth-form__link-button"
                      onClick={() => { setStep('forgot'); setCodeExpiresAt(null); setAuthError(null); setNotice(null); }}
                      disabled={isLoading}
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {isSignup && hasEnteredPassword && hasUnsatisfiedPasswordRequirements && (
                  <PasswordChecklist checks={passwordChecks} />
                )}

                {isSignup && (
                  <Input
                    label="Confirm Password"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    revealable
                    placeholder="Confirm your password"
                    value={formData.confirmPassword || ''}
                    onChange={handleInputChange}
                    onBlur={() => handleFieldBlur('confirmPassword')}
                    error={errors.confirmPassword}
                    disabled={isLoading}
                    fullWidth
                  />
                )}

                {isSignup && (
                  <Checkbox
                    checked={acceptedPolicies}
                    onChange={(e) => {
                      setAcceptedPolicies(e.target.checked);
                      if (policyError) setPolicyError(null);
                    }}
                    error={policyError ?? undefined}
                    label={
                      <>
                        I agree to the{' '}
                        <a href="/policies/terms" target="_blank" rel="noreferrer">Terms of Service</a>
                        {' '}and{' '}
                        <a href="/policies/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
                      </>
                    }
                  />
                )}

                <Button
                  variant="primary"
                  fullWidth
                  isLoading={isLoading}
                  disabled={isRateLimited}
                  type="submit"
                  className="auth-form__submit"
                >
                  {isSignup ? 'Create Account' : 'Sign In'}
                </Button>
              </form>
            )}
          </CardBody>

          {step === 'form' && (
            <CardFooter>
              <span className="auth-page__footer-text">
                {isSignup ? 'Already have an account?' : "Don't have an account?"}
              </span>
              <Button
                variant="secondary"
                onClick={toggleMode}
                disabled={isLoading}
              >
                {isSignup ? 'Log In' : 'Sign Up'}
              </Button>
            </CardFooter>
          )}
        </Card>

        <div className="auth-page__footer">
          <p className="auth-page__links">
            <a href="/policies/terms" className="auth-page__link">Terms</a>
            <a href="/policies/privacy" className="auth-page__link">Privacy</a>
          </p>
          <p>&copy; {new Date().getFullYear()} Ayphr. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};
