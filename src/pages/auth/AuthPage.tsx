import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconCheck, IconX } from '@tabler/icons-react';
import './AuthPage.css';
import { Button, Card, CardHeader, CardBody, CardFooter, Input } from '../../components/common';
import { api } from '../../lib/api';
import { PASSWORD_MIN_LENGTH, getPasswordValidationChecks, getPasswordValidationErrors } from '../../../common/utils/password';

type AuthMode = 'login' | 'signup';

interface FormData {
  username: string;
  password: string;
  confirmPassword?: string;
}

export const AuthPage = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('login');
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
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

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    // Username validation
    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (formData.username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    // Password validation
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
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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
        });
      }
      navigate('/dashboard');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
      setAuthError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setFormData({
      username: '',
      password: '',
    });
    setErrors({});
    setAuthError(null);
  };

  const isSignup = mode === 'signup';
  const hasEnteredPassword = formData.password.length > 0;

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

              {isSignup && (
                <ul className="auth-form__password-checklist">
                  <li className={hasEnteredPassword ? (passwordChecks.minLength ? 'is-valid' : 'is-invalid') : ''}>
                    <span className="auth-form__password-rule-icon" aria-hidden="true">
                      {hasEnteredPassword && !passwordChecks.minLength
                        ? <IconX size={14} strokeWidth={2} />
                        : <IconCheck size={14} strokeWidth={2} />}
                    </span>
                    At least {PASSWORD_MIN_LENGTH} characters
                  </li>
                  <li className={hasEnteredPassword ? (passwordChecks.lowercase ? 'is-valid' : 'is-invalid') : ''}>
                    <span className="auth-form__password-rule-icon" aria-hidden="true">
                      {hasEnteredPassword && !passwordChecks.lowercase
                        ? <IconX size={14} strokeWidth={2} />
                        : <IconCheck size={14} strokeWidth={2} />}
                    </span>
                    One lowercase letter
                  </li>
                  <li className={hasEnteredPassword ? (passwordChecks.uppercase ? 'is-valid' : 'is-invalid') : ''}>
                    <span className="auth-form__password-rule-icon" aria-hidden="true">
                      {hasEnteredPassword && !passwordChecks.uppercase
                        ? <IconX size={14} strokeWidth={2} />
                        : <IconCheck size={14} strokeWidth={2} />}
                    </span>
                    One uppercase letter
                  </li>
                  <li className={hasEnteredPassword ? (passwordChecks.number ? 'is-valid' : 'is-invalid') : ''}>
                    <span className="auth-form__password-rule-icon" aria-hidden="true">
                      {hasEnteredPassword && !passwordChecks.number
                        ? <IconX size={14} strokeWidth={2} />
                        : <IconCheck size={14} strokeWidth={2} />}
                    </span>
                    One number
                  </li>
                  <li className={hasEnteredPassword ? (passwordChecks.symbol ? 'is-valid' : 'is-invalid') : ''}>
                    <span className="auth-form__password-rule-icon" aria-hidden="true">
                      {hasEnteredPassword && !passwordChecks.symbol
                        ? <IconX size={14} strokeWidth={2} />
                        : <IconCheck size={14} strokeWidth={2} />}
                    </span>
                    One special character
                  </li>
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
