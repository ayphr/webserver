import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Connection } from '@common';
import { Card, CardBody, CardHeader, Button } from '../common';
import './ConnectionsPanel.css';

export const ConnectionsPanel = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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
                {c.appLogoUrl && <img src={c.appLogoUrl} alt={c.appName} className="connections__logo" loading="lazy" />}
                <p><strong>Scopes:</strong> {c.scopes.join(', ')}</p>
                <p><strong>Connected:</strong> {new Date(c.createdAt).toLocaleDateString()}</p>
                {c.lastUsedAt && <p><strong>Last used:</strong> {new Date(c.lastUsedAt).toLocaleString()}</p>}
                <div className="connections__actions">
                  <Button variant="secondary" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                    {expanded === c.id ? 'Hide activity' : 'View activity'}
                  </Button>
                  <Button variant="danger" onClick={() => handleRevoke(c.id)}>Revoke</Button>
                </div>
                {expanded === c.id && (
                  <div className="connections__activity">
                    <h5>Recent activity</h5>
                    {(c.recentActivity ?? []).length === 0 ? (
                      <p>No recorded activity yet.</p>
                    ) : (
                      <ul>
                        {(c.recentActivity ?? []).slice().reverse().map((entry, index) => (
                          <li key={index}>
                            <code>{entry.method}</code> {entry.path}
                            <span className="connections__activity-time"> — {new Date(entry.at).toLocaleString()}</span>
                            {entry.scopes?.length ? (
                              <div className="connections__activity-scopes">Scopes: {entry.scopes.join(', ')}</div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
