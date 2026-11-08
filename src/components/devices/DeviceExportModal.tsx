import { useMemo, useState } from 'react';
import { IconBraces, IconDownload, IconFileSpreadsheet } from '@tabler/icons-react';
import type { DataPoint } from '@common';
import { toDate } from '../../lib/date';
import { devicePeriodLabel, type DevicePeriod } from '../../lib/devicePeriod';
import { downloadRows, slugifyFilename, type ExportFormat, type ExportRow } from '../../lib/export';
import { Button, Modal } from '../common';
import './DeviceExportModal.css';

export type DeviceExportSeries = {
  id: string;
  label: string;
  unit: string;
  getValue: (point: DataPoint) => number;
};

export interface DeviceExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceName: string;
  period: DevicePeriod;
  dataPoints: DataPoint[];
  series: DeviceExportSeries[];
}

export const DeviceExportModal = ({
  isOpen,
  onClose,
  deviceName,
  period,
  dataPoints,
  series,
}: DeviceExportModalProps) => {
  const [format, setFormat] = useState<ExportFormat>('csv');

  const rows = useMemo<ExportRow[]>(() => {
    return dataPoints.map((point) => {
      const row: ExportRow = { timestamp: toDate(point.timestamp).toISOString() };

      if (series.length > 0) {
        for (const definition of series) {
          row[definition.id] = definition.getValue(point);
        }
      } else {
        row.temperature = point.temperature;
        row.humidity = point.humidity;
        row.airPressure = point.airPressure;
      }

      return row;
    });
  }, [dataPoints, series]);

  const columns = useMemo(() => Object.keys(rows[0] ?? {}), [rows]);
  const basename = slugifyFilename(
    `${deviceName}-telemetry-${period}-${new Date().toISOString().slice(0, 10)}`,
    'device-telemetry',
  );
  const filename = `${basename}.${format}`;

  const handleDownload = () => {
    if (rows.length === 0) return;
    downloadRows(rows, format, basename);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export graph data" size="md" showCancel={false}>
      <div className="device-export">
        <p className="device-export__intro">
          Download the data currently plotted on the graph for the <strong>{devicePeriodLabel(period)}</strong>{' '}
          period. The export includes the {series.length > 0 ? `${series.length} selected series` : 'raw telemetry fields'}.
        </p>

        <div className="device-export__summary">
          <div>
            <span className="device-export__label">Rows</span>
            <span className="device-export__value">{rows.length.toLocaleString()}</span>
          </div>
          <div>
            <span className="device-export__label">Columns</span>
            <span className="device-export__value">{columns.length.toLocaleString()}</span>
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

        {rows.length === 0 && (
          <div className="device-export__empty">
            There are no data points to export for this period.
          </div>
        )}

        <div className="device-export__actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleDownload} disabled={rows.length === 0}>
            <IconDownload size={16} strokeWidth={1.75} />
            Download {format.toUpperCase()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default DeviceExportModal;
