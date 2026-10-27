import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Connection } from '@common';
import { Card, CardBody, CardHeader, Button } from '../common';
import './ConnectionsPanel.css';

export const ConnectionsPanel = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await api.connections.list();
      setConnections(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(task);
  }, []);

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this connection?')) return;
    try {
      await api.connections.revoke(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke');
    }
  };

  return (
    <div className="connections">
      <h3>Connections</h3>
      {error && <p className="connections__error">{error}</p>}
      {isLoading ? (
        <p>Loading connections...</p>
      ) : connections.length === 0 ? (
        <p>No connected apps.</p>
      ) : (
        <div className="connections__list">
          {connections.map((c) => (
            <Card key={c.id} elevated>
              <CardHeader>
                <h4>{c.appName}</h4>
              </CardHeader>
              <CardBody>
                {c.appLogoUrl && <img src={c.appLogoUrl} alt={c.appName} className="connections__logo" />}
                <p><strong>Scopes:</strong> {c.scopes.join(', ')}</p>
                <p><strong>Connected:</strong> {new Date(c.createdAt).toLocaleDateString()}</p>
                <Button variant="danger" onClick={() => handleRevoke(c.id)}>Revoke</Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
