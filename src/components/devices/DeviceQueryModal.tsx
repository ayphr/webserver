import { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import {
  IconAlertCircle,
  IconBraces,
  IconDownload,
  IconExternalLink,
  IconPlayerPlay,
  IconTable,
} from '@tabler/icons-react';
import type { DeviceQueryPayload } from '@common';
import { api } from '../../lib/api';
import { DEVICE_PERIODS, devicePeriodLabel, type DevicePeriod } from '../../lib/devicePeriod';
import { downloadRows, slugifyFilename, type ExportRow } from '../../lib/export';
import { tqlAutocompletion, tqlLanguage } from '../../lib/tqlEditor';
import { Button, Modal } from '../common';
import './DeviceQueryModal.css';

const DEFAULT_QUERY = `findAll(p -> { temperature > 20 })
  then sortDescending(timestamp)
  then limit(100)`;

const MAX_PREVIEW_ROWS = 250;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

function resultRows(result: unknown): ExportRow[] {
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && !(item instanceof Date)) {
        return item as ExportRow;
      }
      return { value: item };
    });
  }

  if (result && typeof result === 'object' && !(result instanceof Date)) {
    return [result as ExportRow];
  }

  return [{ value: result }];
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function joinColumns(rows: ExportRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

export interface DeviceQueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  serial: number;
  deviceName: string;
  defaultPeriod: DevicePeriod;
}

export const DeviceQueryModal = ({
  isOpen,
  onClose,
  serial,
  deviceName,
  defaultPeriod,
}: DeviceQueryModalProps) => {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [period, setPeriod] = useState<DevicePeriod>(defaultPeriod);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DeviceQueryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');

  const rows = useMemo(() => (result ? resultRows(result.result) : []), [result]);
  const columns = useMemo(() => joinColumns(rows.slice(0, MAX_PREVIEW_ROWS)), [rows]);
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);
  const hasResult = result !== null;
  const exportBasename = slugifyFilename(
    `${deviceName}-query-${new Date().toISOString().slice(0, 10)}`,
    `device-${serial}-query`,
  );

  const handleRun = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter a TQL query before running it.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await api.devices.query(serial, { query: trimmed, period });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run query');
    } finally {
      setIsRunning(false);
    }
  };

  const handleExport = (format: 'csv' | 'json') => {
    if (!result || rows.length === 0) return;
    downloadRows(rows, format, exportBasename);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New query"
      size="lg"
      showCancel={false}
    >
      <div className="device-query">
        <div className="device-query__toolbar">
          <div className="device-query__toolbar-left">
            <div className="device-query__period" role="group" aria-label="Query time period">
              {DEVICE_PERIODS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`device-query__period-btn ${period === value ? 'is-active' : ''}`}
                  onClick={() => setPeriod(value)}
                  disabled={isRunning}
                >
                  {devicePeriodLabel(value)}
                </button>
              ))}
            </div>

            <a
              className="device-query__docs-link"
              href="https://docs.ayphr.com/tql/overview/"
              target="_blank"
              rel="noopener noreferrer"
            >
              TQL docs
              <IconExternalLink size={13} strokeWidth={1.75} />
            </a>
          </div>

          <Button
            variant="primary"
            onClick={() => void handleRun()}
            isLoading={isRunning}
            disabled={isRunning}
          >
            <IconPlayerPlay size={16} strokeWidth={2} />
            Run query
            <span className="device-query__keybind" aria-hidden="true">
              <kbd>{IS_MAC ? '⌘' : 'Ctrl'}</kbd>
              <kbd>↵</kbd>
            </span>
          </Button>
        </div>

        <div
          className="device-query__editor"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void handleRun();
            }
          }}
        >
          <CodeMirror
            value={query}
            height="240px"
            theme={oneDark}
            extensions={[tqlLanguage, tqlAutocompletion, EditorView.lineWrapping]}
            basicSetup={{ autocompletion: false }}
            onChange={(value) => setQuery(value)}
          />
        </div>

        {error && (
          <div className="device-query__error" role="alert">
            <IconAlertCircle size={17} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {!hasResult && !error && (
          <div className="device-query__example">
            <strong>Example</strong>
            <code>{DEFAULT_QUERY}</code>
          </div>
        )}

        {result && (
          <div className="device-query__results">
            <div className="device-query__results-header">
              <div className="device-query__results-stats">
                <span>
                  {result.rowCount === null
                    ? 'Scalar result'
                    : `${result.rowCount.toLocaleString()} row${result.rowCount === 1 ? '' : 's'}`}
                </span>
                <span>{result.durationMs.toLocaleString()} ms</span>
                <span>{result.dataPointCount.toLocaleString()} points scanned</span>
                {result.truncated && (
                  <span className="device-query__truncated">
                    Only the most recent 50,000 points were queried
                  </span>
                )}
              </div>

              <div className="device-query__result-actions">
                <div className="device-query__view-toggle" role="group" aria-label="Result view">
                  <button
                    type="button"
                    className={`device-query__view-btn ${viewMode === 'table' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('table')}
                  >
                    <IconTable size={14} strokeWidth={2} />
                    Table
                  </button>
                  <button
                    type="button"
                    className={`device-query__view-btn ${viewMode === 'json' ? 'is-active' : ''}`}
                    onClick={() => setViewMode('json')}
                  >
                    <IconBraces size={14} strokeWidth={2} />
                    JSON
                  </button>
                </div>

                <Button
                  variant="secondary"
                  onClick={() => handleExport('csv')}
                  disabled={rows.length === 0}
                >
                  <IconDownload size={15} strokeWidth={1.75} />
                  CSV
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleExport('json')}
                  disabled={rows.length === 0}
                >
                  <IconDownload size={15} strokeWidth={1.75} />
                  JSON
                </Button>
              </div>
            </div>

            {viewMode === 'table' ? (
              rows.length === 0 ? (
                <div className="device-query__empty">The query returned no rows.</div>
              ) : (
                <div className="device-query__table-wrap">
                  <table className="device-query__table">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => (
                        <tr key={index}>
                          {columns.map((column) => (
                            <td key={column} title={displayCell(row[column])}>
                              {displayCell(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <pre className="device-query__json">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            )}

            {viewMode === 'table' && rows.length > MAX_PREVIEW_ROWS && (
              <p className="device-query__preview-note">
                Showing the first {MAX_PREVIEW_ROWS.toLocaleString()} of {rows.length.toLocaleString()} rows.
                Export to download the full result.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DeviceQueryModal;
