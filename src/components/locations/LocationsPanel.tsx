import { useCallback, useEffect, useId, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconMapPin,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DeviceSummary, Location } from '@common';
import { getPlanFeaturesForUser } from '@common';
import { api } from '../../lib/api';
import { isDeviceOnline as isOnline } from '../../lib/deviceActivity';
import type { DashboardTarget, LocationDetailTab, LocationRouteState } from '../../lib/dashboardRoutes';
import { Button, Card, ConfirmDialog, createTabKeyDownHandler, Input, Modal, Pagination, Select, Tooltip, type SelectOption } from '../common';
import { useDevicesMine } from '../../lib/query/hooks/useDevices';
import { useLocationsMine } from '../../lib/query/hooks/useLocations';
import { queryKeys } from '../../lib/query';
import '../common/Tabs.css';
import './LocationsPanel.css';

const PAGE_SIZE = 5;
const LOCATION_TABS: readonly LocationDetailTab[] = ['overview', 'devices', 'settings'];

type LocationStats = {
  deviceCount: number;
  onlineCount: number;
  lastSeen: string | null;
};

const EMPTY_LOCATION_STATS: LocationStats = { deviceCount: 0, onlineCount: 0, lastSeen: null };

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

const LOCATION_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All' },
  { value: 'default', label: 'Default' },
  { value: 'custom', label: 'Custom' },
  { value: 'online', label: 'Has online devices' },
  { value: 'empty', label: 'Empty' },
];
type LocationFilter = 'all' | 'default' | 'custom' | 'online' | 'empty';

const LOCATION_SORT_OPTIONS: SelectOption[] = [
  { value: 'name', label: 'Name' },
  { value: 'devices', label: 'Device count' },
  { value: 'online', label: 'Online count' },
  { value: 'recent', label: 'Recently active' },
];
type LocationSort = 'name' | 'devices' | 'online' | 'recent';

type Props = {
  onDeviceNavigate: (serial: number) => void;
  onNavigate: (target: DashboardTarget) => void;
  locationRoute?: LocationRouteState | null;
};

export const LocationsPanel = ({ onDeviceNavigate, onNavigate, locationRoute }: Props) => {
  const queryClient = useQueryClient();
  const locationsQuery = useLocationsMine();
  const devicesQuery = useDevicesMine();
  const meQuery = useQuery({ queryKey: queryKeys.bootstrap(), queryFn: () => api.users.me() });
  const locationsData = locationsQuery.data;
  const devicesData = devicesQuery.data;
  const locations = useMemo(() => locationsData ?? [], [locationsData]);
  const devices = useMemo(() => devicesData ?? [], [devicesData]);
  const user = meQuery.data?.user ?? null;
  const [locationPage, setLocationPage] = useState(1);
  const [locationDevicePage, setLocationDevicePage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LocationFilter>('all');
  const [sort, setSort] = useState<LocationSort>('name');
  const isLoading = (!locationsData && locationsQuery.isPending) || (!devicesData && devicesQuery.isPending);
  const isRefreshing = (locationsQuery.isFetching || devicesQuery.isFetching) && !isLoading;
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedId = locationRoute?.id ?? null;
  const detailTab: LocationDetailTab = locationRoute?.detailTab ?? 'overview';
  const tabIdPrefix = useId();

  const queryError = locationsQuery.error ?? devicesQuery.error;
  const error = actionError ?? (queryError instanceof Error ? queryError.message : queryError ? 'Failed to load locations' : null);

  const load = useCallback(async () => {
    setActionError(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.locationsMine() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.devicesMine() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() }),
    ]);
  }, [queryClient]);

  // A stale location deep link falls back to the canonical plain locations route.
  useEffect(() => {
    if (!isLoading && locationRoute && !locations.some((location) => location.id === locationRoute.id)) {
      onNavigate({ tab: 'locations' });
    }
  }, [isLoading, locationRoute, locations, onNavigate]);

  const selectedLocation = useMemo(
    () => (locationsQuery.data ?? []).find((location) => location.id === selectedId) ?? null,
    [locationsQuery.data, selectedId],
  );

  const locationDevices = useMemo(
    () => devices.filter((device) => device.locationId === selectedId),
    [devices, selectedId],
  );

  const locationStatsById = useMemo(() => {
    const stats = new Map<string, LocationStats & { lastActive: number }>();
    for (const device of devices) {
      if (!device.locationId) continue;
      const entry = stats.get(device.locationId) ?? { deviceCount: 0, onlineCount: 0, lastSeen: null, lastActive: 0 };
      entry.deviceCount += 1;
      if (isOnline(device)) entry.onlineCount += 1;
      const rawTimes = [device.lastUploadAt, device.latestDataPoint?.timestamp];
      const timestamps = rawTimes
        .filter((value): value is NonNullable<typeof value> => value != null)
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value));
      if (timestamps.length > 0) {
        entry.lastActive = Math.max(entry.lastActive, ...timestamps);
        entry.lastSeen = new Date(entry.lastActive).toISOString();
      }
      stats.set(device.locationId, entry);
    }
    return stats;
  }, [devices]);

  const filteredLocations = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const matching = locations.filter((location) => {
      if (term && !location.name.toLocaleLowerCase().includes(term)) return false;
      const stats = locationStatsById.get(location.id) ?? EMPTY_LOCATION_STATS;
      switch (filter) {
        case 'default': return Boolean(location.isDefault);
        case 'custom': return !location.isDefault;
        case 'online': return stats.onlineCount > 0;
        case 'empty': return stats.deviceCount === 0;
        default: return true;
      }
    });

    return matching.sort((a, b) => {
      const aStats = locationStatsById.get(a.id) ?? { ...EMPTY_LOCATION_STATS, lastActive: 0 };
      const bStats = locationStatsById.get(b.id) ?? { ...EMPTY_LOCATION_STATS, lastActive: 0 };
      switch (sort) {
        case 'devices':
          return bStats.deviceCount - aStats.deviceCount || a.name.localeCompare(b.name);
        case 'online':
          return bStats.onlineCount - aStats.onlineCount || a.name.localeCompare(b.name);
        case 'recent':
          return bStats.lastActive - aStats.lastActive || a.name.localeCompare(b.name);
        default:
          return a.name.localeCompare(b.name);
      }
    });
  }, [filter, locationStatsById, locations, search, sort]);

  const hasFilters = search.trim().length > 0 || filter !== 'all';
  const locationTotalPages = Math.max(1, Math.ceil(filteredLocations.length / PAGE_SIZE));
  const currentLocationPage = Math.min(locationPage, locationTotalPages);
  const visibleLocations = useMemo(
    () => filteredLocations.slice((currentLocationPage - 1) * PAGE_SIZE, currentLocationPage * PAGE_SIZE),
    [currentLocationPage, filteredLocations],
  );
  const locationDeviceTotalPages = Math.max(1, Math.ceil(locationDevices.length / PAGE_SIZE));
  const currentLocationDevicePage = Math.min(locationDevicePage, locationDeviceTotalPages);
  const visibleLocationDevices = useMemo(
    () => locationDevices.slice(
      (currentLocationDevicePage - 1) * PAGE_SIZE,
      currentLocationDevicePage * PAGE_SIZE,
    ),
    [currentLocationDevicePage, locationDevices],
  );

  const planFeatures = user ? getPlanFeaturesForUser(user) : null;
  const maxLocations = planFeatures?.maxLocations ?? null;
  const atLocationLimit = maxLocations !== null && locations.length >= maxLocations;

  const [prevLocationId, setPrevLocationId] = useState<string | null>(null);
  if (selectedLocation && selectedLocation.id !== prevLocationId) {
    setPrevLocationId(selectedLocation.id);
    setSettingsName(selectedLocation.name);
  }

  const [prevDeviceLocationId, setPrevDeviceLocationId] = useState<string | null>(null);
  if (selectedId !== prevDeviceLocationId) {
    setPrevDeviceLocationId(selectedId);
    setLocationDevicePage(1);
  }

  const handleRefresh = async () => {
    await load();
  };

  const clearFilters = () => {
    setSearch('');
    setFilter('all');
    setSort('name');
    setLocationPage(1);
  };

  const openLocation = (id: string) => {
    onNavigate({ tab: 'locations', location: { id, detailTab: 'overview' } });
  };

  const selectTab = (tab: LocationDetailTab) => {
    if (!selectedId) return;
    onNavigate({ tab: 'locations', location: { id: selectedId, detailTab: tab } });
  };
  const handleTabsKeyDown = createTabKeyDownHandler<LocationDetailTab>(selectTab);

  const handleLocationCardKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openLocation(id);
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    setIsCreating(true);
    setActionError(null);
    try {
      const created = await api.locations.create(name);
      queryClient.setQueryData(queryKeys.locationsMine(), (current: Location[] | undefined) => [...(current ?? []), created]);
      setCreateName('');
      setIsCreateOpen(false);
      onNavigate({ tab: 'locations', location: { id: created.id, detailTab: 'overview' } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create location');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedLocation) return;
    const name = settingsName.trim();
    if (!name) return;
    setIsSavingSettings(true);
    setActionError(null);
    try {
      const updated = await api.locations.update(selectedLocation.id, { name });
      queryClient.setQueryData(queryKeys.locationsMine(), (current: Location[] | undefined) => (current ?? []).map((location) => (location.id === updated.id ? updated : location)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update location');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLocation || selectedLocation.isDefault) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await api.locations.remove(selectedLocation.id);
      queryClient.setQueryData(queryKeys.locationsMine(), (current: Location[] | undefined) => (current ?? []).filter((location) => location.id !== selectedLocation.id));
      setIsDeleteOpen(false);
      onNavigate({ tab: 'locations' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete location');
    } finally {
      setIsDeleting(false);
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

  if (locationRoute === null || !selectedLocation) {
    return (
      <div className="locations">
        {error && (
          <div className="locations__error" role="alert">
            <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        <div className="locations__toolbar">
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh aria-hidden="true" size={16} strokeWidth={1.75} />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => setIsCreateOpen(true)} disabled={atLocationLimit}>
            <IconPlus aria-hidden="true" size={16} strokeWidth={1.75} />
            Create location
          </Button>
        </div>

        <div className="locations__filters">
          <div className="locations__filter-search">
            <IconSearch aria-hidden="true" size={16} strokeWidth={1.8} />
            <Input
              type="search"
              className="locations__search"
              value={search}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setSearch(event.target.value);
                setLocationPage(1);
              }}
              placeholder="Search locations"
              aria-label="Search locations"
            />
          </div>
          <Select
            aria-label="Filter locations"
            value={filter}
            options={LOCATION_FILTER_OPTIONS}
            onChange={(event) => {
              setFilter(event.target.value as LocationFilter);
              setLocationPage(1);
            }}
          />
          <Select
            aria-label="Sort locations"
            value={sort}
            options={LOCATION_SORT_OPTIONS}
            onChange={(event) => {
              setSort(event.target.value as LocationSort);
              setLocationPage(1);
            }}
          />
        </div>

        {maxLocations !== null && (
          <p className="locations__limit">
            Locations: {locations.length} / {maxLocations.toLocaleString()}
            {atLocationLimit && <span className="locations__limit-warning"> Location limit reached.</span>}
          </p>
        )}

        {filteredLocations.length === 0 ? (
          <div className="locations__empty">
            <p>{hasFilters ? 'No locations match your filters' : 'No locations yet.'}</p>
            {hasFilters && (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="locations__list">
            {visibleLocations.map((location) => {
              const cardStats = locationStatsById.get(location.id) ?? { ...EMPTY_LOCATION_STATS, lastActive: 0 };
              return (
                <Card
                  key={location.id}
                  elevated
                  className="locations__location-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${location.name}`}
                  onClick={() => openLocation(location.id)}
                  onKeyDown={(event) => handleLocationCardKeyDown(event, location.id)}
                >
                  <div className="locations__location-card__content">
                    <IconMapPin aria-hidden="true" size={18} strokeWidth={1.75} />
                    <div>
                      <div className="locations__location-card__name">{location.name}</div>
                      <div className="locations__location-card__meta">
                        {location.isDefault ? 'Default location' : 'Custom location'} · {cardStats.deviceCount} devices · {cardStats.onlineCount} online
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        <Pagination page={currentLocationPage} totalPages={locationTotalPages} onPageChange={setLocationPage} disabled={isRefreshing} />

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
            aria-label="Location name"
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
        <div className="locations__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      <div className="locations__toolbar">
        <Button variant="secondary" onClick={() => onNavigate({ tab: 'locations' })}>
          <IconArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
          Back to locations
        </Button>
        <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
          <IconRefresh aria-hidden="true" size={16} strokeWidth={1.75} />
          Refresh
        </Button>
      </div>

      <h3 className="locations__title">{selectedLocation.name}</h3>

      <div className="ui-tabs" role="tablist" aria-label="Location sections" onKeyDown={handleTabsKeyDown}>
        {LOCATION_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            data-tab-id={tab}
            aria-selected={detailTab === tab}
            aria-controls={`${tabIdPrefix}-panel`}
            id={`${tabIdPrefix}-tab-${tab}`}
            tabIndex={detailTab === tab ? 0 : -1}
            className={`ui-tab ${detailTab === tab ? 'ui-tab--active' : ''}`}
            onClick={() => selectTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div
        className="ui-tab-panel"
        role="tabpanel"
        id={`${tabIdPrefix}-panel`}
        aria-labelledby={`${tabIdPrefix}-tab-${detailTab}`}
        tabIndex={0}
      >
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
                {visibleLocationDevices.map((device) => (
                  <li key={device.serial}>
                    <button
                      type="button"
                      className="locations__device-item"
                      onClick={() => onDeviceNavigate(device.serial)}
                    >
                      <div>
                        <span className="locations__device-name">{deviceLabel(device)}</span>
                        <span className="locations__device-serial">#{device.serial}</span>
                      </div>
                      <Tooltip content={isOnline(device) ? 'Online' : 'Offline'}>
                        <span
                          className={`locations__device-status ${isOnline(device) ? 'is-online' : 'is-offline'}`}
                          aria-label={isOnline(device) ? 'Online' : 'Offline'}
                        >
                          {isOnline(device) ? <IconWifi aria-hidden="true" size={18} strokeWidth={1.75} /> : <IconWifiOff aria-hidden="true" size={18} strokeWidth={1.75} />}
                        </span>
                      </Tooltip>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              page={currentLocationDevicePage}
              totalPages={locationDeviceTotalPages}
              onPageChange={setLocationDevicePage}
              disabled={isRefreshing}
            />
          </div>
        )}

        {detailTab === 'settings' && (
          <div className="locations__settings">
            <label className="locations__field">
              <span>Name</span>
              <Input
                value={settingsName}
                onChange={(event) => setSettingsName(event.target.value)}
                aria-label="Location name"
              />
            </label>
            <div className="locations__settings-actions">
              <Button variant="primary" onClick={() => void handleSaveSettings()} isLoading={isSavingSettings} disabled={!settingsName.trim()}>
                Save
              </Button>
              {!selectedLocation.isDefault && (
                <Button variant="danger" onClick={() => setIsDeleteOpen(true)}>
                  <IconTrash aria-hidden="true" size={16} strokeWidth={1.75} />
                  Delete location
                </Button>
              )}
            </div>
          </div>
        )}
        <ConfirmDialog
          isOpen={isDeleteOpen}
          title="Delete location"
          confirmText={isDeleting ? 'Deleting...' : 'Delete'}
          cancelText="Cancel"
          isDangerous
          confirmDisabled={isDeleting}
          onConfirm={() => void handleDelete()}
          onCancel={() => setIsDeleteOpen(false)}
        >
          <p>Are you sure you want to delete &quot;{selectedLocation.name}&quot;? This cannot be undone.</p>
        </ConfirmDialog>
      </div>
    </div>
  );
};
