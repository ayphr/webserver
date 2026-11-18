import { useNavigate } from 'react-router-dom';
import { IconAlertCircle } from '@tabler/icons-react';
import { Button, Card, CardBody, CardHeader } from '../../components/common';
import './NotFoundPage.css';

export const NotFoundPage = () => {
  const navigate = useNavigate();

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
            <Button variant="primary" onClick={() => navigate('/')}>
              Go home
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};