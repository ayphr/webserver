import { useEffect, useState } from 'react';
import { IconAlertCircle, IconAlertTriangle, IconCheck, IconRefresh } from '@tabler/icons-react';
import type { DeviceLog, DeviceLogEvent, DeviceLogLevel, DeviceLogListPayload } from '@common';
import { api } from '../../lib/api';
import { getRelativeTime } from '../../lib/date';
import { Button, Pagination } from '../common';
import './DeviceLogsTab.css';

const PAGE_SIZE = 20;

const EVENT_LABELS: Record<DeviceLogEvent, string> = {
  upload_success: 'Upload succeeded',
  upload_error: 'Upload error',
  auth_error: 'Authentication error',
  malformed_data: 'Malformed data',
  rate_limited: 'Rate limited',
  token_revoked: 'Token revoked',
};

function LevelIcon({ level }: Readonly<{ level: DeviceLogLevel }>) {
  if (level === 'info') return <IconCheck size={15} strokeWidth={2} />;
  if (level === 'warning') return <IconAlertTriangle size={15} strokeWidth={1.9} />;
  return <IconAlertCircle size={15} strokeWidth={1.9} />;
}

function formatDetailValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatDetails(details?: Record<string, unknown>): string | null {
  if (!details) return null;
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatDetailValue(value)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

type DeviceLogsTabProps = {
  serial: number;
};

export function DeviceLogsTab({ serial }: Readonly<DeviceLogsTabProps>) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeviceLogListPayload>({
    logs: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.devices.listLogs(serial, { page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setData(result);
        if (page > Math.max(1, result.totalPages)) {
          setPage(Math.max(1, result.totalPages));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load device logs');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [serial, page, reloadToken]);

  const handleRefresh = () => setReloadToken((token) => token + 1);

  if (isLoading) return <p className="device-logs__status">Loading device logs...</p>;

  return (
    <div className="device-logs">
      <div className="device-logs__toolbar">
        <span className="device-logs__summary">
          Recent activity · retained for 30 days · {data.total} entr{data.total === 1 ? 'y' : 'ies'}
        </span>
        <Button
          variant="secondary"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <IconRefresh size={15} strokeWidth={1.8} />
          Refresh logs
        </Button>
      </div>

      {error && (
        <div className="device-logs__error">
          <IconAlertCircle size={17} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {data.logs.length === 0 ? (
        <div className="device-logs__empty">
          <IconCheck size={26} strokeWidth={1.6} />
          <p>No recent device activity.</p>
          <span>Uploads, authentication issues, and rejected data will appear here.</span>
        </div>
      ) : (
        <ul className="device-logs__list">
          {data.logs.map((entry: DeviceLog) => {
            const details = formatDetails(entry.details);
            const timestamp = new Date(entry.createdAt);
            return (
              <li key={entry.id} className={`device-logs__item device-logs__item--${entry.level}`}>
                <span className="device-logs__icon" aria-hidden="true">
                  <LevelIcon level={entry.level} />
                </span>
                <span className="device-logs__body">
                  <span className="device-logs__heading">
                    <span className="device-logs__event">{EVENT_LABELS[entry.event]}</span>
                    <time
                      className="device-logs__time"
                      dateTime={timestamp.toISOString()}
                      title={timestamp.toLocaleString()}
                    >
                      {getRelativeTime(entry.createdAt)}
                    </time>
                  </span>
                  <span className="device-logs__message">{entry.message}</span>
                  {details && <span className="device-logs__details">{details}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        totalPages={data.totalPages}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
