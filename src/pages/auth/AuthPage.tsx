import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { IconX } from '@tabler/icons-react';
import './AuthPage.css';
import { Button, Card, CardHeader, CardBody, CardFooter, Checkbox, Input } from '../../components/common';
import { getActiveToken, getStoredAccounts, setActiveToken, type StoredAccount } from '../../lib/accounts';
import { api } from '../../lib/api';
import { PASSWORD_MIN_LENGTH, getPasswordValidationChecks, getPasswordValidationErrors } from '@common/utils/password';
import { getUsernameValidationError } from '@common/utils/username';

type AuthMode = 'login' | 'signup';

interface FormData {
  username: string;
  password: string;
  confirmPassword?: string;
}

export interface AuthPageProps {
  initialMode?: AuthMode;
}

export const AuthPage = ({ initialMode }: AuthPageProps = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const mode: AuthMode = initialMode ?? (location.pathname.includes('register') ? 'signup' : 'login');

  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [storedAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());
  const passwordChecks = getPasswordValidationChecks(formData.password);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field when user starts typing
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
      if (usernameError) {
        newErrors.username = usernameError;
      }
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    if (mode === 'signup') {
      const passwordValidationErrors = getPasswordValidationErrors(formData.password);
      if (passwordValidationErrors.length > 0) {
        newErrors.password = passwordValidationErrors[0];
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      if (mode === 'login') {
        await api.auth.login({
          username: formData.username,
          password: formData.password,
        });
      } else {
        await api.auth.register({
          username: formData.username,
          password: formData.password,
          acceptPolicies: acceptedPolicies,
        });
      }
      navigate(redirectTo);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
      setAuthError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setFormData({
      username: '',
      password: '',
    });
    setErrors({});
    setAcceptedPolicies(false);
    setPolicyError(null);
    setAuthError(null);
    void navigate(mode === 'login' ? '/auth/register' : '/auth/login');
  };

  const isSignup = mode === 'signup';
  const hasEnteredPassword = formData.password.length > 0;
  const hasUnsatisfiedPasswordRequirements =
    !passwordChecks.minLength ||
    !passwordChecks.lowercase ||
    !passwordChecks.uppercase ||
    !passwordChecks.number ||
    !passwordChecks.symbol;

  return (
    <div className="auth-page">
      <div className="auth-page__container">
        <div className="auth-page__header">
          <h1>Ayphr</h1>
        </div>

        <Card elevated className="auth-page__card">
          <CardHeader>
            <h2>{isSignup ? 'Sign Up' : 'Log In'}</h2>
          </CardHeader>

          <CardBody>
            {mode === 'login' && storedAccounts.length > 0 && (
              <div className="auth-accounts">
                <p className="auth-accounts__title">Choose an account</p>
                <div className="auth-accounts__list">
                  {storedAccounts.filter((account) => account.token !== getActiveToken()).map((account) => (
                    <button
                      key={account.user.uuid}
                      type="button"
                      className="auth-accounts__item"
                      onClick={() => handleChooseAccount(account.token)}
                    >
                      <span className="auth-accounts__name">{account.user.username}</span>
                    </button>
                  ))}
                </div>
                <p className="auth-accounts__divider">or sign in with another account</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form">
              {authError && (
                <div className="auth-form__error-banner">
                  {authError}
                </div>
              )}

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

              {isSignup && hasEnteredPassword && hasUnsatisfiedPasswordRequirements && (
                <ul className="auth-form__password-checklist">
                  {!passwordChecks.minLength && (
                    <li className="is-invalid">
                      <span className="auth-form__password-rule-icon" aria-hidden="true">
                        <IconX size={14} strokeWidth={2} />
                      </span>
                      At least {PASSWORD_MIN_LENGTH} characters
                    </li>
                  )}
                  {!passwordChecks.lowercase && (
                    <li className="is-invalid">
                      <span className="auth-form__password-rule-icon" aria-hidden="true">
                        <IconX size={14} strokeWidth={2} />
                      </span>
                      One lowercase letter
                    </li>
                  )}
                  {!passwordChecks.uppercase && (
                    <li className="is-invalid">
                      <span className="auth-form__password-rule-icon" aria-hidden="true">
                        <IconX size={14} strokeWidth={2} />
                      </span>
                      One uppercase letter
                    </li>
                  )}
                  {!passwordChecks.number && (
                    <li className="is-invalid">
                      <span className="auth-form__password-rule-icon" aria-hidden="true">
                        <IconX size={14} strokeWidth={2} />
                      </span>
                      One number
                    </li>
                  )}
                  {!passwordChecks.symbol && (
                    <li className="is-invalid">
                      <span className="auth-form__password-rule-icon" aria-hidden="true">
                        <IconX size={14} strokeWidth={2} />
                      </span>
                      One special character
                    </li>
                  )}
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
          </CardBody>

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
