import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconMapPin,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import type { DeviceSummary, Location, PublicUser } from '@common';
import { getPlanFeaturesForUser } from '@common';
import { api } from '../../lib/api';
import { Button, Card, Input, Modal } from '../common';
import '../settings/SettingsPanel.css';
import './LocationsPanel.css';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function isOnline(device: DeviceSummary): boolean {
  if (!device.lastUploadAt) return false;
  return Date.now() - new Date(device.lastUploadAt).getTime() <= ONLINE_THRESHOLD_MS;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type View = 'list' | 'detail';

export const LocationsPanel = () => {
  const [view, setView] = useState<View>('list');
  const [locations, setLocations] = useState<Location[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'overview' | 'devices' | 'settings'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [loadedLocations, loadedDevices, userData] = await Promise.all([
        api.locations.listMine(),
        api.devices.listMine(),
        api.users.me().catch(() => null),
      ]);
      setLocations(loadedLocations);
      setDevices(loadedDevices);
      if (userData) setUser(userData.user);
      setSelectedId((current) => {
        if (current && loadedLocations.some((location) => location.id === current)) return current;
        return loadedLocations[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locations');
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      await load();
      setIsLoading(false);
    })();
  }, [load]);

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedId) ?? null,
    [locations, selectedId],
  );

  const locationDevices = useMemo(
    () => devices.filter((device) => device.locationId === selectedId),
    [devices, selectedId],
  );

  const planFeatures = user ? getPlanFeaturesForUser(user) : null;
  const maxLocations = planFeatures?.maxLocations ?? null;
  const atLocationLimit = maxLocations !== null && locations.length >= maxLocations;

  useEffect(() => {
    if (selectedLocation) setSettingsName(selectedLocation.name);
  }, [selectedLocation]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setIsCreating(true);
    setError(null);
    try {
      const created = await api.locations.create(name);
      setLocations((current) => [...current, created]);
      setCreateName('');
      setIsCreateOpen(false);
      setSelectedId(created.id);
      setView('detail');
      setDetailTab('overview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create location');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedLocation) return;
    const name = settingsName.trim();
    if (!name) return;
    setIsSavingSettings(true);
    setError(null);
    try {
      const updated = await api.locations.update(selectedLocation.id, { name });
      setLocations((current) =>
        current.map((location) => (location.id === updated.id ? updated : location)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update location');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLocation || selectedLocation.isDefault) return;
    setError(null);
    try {
      await api.locations.remove(selectedLocation.id);
      const remaining = locations.filter((location) => location.id !== selectedLocation.id);
      setLocations(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setView('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
    }
  };

  const stats = useMemo(() => {
    const readings = locationDevices
      .map((device) => device.latestDataPoint)
      .filter((point): point is NonNullable<DeviceSummary['latestDataPoint']> => Boolean(point));
    return {
      deviceCount: locationDevices.length,
      onlineCount: locationDevices.filter(isOnline).length,
      offlineCount: locationDevices.length - locationDevices.filter(isOnline).length,
      avgTemperature: average(readings.map((point) => point.temperature)),
      avgHumidity: average(readings.map((point) => point.humidity)),
      avgPressure: average(readings.map((point) => point.airPressure)),
    };
  }, [locationDevices]);

  if (isLoading) {
    return <p className="locations__notice">Loading locations...</p>;
  }

  const effectiveView = view === 'detail' && selectedLocation ? 'detail' : 'list';

  if (effectiveView === 'list') {
    return (
      <div className="locations">
        {error && (
          <div className="locations__error">
            <IconAlertCircle size={16} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <div className="locations__toolbar">
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh size={16} strokeWidth={1.75} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={atLocationLimit}>
            <IconPlus size={16} strokeWidth={1.75} />
            Create location
          </Button>
        </div>

        {maxLocations !== null && (
          <p className="locations__limit">
            Locations: {locations.length} / {maxLocations.toLocaleString()}
            {atLocationLimit && <span className="locations__limit-warning"> Location limit reached.</span>}
          </p>
        )}

        <div className="locations__list">
          {locations.map((location) => (
            <Card
              key={location.id}
              elevated
              className="locations__location-card"
              onClick={() => {
                setSelectedId(location.id);
                setDetailTab('overview');
                setView('detail');
              }}
            >
              <div className="locations__location-card__content">
                <IconMapPin size={18} strokeWidth={1.75} />
                <div>
                  <div className="locations__location-card__name">{location.name}</div>
                  <div className="locations__location-card__meta">
                    {location.isDefault ? 'Default location' : 'Custom location'}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Modal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Create location"
          onConfirm={() => void handleCreate()}
          confirmText="Create"
          confirmDisabled={isCreating || !createName.trim()}
        >
          <Input
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Location name"
            disabled={isCreating}
            fullWidth
          />
        </Modal>
      </div>
    );
  }

  return (
    <div className="locations">
      {error && (
        <div className="locations__error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      <div className="locations__toolbar">
        <Button variant="secondary" onClick={() => setView('list')}>
          <IconArrowLeft size={16} strokeWidth={1.75} />
          Back to locations
        </Button>
        <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
          <IconRefresh size={16} strokeWidth={1.75} />
          Refresh
        </Button>
      </div>

      <h3 className="locations__title">{selectedLocation!.name}</h3>

      <div className="settings__tabs" role="tablist" aria-label="Location sections">
        {(['overview', 'devices', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={detailTab === tab}
            className={`settings__tab ${detailTab === tab ? 'settings__tab--active' : ''}`}
            onClick={() => setDetailTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="settings__panel">
        {detailTab === 'overview' && (
          <div className="locations__overview">
            <div className="locations__stat-grid">
              <div className="locations__stat">
                <span className="locations__stat-label">Devices</span>
                <span className="locations__stat-value">{stats.deviceCount}</span>
              </div>
              <div className="locations__stat">
                <span className="locations__stat-label">Online</span>
                <span className="locations__stat-value">{stats.onlineCount}</span>
              </div>
              <div className="locations__stat">
                <span className="locations__stat-label">Offline</span>
                <span className="locations__stat-value">{stats.offlineCount}</span>
              </div>
              <div className="locations__stat">
                <span className="locations__stat-label">Avg temp</span>
                <span className="locations__stat-value">
                  {stats.avgTemperature === null ? '—' : `${stats.avgTemperature.toFixed(1)} °C`}
                </span>
              </div>
              <div className="locations__stat">
                <span className="locations__stat-label">Avg humidity</span>
                <span className="locations__stat-value">
                  {stats.avgHumidity === null ? '—' : `${stats.avgHumidity.toFixed(1)} %`}
                </span>
              </div>
              <div className="locations__stat">
                <span className="locations__stat-label">Avg pressure</span>
                <span className="locations__stat-value">
                  {stats.avgPressure === null ? '—' : `${stats.avgPressure.toFixed(0)} hPa`}
                </span>
              </div>
            </div>
          </div>
        )}

        {detailTab === 'devices' && (
          <div className="locations__devices">
            {locationDevices.length === 0 ? (
              <p className="locations__notice">No devices in this location yet.</p>
            ) : (
              <ul className="locations__device-list">
                {locationDevices.map((device) => (
                  <li key={device.serial} className="locations__device-item">
                    <div>
                      <span className="locations__device-name">
                        {device.name?.trim() || `Device ${device.serial}`}
                      </span>
                      <span className="locations__device-serial">#{device.serial}</span>
                    </div>
                    <span className={`locations__device-status ${isOnline(device) ? 'is-online' : 'is-offline'}`}>
                      {isOnline(device) ? 'Online' : 'Offline'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {detailTab === 'settings' && (
          <div className="locations__settings">
            <label className="locations__field">
              <span>Name</span>
              <Input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} />
            </label>
            <div className="locations__settings-actions">
              <Button variant="primary" onClick={() => void handleSaveSettings()} isLoading={isSavingSettings} disabled={!settingsName.trim()}>
                Save
              </Button>
              {!selectedLocation!.isDefault && (
                <Button variant="danger" onClick={() => void handleDelete()}>
                  <IconTrash size={16} strokeWidth={1.75} />
                  Delete location
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};