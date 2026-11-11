import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { TeamAuditLog } from '@common';
import './TeamPanel.css';

export function TeamAuditPanel() {
  const [logs, setLogs] = useState<TeamAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await api.teams.auditLogs();
        if (!cancelled) setLogs(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) return <p className="team-panel__loading">Loading audit log…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;

  return (
    <div className="team-panel">
      <ul className="team-panel__list">
        {logs.map((log) => (
          <li key={log.id} className="team-panel__list-item">
            <div className="team-panel__member-info">
              <span className="team-panel__audit-action">{log.action}</span>
              <span className="team-panel__audit-meta">
                by {log.actorUsername}
                {log.targetUsername ? ` → ${log.targetUsername}` : ''}
                {' · '}
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          </li>
        ))}
        {logs.length === 0 && <li className="team-panel__empty">No audit entries yet.</li>}
      </ul>
    </div>
  );
}
