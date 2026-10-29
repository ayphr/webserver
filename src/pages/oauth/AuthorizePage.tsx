import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { Card, CardBody, CardHeader, Button } from '../../components/common';
import './AuthorizePage.css';

export const AuthorizePage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const clientId = searchParams.get('client_id') || '';
  const redirectUri = searchParams.get('redirect_uri') || '';
  const scope = searchParams.get('scope') || '';
  const state = searchParams.get('state') || '';

  const [app, setApp] = useState<{ clientId: string; name: string; description?: string; homepageUrl: string; logoUrl?: string; tosUrl?: string; privacyUrl?: string; allowedScopes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    const task = window.setTimeout(() => {
      const token = localStorage.getItem('ayphr-api-token');
      if (!token) {
        navigate(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`, { replace: true });
        return;
      }
      if (!clientId || !redirectUri) {
        setError('Missing client_id or redirect_uri');
        setIsLoading(false);
        return;
      }
      void (async () => {
        try {
          const res = await api.oauth.getPublicApp(clientId);
          setApp(res.app);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load app');
        } finally {
          setIsLoading(false);
        }
      })();
    }, 0);
    return () => window.clearTimeout(task);
  }, [clientId, redirectUri, navigate]);

  const handleApprove = async () => {
    setIsApproving(true);
    setError(null);
    try {
      const res = await api.oauth.authorize({ clientId, redirectUri, scope, state });
      const url = new URL(res.redirectUri);
      url.searchParams.set('code', res.code);
      if (res.state || state) url.searchParams.set('state', res.state || state);
      window.location.assign(url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
      setIsApproving(false);
    }
  };

  const handleDeny = () => {
    try {
      const url = new URL(redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (state) url.searchParams.set('state', state);
      window.location.assign(url.toString());
    } catch {
      window.location.assign('/');
    }
  };

  if (isLoading) return <div className="authorize-page"><p>Loading...</p></div>;

  return (
    <div className="authorize-page">
      <Card elevated>
        <CardHeader>
          <h2>Authorize {app?.name ?? 'App'}</h2>
          <p>{app?.description}</p>
        </CardHeader>
        <CardBody>
          {error && <p className="authorize-page__error">{error}</p>}
          {app?.logoUrl && <img src={app.logoUrl} alt={app.name} className="authorize-page__logo" />}
          <p>This app is requesting access to your Ayphr account:</p>
          <ul>
            {(scope || 'identify').split(/[ ,]+/).filter(Boolean).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {app?.tosUrl && <p><a href={app.tosUrl} target="_blank" rel="noopener noreferrer">Terms of Service</a></p>}
          {app?.privacyUrl && <p><a href={app.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy Policy</a></p>}
          <div className="authorize-page__actions">
            <Button variant="primary" onClick={handleApprove} isLoading={isApproving}>Authorize</Button>
            <Button variant="secondary" onClick={handleDeny}>Deny</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
