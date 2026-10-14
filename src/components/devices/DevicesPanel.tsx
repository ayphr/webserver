import { useCallback, useEffect, useState } from 'react';
import { IconAlertCircle, IconCopy, IconDatabase, IconPlus, IconRefresh } from '@tabler/icons-react';
import type { DeviceSummary, DeviceToken } from '../../../common';
import { api } from '../../lib/api';
import { Button, Modal } from '../common';
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
  const [token, setToken] = useState<DeviceToken | null>(null);
  const [isTokenOpen, setIsTokenOpen] = useState(false);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleAddDevice = async () => {
    setIsCreatingToken(true);
    setError(null);
    setCopied(false);

    try {
      const created = await api.devices.createToken();
      setToken(created);
      setIsTokenOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a device token');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleCopy = async () => {
    if (!token) return;

    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
    } catch {
      setError('Could not copy the token. Please copy it manually.');
    }
  };

  return (
    <div className="devices">
      <div className="devices__toolbar">
        <p className="devices__hint">
          Devices upload their readings over the API using a device token.
        </p>
        <div className="devices__actions">
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh size={16} strokeWidth={1.75} />
            Refresh
          </Button>
          <Button onClick={() => void handleAddDevice()} isLoading={isCreatingToken}>
            <IconPlus size={16} strokeWidth={1.75} />
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
          <p>Click “Add device” to generate a token and register your first device.</p>
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

      <Modal
        isOpen={isTokenOpen}
        onClose={() => setIsTokenOpen(false)}
        title="Add a device"
        confirmText="Done"
        onConfirm={() => setIsTokenOpen(false)}
      >
        <div className="devices__token">
          <p>
            Enter this one-time token on your device. The device is registered to your
            account the first time it uploads data with it.
          </p>
          <div className="devices__token-row">
            <code className="devices__token-value">{token?.token}</code>
            <Button variant="secondary" onClick={() => void handleCopy()}>
              <IconCopy size={16} strokeWidth={1.75} />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {token && (
            <p className="devices__token-expiry">
              Expires {formatDateTime(token.expiresAt)}. Only one token can be pending per
              account, so generating a new one replaces this.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default DevicesPanel;
