import { useCallback, useEffect, useState } from 'react';
import { IconAlertCircle, IconDatabase, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import type { DeviceSummary } from '@common';
import { api } from '../../lib/api';
import { Button } from '../common';
import './DevicesPanel.css';

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDateTime(value: Date | string | undefined): string {
  if (!value) return 'Never';
  return toDate(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatReading(device: DeviceSummary): string {
  const reading = device.latestDataPoint;
  if (!reading) return 'No data yet';

  return `${reading.temperature.toFixed(1)} °C · ${reading.humidity.toFixed(1)} % · ${reading.airPressure.toFixed(0)} hPa`;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

export const DevicesPanel = () => {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDevices(await api.devices.listMine());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      await load();
      setIsLoading(false);
    })();
  }, [load]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  return (
    <div className="devices">
      <div className="devices__toolbar">
        <div className="devices__actions">
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh size={16} strokeWidth={1.75} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => window.open('https://ayphr.com/link', '_blank', 'noopener,noreferrer')}>
            <IconExternalLink size={16} strokeWidth={1.75} />
            Add device
          </Button>
        </div>
      </div>

      {error && (
        <div className="devices__error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <p className="devices__notice">Loading devices...</p>
      ) : devices.length === 0 ? (
        <div className="devices__empty">
          <IconDatabase size={28} strokeWidth={1.5} />
          <h3>No devices yet</h3>
          <p>Use "Add device" to open ayphr.com/link and enter the code shown on your device.</p>
        </div>
      ) : (
        <ul className="devices__list">
          {devices.map((device) => (
            <li key={device.serial} className="devices__item">
              <div className="devices__item-head">
                <span className="devices__item-name">{deviceLabel(device)}</span>
                <span className="devices__serial">#{device.serial}</span>
              </div>
              <div className="devices__reading">{formatReading(device)}</div>
              <div className="devices__meta">
                <span>{device.dataPointCount.toLocaleString()} data points</span>
                <span>Last upload: {formatDateTime(device.lastUploadAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
};

export default DevicesPanel;
