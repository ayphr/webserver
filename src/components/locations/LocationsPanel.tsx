import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
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
import type { DataPoint, DeviceSummary, Location, PublicUser } from '@common';
import { getPlanFeaturesForUser } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { isDeviceOnline as isOnline } from '../../lib/deviceActivity';
import { devicePeriodLabel, DEVICE_PERIODS, type DevicePeriod } from '../../lib/devicePeriod';
import { CHART_COLORS, createLineGraphConfig, resolveCssColor } from '../../lib/chartTheme';
import type { DashboardTarget, LocationDetailTab, LocationRouteState } from '../../lib/dashboardRoutes';
import { Button, Card, ConfirmDialog, createTabKeyDownHandler, Input, Modal, Pagination, Select, Tooltip, type SelectOption } from '../common';
import { LineGraph } from '../graphs';
import type { LineGraphData } from '../graphs/types';
import '../common/Tabs.css';
import './LocationsPanel.css';

const PAGE_SIZE = 5;
const LOCATION_TABS: readonly LocationDetailTab[] = ['overview', 'devices', 'history', 'settings'];

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

const HISTORY_MODE_OPTIONS: SelectOption[] = [
  { value: 'period', label: 'Dashboard period' },
  { value: 'range', label: 'Custom range' },
];
type HistoryMode = 'period' | 'range';

const HISTORY_METRICS = [
  { value: 'temperature', label: 'Temperature', unit: '°C' },
  { value: 'humidity', label: 'Humidity', unit: '%' },
  { value: 'airPressure', label: 'Pressure', unit: 'hPa' },
] as const;
type HistoryMetric = (typeof HISTORY_METRICS)[number]['value'];

/** Monochrome dataset styling: tone, dash and marker shape keep devices distinct. */
const HISTORY_LINE_STYLES: Array<{ color: string; dash?: number[]; pointStyle: NonNullable<LineGraphData['datasets'][number]['pointStyle']> }> = [
  { color: 'var(--text-primary)', pointStyle: 'circle' },
  { color: 'var(--text-muted)', dash: [6, 4], pointStyle: 'rect' },
  { color: 'var(--text-dim)', dash: [2, 4], pointStyle: 'triangle' },
  { color: 'var(--border-focus)', dash: [10, 4], pointStyle: 'cross' },
];

type LocationStats = {
  deviceCount: number;
  onlineCount: number;
  lastActive: number;
};

const EMPTY_LOCATION_STATS: LocationStats = { deviceCount: 0, onlineCount: 0, lastActive: 0 };
type HistorySeries = { serial: number; name: string; points: DataPoint[] };

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

function formatChartLabel(value: Date | string, withYear = false): string {
  const date = toDate(value);
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const day = date.toLocaleDateString(
    'en-GB',
    withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' },
  );
  return withYear ? `${day} ${time}` : time;
}

/**
 * History for the devices currently assigned to one location. Mounted only
 * while the history tab is active so its controls and results reset per location.
 */
const LocationHistory = ({ devices }: { devices: DeviceSummary[] }) => {
  const [mode, setMode] = useState<HistoryMode>('period');
  const [period, setPeriod] = useState<DevicePeriod>('24h');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [metric, setMetric] = useState<HistoryMetric>('temperature');
  const [series, setSeries] = useState<HistorySeries[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  const rangeError = useMemo(() => {
    if (mode !== 'range') return null;
    if (!from || !to) return 'Choose a start and an end date.';
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Enter valid start and end dates.';
    if (start > end) return 'Start must be before end.';
    return null;
  }, [mode, from, to]);

  const load = useCallback(async () => {
    void reloadToken;
    if (devices.length === 0) {
      setSeries([]);
      setError(null);
      return;
    }
    if (rangeError) {
      setSeries([]);
      setError(rangeError);
      return;
    }

    const request = ++requestRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const options = mode === 'period' ? { period } : { from, to };
      const loaded = await Promise.all(
        devices.map(async (device) => {
          const response = await api.devices.getDataPoints(device.serial, options);
          return {
            serial: device.serial,
            name: deviceLabel(device),
            points: response.dataPoints,
          };
        }),
      );
      if (request !== requestRef.current) return;
      setSeries(loaded);
    } catch (err) {
      if (request !== requestRef.current) return;
      setSeries([]);
      setError(err instanceof Error ? err.message : 'Failed to load location history');
    } finally {
      if (request === requestRef.current) setIsLoading(false);
    }
  }, [devices, from, mode, period, rangeError, reloadToken, to]);

  useEffect(() => {
    // Telemetry must be requested when the history tab opens or its controls change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const activeMetric = HISTORY_METRICS.find((entry) => entry.value === metric) ?? HISTORY_METRICS[0];
  const totalPoints = series.reduce((sum, entry) => sum + entry.points.length, 0);

  const chartData = useMemo<LineGraphData>(() => ({
    datasets: series.map((entry, index) => {
      const style = HISTORY_LINE_STYLES[index % HISTORY_LINE_STYLES.length]!;
      return {
        label: `${entry.name} (#${entry.serial})`,
        data: entry.points
          .map((point) => ({ x: toDate(point.timestamp).getTime(), y: point[metric] }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          .sort((a, b) => a.x - b.x),
        parsing: false,
        normalized: true,
        borderColor: resolveCssColor(style.color),
        backgroundColor: 'transparent',
        borderDash: style.dash,
        pointStyle: style.pointStyle,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
      };
    }),
  }), [series, metric]);

  const chartConfig = useMemo(() => ({
    ...createLineGraphConfig({
      showLegend: true,
      styledLegend: true,
      zoomMinRange: 30_000,
      tooltipCallbacks: {
        title: (items) => {
          const x = items[0]?.parsed?.x;
          return typeof x === 'number' ? formatChartLabel(new Date(x), true) : '';
        },
      },
    }),
    scales: {
      x: {
        type: 'linear' as const,
        display: true,
        border: { display: true },
        grid: { display: true, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: {
          display: true,
          color: resolveCssColor(CHART_COLORS.mutedText),
          maxTicksLimit: 8,
          callback: (value: string | number) => formatChartLabel(new Date(Number(value))),
        },
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        border: { display: true },
        title: { display: true, text: activeMetric.unit, color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { display: true, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: { display: true, color: resolveCssColor(CHART_COLORS.mutedText) },
      },
    },
  }), [activeMetric.unit]);

  return (
    <div className="locations__history">
      <div className="locations__history-controls">
        <Select
          label="Range"
          value={mode}
          options={HISTORY_MODE_OPTIONS}
          onChange={(event) => setMode(event.target.value as HistoryMode)}
        />
        {mode === 'period' ? (
          <Select
            label="Period"
            value={period}
            options={DEVICE_PERIODS.map((value) => ({ value, label: devicePeriodLabel(value) }))}
            onChange={(event) => setPeriod(event.target.value as DevicePeriod)}
          />
        ) : (
          <>
            <Input
              label="From"
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Input
              label="To"
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </>
        )}
        <Select
          label="Metric"
          value={metric}
          options={HISTORY_METRICS.map((entry) => ({ value: entry.value, label: entry.label }))}
          onChange={(event) => setMetric(event.target.value as HistoryMetric)}
        />
        <Button
          variant="secondary"
          onClick={() => setReloadToken((value) => value + 1)}
          disabled={isLoading || devices.length === 0 || Boolean(rangeError)}
        >
          <IconRefresh aria-hidden="true" size={16} strokeWidth={1.75} />
          Reload
        </Button>
      </div>

      <p className="locations__history-note">
        This history reflects the {devices.length} device{devices.length === 1 ? '' : 's'} currently assigned
        to this location. Devices removed from the location previously are not included.
      </p>

      {devices.length === 0 ? (
        <p className="locations__notice">No devices are currently assigned to this location.</p>
      ) : rangeError ? (
        <div className="locations__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{rangeError}</span>
        </div>
      ) : isLoading ? (
        <p className="locations__notice">Loading location history...</p>
      ) : error ? (
        <div className="locations__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{error}</span>
          <Button variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : totalPoints === 0 ? (
        <p className="locations__notice">No telemetry data for the selected range.</p>
      ) : (
        <>
          <div className="locations__history-graph">
            <LineGraph data={chartData} config={chartConfig} />
          </div>
          <ul className="locations__history-summary">
            {series.map((entry) => (
              <li key={entry.serial}>
                <span className="locations__device-name">{entry.name}</span>
                <span className="locations__device-serial">#{entry.serial} · {entry.points.length} points</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

type Props = {
  onDeviceNavigate: (serial: number) => void;
  onNavigate: (target: DashboardTarget) => void;
  locationRoute?: LocationRouteState | null;
};

export const LocationsPanel = ({ onDeviceNavigate, onNavigate, locationRoute }: Props) => {
  const [locations, setLocations] = useState<Location[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [locationPage, setLocationPage] = useState(1);
  const [locationDevicePage, setLocationDevicePage] = useState(1);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LocationFilter>('all');
  const [sort, setSort] = useState<LocationSort>('name');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // A stale location deep link falls back to the canonical plain locations route.
  useEffect(() => {
    if (!isLoading && locationRoute && !locations.some((location) => location.id === locationRoute.id)) {
      onNavigate({ tab: 'locations' });
    }
  }, [isLoading, locationRoute, locations, onNavigate]);

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedId) ?? null,
    [locations, selectedId],
  );

  const locationDevices = useMemo(
    () => devices.filter((device) => device.locationId === selectedId),
    [devices, selectedId],
  );

  const locationStatsById = useMemo(() => {
    const stats = new Map<string, LocationStats>();
    for (const device of devices) {
      if (!device.locationId) continue;
      const entry = stats.get(device.locationId) ?? { deviceCount: 0, onlineCount: 0, lastActive: 0 };
      entry.deviceCount += 1;
      if (isOnline(device)) entry.onlineCount += 1;
      const timestamps = [device.lastUploadAt, device.latestDataPoint?.timestamp]
        .filter((value): value is Date => Boolean(value))
        .map((value) => toDate(value).getTime())
        .filter((value) => Number.isFinite(value));
      if (timestamps.length > 0) entry.lastActive = Math.max(entry.lastActive, ...timestamps);
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
      const aStats = locationStatsById.get(a.id) ?? EMPTY_LOCATION_STATS;
      const bStats = locationStatsById.get(b.id) ?? EMPTY_LOCATION_STATS;
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
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
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
    setError(null);
    try {
      const created = await api.locations.create(name);
      setLocations((current) => [...current, created]);
      setCreateName('');
      setIsCreateOpen(false);
      onNavigate({ tab: 'locations', location: { id: created.id, detailTab: 'overview' } });
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
    setIsDeleting(true);
    setError(null);
    try {
      await api.locations.remove(selectedLocation.id);
      const remaining = locations.filter((location) => location.id !== selectedLocation.id);
      setLocations(remaining);
      setIsDeleteOpen(false);
      onNavigate({ tab: 'locations' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete location');
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
              const cardStats = locationStatsById.get(location.id) ?? EMPTY_LOCATION_STATS;
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

        {detailTab === 'history' && selectedLocation && (
          <LocationHistory key={selectedLocation.id} devices={locationDevices} />
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
