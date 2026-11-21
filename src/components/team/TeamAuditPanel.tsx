import { useEffect, useState } from 'react';
import type { TeamAuditLogListPayload } from '@common';
import { api } from '../../lib/api';
import { Pagination } from '../common';
import './TeamPanel.css';

const PAGE_SIZE = 20;

export function TeamAuditPanel() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TeamAuditLogListPayload>({
    logs: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.teams.auditLogs({ page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setData(result);
        if (page > Math.max(1, result.totalPages)) {
          setPage(Math.max(1, result.totalPages));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page]);

  if (isLoading) return <p className="team-panel__loading">Loading audit log…</p>;
  if (error) return <p className="team-panel__error">{error}</p>;

  return (
    <div className="team-panel">
      <div className="team-panel__audit-toolbar">
        <span className="team-panel__audit-summary">
          {data.total} audit entr{data.total === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <ul className="team-panel__list">
        {data.logs.map((log) => (
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
        {data.logs.length === 0 && <li className="team-panel__empty">No audit entries yet.</li>}
      </ul>
      <Pagination
        page={page}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
