import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody, CardHeader } from '../../components/common';
import './Policies.css';

interface PoliciesVersions {
  generated_at: string;
  policies: {
    privacy: { version: number; updated_date_formatted: string };
    refund: { version: number; updated_date_formatted: string };
    tos: { version: number; updated_date_formatted: string };
  };
}

export const PoliciesPage = () => {
  const [versions, setVersions] = useState<PoliciesVersions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('https://raw.githubusercontent.com/ayphr/policies-static/refs/heads/main/versions.json');
        const data = await res.json();
        setVersions(data);
      } catch (err) {
        console.error('Failed to load policies versions:', err);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  return (
    <div className="policies-page">
      <div className="policies-container">
        <Card elevated className="policies-card">
          <CardHeader>
            <h1>Policies</h1>
            <p>Our terms, privacy, and refund policies</p>
          </CardHeader>
          <CardBody>
            {loading ? (
              <p>Loading policies...</p>
            ) : (
              <div className="policies-list">
                <Link to="/policies/terms" className="policies-link">
                  <div className="policies-item">
                    <h2>Terms of Service</h2>
                    <p>Last updated: {versions?.policies.tos.updated_date_formatted}</p>
                  </div>
                </Link>
                <Link to="/policies/privacy" className="policies-link">
                  <div className="policies-item">
                    <h2>Privacy Policy</h2>
                    <p>Last updated: {versions?.policies.privacy.updated_date_formatted}</p>
                  </div>
                </Link>
                <Link to="/policies/refunds" className="policies-link">
                  <div className="policies-item">
                    <h2>Refund &amp; Shipping Policy</h2>
                    <p>Last updated: {versions?.policies.refund.updated_date_formatted}</p>
                  </div>
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
