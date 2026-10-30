import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconAlertCircle, IconDeviceDesktop } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { Button, Card, CardHeader, CardBody, UsernameDisplay } from '../../components/common';
import { getActiveToken, getStoredAccounts, setActiveToken, type StoredAccount } from '../../lib/accounts';
import { PAIRING_CODE_LENGTH, type Location } from '@common';
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
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await api.locations.listMine();
        if (!active) return;
        setLocations(loaded);
        if (loaded.length > 0) setSelectedLocationId(loaded[0].id);
      } catch {
        // Ignore; linking can still proceed with the default location.
      }
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

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
    if (trimmed.length !== PAIRING_CODE_LENGTH) {
      setError(`Enter the ${PAIRING_CODE_LENGTH}-character code from your device`);
      return;
    }

    setIsLoading(true);
    try {
      await api.devices.linkByCode(trimmed, selectedLocationId || undefined);
      setResult({ linked: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link device');
    } finally {
      setIsLoading(false);
    }
  };

  const inputRefs = useRef<HTMLInputElement[]>([]);
  const visibleAccounts = storedAccounts.filter((account) => account.token !== activeTokenState);
  const accountsToShow = visibleAccounts.length > 0 ? visibleAccounts : storedAccounts;

  const setCodeAt = (index: number, char: string) => {
    setCode((prev) => {
      const chars = prev.split('');
      while (chars.length < PAIRING_CODE_LENGTH) chars.push('');
      chars[index] = char ? char.toUpperCase().slice(0, 1) : '';
      return chars.join('').slice(0, PAIRING_CODE_LENGTH);
    });
  };

  const applyPaste = (startIndex: number, text: string) => {
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PAIRING_CODE_LENGTH);
    setCode((prev) => {
      const chars = prev.split('');
      while (chars.length < PAIRING_CODE_LENGTH) chars.push('');
      for (let i = 0; i < cleaned.length; i++) {
        const idx = startIndex + i;
        if (idx < PAIRING_CODE_LENGTH) chars[idx] = cleaned[i];
      }
      return chars.join('').slice(0, PAIRING_CODE_LENGTH);
    });
    const nextFocus = Math.min(startIndex + cleaned.length, PAIRING_CODE_LENGTH - 1);
    inputRefs.current[nextFocus]?.focus();
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.length > 1) {
      applyPaste(index, val);
      return;
    }
    setCodeAt(index, val);
    if (val && index < PAIRING_CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    applyPaste(index, e.clipboardData.getData('text'));
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !(inputRefs.current[index]?.value) && index > 0) {
      setCodeAt(index - 1, '');
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < PAIRING_CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

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
            {storedAccounts.length > 0 && (
              <div className="auth-accounts">
                <p className="auth-accounts__title">{storedAccounts.length > 1 ? 'Switch account' : 'Account'}</p>
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
                {locations.length > 0 && (
                  <label className="link-page__location">
                    <span>Location</span>
                    <select
                      value={selectedLocationId}
                      onChange={(event) => setSelectedLocationId(event.target.value)}
                    >
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="link-page__code" role="group" aria-label="Device code">
                  {Array.from({ length: PAIRING_CODE_LENGTH }).map((_, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        if (el) inputRefs.current[i] = el;
                      }}
                      className="link-page__code-input"
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={code[i] || ''}
                      onChange={(e) => handleChange(i, e)}
                      onPaste={(e) => handlePaste(i, e)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      aria-label={`Character ${i + 1}`}
                    />
                  ))}
                </div>
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
