import { useCallback, useEffect, useState } from 'react';
import { IconBraces, IconDownload, IconFileSpreadsheet } from '@tabler/icons-react';
import { api } from '../../lib/api';
import { downloadTextFile, slugifyFilename, type ExportFormat } from '../../lib/export';
import { Button, Input, Modal } from '../common';
import './DeviceExportModal.css';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeviceExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  serial: number;
  deviceName: string;
}

type CountPreview = { key: string; count: number };

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function filenameStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export const DeviceExportModal = ({
  isOpen,
  onClose,
  serial,
  deviceName,
}: DeviceExportModalProps) => {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<CountPreview | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (fromValue: string, toValue: string) => {
    const startDate = new Date(fromValue);
    const endDate = new Date(toValue);
    if (!fromValue || !toValue || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
      return;
    }

    const key = `${startDate.toISOString()}|${endDate.toISOString()}`;
    setLoadingKey(key);
    setError(null);
    try {
      const result = await api.devices.getDataPoints(serial, {
        countOnly: true,
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      });
      setPreview({ key, count: result.totalCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to count data points');
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  }, [serial]);

  useEffect(() => {
    if (!isOpen) return;
    const now = new Date();
    const start = toLocalInput(new Date(now.getTime() - DAY_MS));
    const end = toLocalInput(now);
    // Each opening starts from a fresh last-24h range.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormat('csv');
    setFrom(start);
    setTo(end);
    setPreview(null);
    setLoadingKey(null);
    setError(null);
    void loadPreview(start, end);
  }, [isOpen, loadPreview]);

  const fromIso = toIso(from);
  const toIsoValue = toIso(to);
  const rangeInvalid = !fromIso || !toIsoValue || new Date(fromIso) > new Date(toIsoValue);
  const previewKey = rangeInvalid ? '' : `${fromIso}|${toIsoValue}`;
  const previewCount = preview?.key === previewKey ? preview.count : null;
  const isPreviewLoading = Boolean(previewKey && loadingKey === previewKey);

  const basename = slugifyFilename(
    `${deviceName}-telemetry-${fromIso ? filenameStamp(new Date(fromIso)) : 'from'}-to-${toIsoValue ? filenameStamp(new Date(toIsoValue)) : 'to'}`,
    'device-telemetry',
  );
  const filename = `${basename}.${format}`;

  const changeRange = (nextFrom: string, nextTo: string) => {
    setPreview(null);
    void loadPreview(nextFrom, nextTo);
  };

  const handleDownload = async () => {
    if (rangeInvalid || !fromIso || !toIsoValue) return;

    setIsDownloading(true);
    setError(null);
    try {
      const content = await api.devices.exportDataPoints(serial, {
        from: fromIso,
        to: toIsoValue,
        format,
      });
      downloadTextFile(filename, content, format === 'csv' ? 'text/csv' : 'application/json');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export telemetry data');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export telemetry data" size="md" showCancel={false}>
      <div className="device-export">
        <p className="device-export__intro">
          Download every telemetry point recorded for <strong>{deviceName}</strong> in the selected range,
          straight from the server. This is independent of the graph&apos;s current time period.
        </p>

        <div className="device-export__range">
          <label className="device-export__field">
            <span className="device-export__label">From</span>
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                changeRange(event.target.value, to);
              }}
            />
          </label>
          <label className="device-export__field">
            <span className="device-export__label">To</span>
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                changeRange(from, event.target.value);
              }}
            />
          </label>
        </div>

        {rangeInvalid && (
          <p className="device-export__error" role="alert">Choose a valid range with From before To.</p>
        )}
        {error && (
          <p className="device-export__error" role="alert">{error}</p>
        )}

        <div className="device-export__summary">
          <div>
            <span className="device-export__label">Points</span>
            <span className="device-export__value">
              {isPreviewLoading
                ? 'Counting...'
                : previewCount === null
                  ? '—'
                  : previewCount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="device-export__label">Range</span>
            <span className="device-export__value device-export__value--range">
              {fromIso && toIsoValue
                ? `${new Date(fromIso).toLocaleString()} → ${new Date(toIsoValue).toLocaleString()}`
                : '—'}
            </span>
          </div>
          <div>
            <span className="device-export__label">File</span>
            <span className="device-export__value device-export__value--file">{filename}</span>
          </div>
        </div>

        <div className="device-export__formats" role="radiogroup" aria-label="Export format">
          <button
            type="button"
            role="radio"
            aria-checked={format === 'csv'}
            className={`device-export__format ${format === 'csv' ? 'is-active' : ''}`}
            onClick={() => setFormat('csv')}
          >
            <IconFileSpreadsheet size={20} strokeWidth={1.75} />
            <span>
              <strong>CSV</strong>
              <small>Spreadsheet-friendly, one row per data point</small>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={format === 'json'}
            className={`device-export__format ${format === 'json' ? 'is-active' : ''}`}
            onClick={() => setFormat('json')}
          >
            <IconBraces size={20} strokeWidth={1.75} />
            <span>
              <strong>JSON</strong>
              <small>Structured data for scripts and APIs</small>
            </span>
          </button>
        </div>

        {!rangeInvalid && !isPreviewLoading && previewCount === 0 && (
          <div className="device-export__empty">
            There are no data points to export in this range.
          </div>
        )}

        <div className="device-export__actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleDownload()}
            disabled={rangeInvalid || isPreviewLoading}
            isLoading={isDownloading}
          >
            <IconDownload size={16} strokeWidth={1.75} />
            Download {format.toUpperCase()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeviceExportModal;
