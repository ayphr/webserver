import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import './AuthPage.css';
import { Button, Card, CardHeader, CardBody, CardFooter, Checkbox, Input, UsernameDisplay, CodeInput } from '../../components/common';
import { getActiveToken, getStoredAccounts, isStoredAccountExpired, setActiveToken, type StoredAccount } from '../../lib/accounts';
import { api } from '../../lib/api';
import { PASSWORD_MIN_LENGTH, getPasswordValidationChecks, getPasswordValidationErrors } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';
import { getEmailValidationError } from '@common/utils/email';
import { EMAIL_CODE_LENGTH } from '@common';

type AuthMode = 'login' | 'signup';
type AuthStep = 'form' | 'email-code' | 'forgot' | 'forgot-code';

interface FormData {
  username: string;
  password: string;
  confirmPassword?: string;
  email?: string;
}

const RESEND_COOLDOWN_SECONDS = 30;

export interface AuthPageProps {
  initialMode?: AuthMode;
}

export const AuthPage = ({ initialMode }: AuthPageProps = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const mode: AuthMode = initialMode ?? (location.pathname.includes('register') ? 'signup' : 'login');

  const [step, setStep] = useState<AuthStep>('form');
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
    email: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storedAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());
  const eligibleAccounts = storedAccounts.filter((account) => !isStoredAccountExpired(account));
  const visibleAccounts = eligibleAccounts.filter((account) => account.token !== getActiveToken());
  const accountsToShow = visibleAccounts.length > 0 ? visibleAccounts : eligibleAccounts;
  const passwordChecks = getPasswordValidationChecks(formData.password);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name as keyof FormData]) {
      setErrors((prev) => ({
        ...prev,
        [name]: undefined,
      }));
    }
  };

  const handleChooseAccount = (token: string) => {
    setActiveToken(token);
    navigate('/dashboard');
  };

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (mode === 'signup') {
      const usernameError = getUsernameValidationError(formData.username.trim());
      if (usernameError) newErrors.username = usernameError;
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    if (mode === 'signup') {
      const passwordValidationErrors = getPasswordValidationErrors(formData.password);
      if (passwordValidationErrors.length > 0) {
        newErrors.password = passwordValidationErrors[0];
      }

      if (!formData.email?.trim()) {
        newErrors.email = 'Email is required';
      } else {
        const emailError = getEmailValidationError(formData.email.trim());
        if (emailError) newErrors.email = emailError;
      }

      if (!formData.confirmPassword) {
        newErrors.confirmPassword = 'Please confirm your password';
      } else if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }

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
    setAcceptedPolicies(false);
    setPolicyError(null);
    setAuthError(null);
    setNotice(null);
    setCode('');
    setIdentifier('');
    setResetPassword('');
    setResetConfirmPassword('');
    setResendCooldown(0);
  };

  const toggleMode = () => {
    resetFormState();
    setStep('form');
    void navigate(mode === 'login' ? '/auth/register' : '/auth/login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (mode === 'signup' && step === 'email-code') {
      if (code.length !== EMAIL_CODE_LENGTH) {
        setAuthError(`Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`);
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
        });
        navigate(redirectTo);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Registration failed. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === 'login' && step === 'forgot') {
      if (!identifier.trim()) {
        setAuthError('Email or username is required');
        return;
      }
      setIsLoading(true);
      try {
        await api.auth.forgotPassword({ identifier: identifier.trim() });
        setCode('');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setStep('forgot-code');
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Failed to send reset code. Please try again.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (mode === 'login' && step === 'forgot-code') {
      if (code.length !== EMAIL_CODE_LENGTH) {
        setAuthError(`Enter the ${EMAIL_CODE_LENGTH}-digit code sent to your email`);
        return;
      }
      const resetError = validateResetPassword();
      if (resetError) {
        setAuthError(resetError);
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
        setAuthError(error instanceof Error ? error.message : 'Failed to reset password. Please try again.');
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
        await api.auth.login({ username: formData.username, password: formData.password });
        navigate(redirectTo);
      } else {
        await api.auth.requestEmailCode({ email: formData.email!.trim() });
        setCode('');
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setStep('email-code');
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isLoading) return;
    setIsLoading(true);
    setAuthError(null);
    try {
      if (mode === 'signup') {
        await api.auth.requestEmailCode({ email: formData.email!.trim() });
      } else {
        await api.auth.forgotPassword({ identifier: identifier.trim() });
      }
      setCode('');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to resend code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isSignup = mode === 'signup';
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

  return (
    <div className="auth-page">
      <div className="auth-page__container">
        <div className="auth-page__header">
          <h1>Ayphr</h1>
        </div>

        <Card elevated className="auth-page__card">
          <CardHeader>
            <h2>{title}</h2>
          </CardHeader>

          <CardBody>
            {mode === 'login' && step === 'form' && accountsToShow.length > 0 && (
              <div className="auth-accounts">
                <p className="auth-accounts__title">Choose an account</p>
                <div className="auth-accounts__list">
                  {accountsToShow.map((account) => (
                    <button
                      key={account.user.uuid}
                      type="button"
                      className="auth-accounts__item"
                      onClick={() => handleChooseAccount(account.token)}
                    >
                      <UsernameDisplay username={account.user.username} badges={account.user.badges} country={account.user.country} avatarUrl={account.user.avatarUrl} avatarSize={28} />
                    </button>
                  ))}
                </div>
                <p className="auth-accounts__divider">or sign in with another account</p>
              </div>
            )}

            {authError && (
              <div className="auth-form__error-banner">{authError}</div>
            )}

            {notice && (
              <div className="auth-form__notice">{notice}</div>
            )}

            {mode === 'signup' && step === 'email-code' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <p className="auth-form__code-hint">
                  We sent a {EMAIL_CODE_LENGTH}-digit code to <strong>{formData.email}</strong>. Enter it below to verify your email and finish creating your account.
                </p>
                <CodeInput value={code} onChange={setCode} />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit" className="auth-form__submit">
                  Verify &amp; Create Account
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isLoading}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={() => { setStep('form'); setCode(''); setAuthError(null); }} disabled={isLoading}>
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
                  placeholder="Enter your email or username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit" className="auth-form__submit">
                  Send Reset Code
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={() => { setStep('form'); setIdentifier(''); setAuthError(null); }} disabled={isLoading}>
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
                <CodeInput value={code} onChange={setCode} />
                <Input
                  label="New password"
                  name="resetPassword"
                  type="password"
                  placeholder="Create a new password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  fullWidth
                />
                {resetPassword.length > 0 && resetHasUnsatisfied && (
                  <ul className="auth-form__password-checklist">
                    {!resetPasswordChecks.minLength && <li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>At least {PASSWORD_MIN_LENGTH} characters</li>}
                    {!resetPasswordChecks.lowercase && <li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One lowercase letter</li>}
                    {!resetPasswordChecks.uppercase && <li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One uppercase letter</li>}
                    {!resetPasswordChecks.number && <li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One number</li>}
                    {!resetPasswordChecks.symbol && <li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One special character</li>}
                  </ul>
                )}
                <Input
                  label="Confirm new password"
                  name="resetConfirmPassword"
                  type="password"
                  placeholder="Re-enter the new password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit" className="auth-form__submit">
                  Reset Password
                </Button>
                <div className="auth-form__resend">
                  <Button variant="secondary" onClick={handleResend} disabled={resendCooldown > 0 || isLoading}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Button>
                  <Button variant="secondary" onClick={() => { setStep('form'); setCode(''); setAuthError(null); }} disabled={isLoading}>
                    Back to log in
                  </Button>
                </div>
              </form>
            )}

            {step === 'form' && (
              <form onSubmit={handleSubmit} className="auth-form">
                <Input
                  label="Username"
                  name="username"
                  type="text"
                  placeholder="Enter your username"
                  value={formData.username}
                  onChange={handleInputChange}
                  error={errors.username}
                  fullWidth
                />

                {isSignup && (
                  <Input
                    label="Email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={formData.email || ''}
                    onChange={handleInputChange}
                    error={errors.email}
                    fullWidth
                  />
                )}

                <Input
                  label="Password"
                  name="password"
                  type="password"
                  placeholder={isSignup ? 'Create a password' : 'Enter your password'}
                  value={formData.password}
                  onChange={handleInputChange}
                  error={errors.password}
                  fullWidth
                />

                {mode === 'login' && step === 'form' && (
                  <div className="auth-form__aux">
                    <button type="button" className="auth-form__link-button" onClick={() => { setStep('forgot'); setAuthError(null); setNotice(null); }} disabled={isLoading}>
                      Forgot password?
                    </button>
                  </div>
                )}

                {isSignup && hasEnteredPassword && hasUnsatisfiedPasswordRequirements && (
                  <ul className="auth-form__password-checklist">
                    {!passwordChecks.minLength && (<li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>At least {PASSWORD_MIN_LENGTH} characters</li>)}
                    {!passwordChecks.lowercase && (<li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One lowercase letter</li>)}
                    {!passwordChecks.uppercase && (<li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One uppercase letter</li>)}
                    {!passwordChecks.number && (<li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One number</li>)}
                    {!passwordChecks.symbol && (<li className="is-invalid"><span className="auth-form__password-rule-icon" aria-hidden="true"><IconX size={14} strokeWidth={2} /></span>One special character</li>)}
                  </ul>
                )}

                {isSignup && (
                  <Input
                    label="Confirm Password"
                    name="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={formData.confirmPassword || ''}
                    onChange={handleInputChange}
                    error={errors.confirmPassword}
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
          <p>&copy; 2026 Ayphr. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};