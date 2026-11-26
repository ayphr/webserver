import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconFileDownload,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import type { DeviceLog, DeviceLogEvent, DeviceLogLevel, DeviceLogListPayload } from '@common';
import { api } from '../../lib/api';
import { getRelativeTime } from '../../lib/date';
import { downloadTextFile, slugifyFilename, type ExportFormat } from '../../lib/export';
import { queryKeys } from '../../lib/query';
import { Button, Input, Pagination, Select, Tooltip } from '../common';
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

const LEVEL_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
];

const EVENT_OPTIONS = [
  { value: '', label: 'All events' },
  ...Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label })),
];

const REFRESH_OPTIONS = [
  { value: '0', label: 'Auto-refresh: off' },
  { value: '10', label: 'Auto-refresh: 10s' },
  { value: '30', label: 'Auto-refresh: 30s' },
];

function LevelIcon({ level }: Readonly<{ level: DeviceLogLevel }>) {
  if (level === 'info') return <IconCheck size={15} strokeWidth={2} />;
  if (level === 'warning') return <IconAlertTriangle size={15} strokeWidth={1.9} />;
  return <IconAlertCircle aria-hidden="true" size={15} strokeWidth={1.9} />;
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

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

type DeviceLogsTabProps = {
  serial: number;
};

export function DeviceLogsTab({ serial }: Readonly<DeviceLogsTabProps>) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<DeviceLogLevel | ''>('');
  const [event, setEvent] = useState<DeviceLogEvent | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [autoRefresh, setAutoRefresh] = useState<0 | 10 | 30>(0);
  const [isHidden, setIsHidden] = useState(() => document.visibilityState === 'hidden');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = query.trim();
  const fromIso = toIso(from);
  const toIsoValue = toIso(to);
  const rangeInvalid = Boolean(fromIso && toIsoValue && new Date(fromIso) > new Date(toIsoValue));
  const hasFilters = Boolean(search || level || event || from || to);

  const logsQuery = useQuery({
    queryKey: [...queryKeys.deviceLogs(serial), { page, search, level, event, fromIso, toIsoValue }],
    queryFn: () => api.devices.listLogs(serial, {
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { q: search } : {}),
      ...(level ? { level } : {}),
      ...(event ? { event } : {}),
      ...(fromIso ? { from: fromIso } : {}),
      ...(toIsoValue ? { to: toIsoValue } : {}),
    }),
    enabled: !rangeInvalid,
    meta: { persist: false },
  });

  const data: DeviceLogListPayload = logsQuery.data ?? {
    logs: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1,
  };
  const isLoading = logsQuery.isFetching;
  const error = rangeInvalid
    ? '"From" must be before "to".'
    : logsQuery.error instanceof Error
      ? logsQuery.error.message
      : logsQuery.error
        ? 'Failed to load device logs'
        : null;

  useEffect(() => {
    if (logsQuery.data && page > Math.max(1, logsQuery.data.totalPages)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(Math.max(1, logsQuery.data.totalPages));
    }
  }, [logsQuery.data, page]);

  // Auto-refresh pauses entirely while the tab is hidden or a request is in flight.
  useEffect(() => {
    const handleVisibility = () => setIsHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (autoRefresh === 0 || isHidden || logsQuery.isFetching) return;
    const timer = window.setInterval(() => { void logsQuery.refetch(); }, autoRefresh * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, isHidden, logsQuery]);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const clearFilters = () => {
    setQuery('');
    setLevel('');
    setEvent('');
    setFrom('');
    setTo('');
    setPage(1);
    setExportError(null);
  };

  const handleExport = async (format: ExportFormat) => {
    if (rangeInvalid) {
      setExportError('"From" must be before "to".');
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const content = await api.devices.exportLogs(serial, {
        format,
        ...(search ? { q: search } : {}),
        ...(level ? { level } : {}),
        ...(event ? { event } : {}),
        ...(fromIso ? { from: fromIso } : {}),
        ...(toIsoValue ? { to: toIsoValue } : {}),
      });
      const basename = slugifyFilename(`device-${serial}-logs-${new Date().toISOString().slice(0, 10)}`, 'device-logs');
      downloadTextFile(`${basename}.${format}`, content, format === 'csv' ? 'text/csv' : 'application/json');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export device logs');
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopy = async (entry: DeviceLog) => {
    const text = [
      new Date(entry.createdAt).toISOString(),
      entry.level.toUpperCase(),
      EVENT_LABELS[entry.event],
      entry.message,
      formatDetails(entry.details),
    ].filter(Boolean).join('\n');

    try {
      await copyText(text);
      setCopiedId(entry.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setExportError('Unable to copy this log entry');
    }
  };

  if (isLoading && data.logs.length === 0 && data.total === 0) {
    return <p className="device-logs__status">Loading device logs...</p>;
  }

  return (
    <div className={`device-logs ${isLoading ? 'is-refreshing' : ''}`}>
      <div className="device-logs__toolbar">
        <span className="device-logs__summary">
          Recent activity · retained for 30 days · {data.total} entr{data.total === 1 ? 'y' : 'ies'}
          {autoRefresh > 0 && isHidden && ' · auto-refresh paused while hidden'}
        </span>
        <div className="device-logs__toolbar-actions">
          <Select
            value={String(autoRefresh)}
            onChange={(change) => setAutoRefresh(Number(change.target.value) as 0 | 10 | 30)}
            aria-label="Auto-refresh interval"
            options={REFRESH_OPTIONS}
          />
          <Button
            variant="secondary"
            onClick={() => { void logsQuery.refetch(); }}
            disabled={isLoading || isExporting}
          >
            <IconRefresh size={15} strokeWidth={1.8} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleExport('csv')}
            disabled={isExporting}
          >
            <IconFileDownload size={15} strokeWidth={1.8} />
            Export CSV
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleExport('json')}
            disabled={isExporting}
          >
            <IconFileDownload size={15} strokeWidth={1.8} />
            Export JSON
          </Button>
        </div>
      </div>

      <div className="device-logs__filters">
        <div className="device-logs__filter-search">
          <IconSearch size={15} strokeWidth={1.8} aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(change) => {
              setQuery(change.target.value);
              setPage(1);
            }}
            placeholder="Search messages and details"
            aria-label="Search device logs"
          />
        </div>
        <Select
          value={level}
          onChange={(change) => {
            setLevel(change.target.value as DeviceLogLevel | '');
            setPage(1);
          }}
          aria-label="Filter by level"
          options={LEVEL_OPTIONS}
        />
        <Select
          value={event}
          onChange={(change) => {
            setEvent(change.target.value as DeviceLogEvent | '');
            setPage(1);
          }}
          aria-label="Filter by event"
          options={EVENT_OPTIONS}
        />
        <label className="device-logs__date-field">
          <span>From</span>
          <Input
            type="datetime-local"
            value={from}
            onChange={(change) => {
              setFrom(change.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="device-logs__date-field">
          <span>To</span>
          <Input
            type="datetime-local"
            value={to}
            onChange={(change) => {
              setTo(change.target.value);
              setPage(1);
            }}
          />
        </label>
        {hasFilters && (
          <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>

      {exportError && (
        <div className="device-logs__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={17} strokeWidth={1.75} />
          <span>{exportError}</span>
        </div>
      )}

      {error && (
        <div className="device-logs__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={17} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {data.logs.length === 0 ? (
        <div className="device-logs__empty">
          {hasFilters ? (
            <>
              <IconSearch size={26} strokeWidth={1.6} />
              <p>No logs match your filters.</p>
              <span>Try widening the search or clearing the filters.</span>
              <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
            </>
          ) : (
            <>
              <IconCheck size={26} strokeWidth={1.6} />
              <p>No recent device activity.</p>
              <span>Uploads, authentication issues, and rejected data will appear here.</span>
            </>
          )}
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
                    <span className="device-logs__heading-end">
                      <time
                        className="device-logs__time"
                        dateTime={timestamp.toISOString()}
                        title={timestamp.toLocaleString()}
                      >
                        {getRelativeTime(entry.createdAt)}
                      </time>
                      <Tooltip content={copiedId === entry.id ? 'Copied' : 'Copy log entry'}>
                        <button
                          type="button"
                          className="device-logs__copy"
                          onClick={() => void handleCopy(entry)}
                          aria-label="Copy log entry"
                        >
                          {copiedId === entry.id
                            ? <IconCheck size={14} strokeWidth={2} />
                            : <IconCopy size={14} strokeWidth={1.8} />}
                        </button>
                      </Tooltip>
                    </span>
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
