import { useNavigate } from 'react-router-dom';
import { IconAlertCircle } from '@tabler/icons-react';
import { Button, Card, CardBody, CardHeader } from '../../components/common';
import { getActiveToken, getStoredAccounts } from '../../lib/accounts';
import './NotFoundPage.css';

export const NotFoundPage = () => {
  const navigate = useNavigate();
  const activeToken = getActiveToken();
  const isSignedIn = Boolean(activeToken && getStoredAccounts().some((account) => account.token === activeToken));

  return (
    <div className="not-found-page">
      <div className="not-found-page__container">
        <Card elevated className="not-found-page__card">
          <CardHeader>
            <h2>Page not found</h2>
            <p>The page you’re looking for doesn’t exist or has moved.</p>
          </CardHeader>
          <CardBody>
            <div className="not-found-page__icon" aria-hidden="true">
              <IconAlertCircle size={48} strokeWidth={1.5} />
            </div>
            <p className="not-found-page__hint">
              If you followed an email or invite link, it may have expired. Sign in and check your dashboard for the latest link.
            </p>
            <div className="not-found-page__actions">
              {isSignedIn && (
                <Button variant="primary" onClick={() => navigate('/dashboard')}>
                  Back to dashboard
                </Button>
              )}
              <Button variant={isSignedIn ? 'secondary' : 'primary'} onClick={() => navigate('/')}>
                Go home
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
