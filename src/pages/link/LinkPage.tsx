import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconAlertCircle, IconDeviceDesktop } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { Button, Card, CardHeader, CardBody, Input, UsernameDisplay } from '../../components/common';
import { getActiveToken, getStoredAccounts, setActiveToken, type StoredAccount } from '../../lib/accounts';
import './LinkPage.css';
import '../auth/AuthPage.css';

export const LinkPage = () => {
  const navigate = useNavigate();
  const [storedAccounts, setStoredAccounts] = useState<StoredAccount[]>(() => getStoredAccounts());
  const [activeTokenState, setActiveTokenState] = useState<string | null>(() => getActiveToken());
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ linked: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      setIsCheckingAuth(true);
      try {
        await api.auth.me();
        if (active) {
          setIsAuthenticated(true);
          setIsCheckingAuth(false);
        }
      } catch {
        if (!active) return;
        setIsAuthenticated(false);
        setIsCheckingAuth(false);
        if (getStoredAccounts().length === 0) {
          const redirect = '/link';
          navigate(`/auth/login?redirect=${encodeURIComponent(redirect)}`, { replace: true });
        }
      }
    };
    void check();
    return () => {
      active = false;
    };
  }, [navigate, activeTokenState]);

  const handleChooseAccount = (token: string) => {
    setActiveToken(token);
    setActiveTokenState(token);
    setStoredAccounts(getStoredAccounts());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 8) {
      setError('Enter the 8-character code from your device');
      return;
    }

    setIsLoading(true);
    try {
      await api.devices.linkByCode(trimmed);
      setResult({ linked: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link device');
    } finally {
      setIsLoading(false);
    }
  };

  const visibleAccounts = storedAccounts.filter((account) => account.token !== activeTokenState);
  const accountsToShow = visibleAccounts.length > 0 ? visibleAccounts : storedAccounts;

  if (isCheckingAuth) {
    return (
      <div className="link-page">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="link-page">
        <div className="link-page__container">
          <Card elevated className="link-page__card">
            <CardHeader>
              <h2>Link a device</h2>
              <p>Choose an account to link this device to.</p>
            </CardHeader>
            <CardBody>
              {storedAccounts.length > 0 ? (
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
                  <Button variant="secondary" onClick={() => navigate(`/auth/login?redirect=${encodeURIComponent('/link')}`)}>
                    Sign in
                  </Button>
                </div>
              ) : (
                <p>Redirecting to sign in...</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="link-page">
      <div className="link-page__container">
        <Card elevated className="link-page__card">
          <CardHeader>
            <h2>Link a device</h2>
            <p>Enter the code shown on your device to link it to your account.</p>
          </CardHeader>
          <CardBody>
            {storedAccounts.length > 1 && (
              <div className="auth-accounts">
                <p className="auth-accounts__title">Switch account</p>
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
              </div>
            )}

            {error && (
              <div className="link-page__error">
                <IconAlertCircle size={16} strokeWidth={1.75} />
                <span>{error}</span>
              </div>
            )}

            {result ? (
              <div className="link-page__result">
                <p>Your device is now linked. On your device, click "I linked it" to receive the upload token.</p>
                <Button variant="primary" onClick={() => navigate('/dashboard?tab=devices')}>
                  Go to devices
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="link-page__form">
                <Input
                  label="Device code"
                  name="code"
                  type="text"
                  placeholder="ABCDEFGH"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                  fullWidth
                />
                <Button variant="primary" fullWidth isLoading={isLoading} type="submit">
                  <IconDeviceDesktop size={16} strokeWidth={1.75} />
                  Link device
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};