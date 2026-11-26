import type React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDroplet,
  IconExternalLink,
  IconFileDownload,
  IconGauge,
  IconMapPin,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconSearch,
  IconThermometer,
  IconTrash,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDuration, getPlanFeaturesForUser, type CreditBalance, type DataPoint, type DeviceSummary, type DeviceUptime } from '@common';
import { api } from '../../lib/api';
import { useDevicesMine } from '../../lib/query/hooks/useDevices';
import { useLocationsMine } from '../../lib/query/hooks/useLocations';
import { queryKeys } from '../../lib/query';
import { STORAGE_KEYS, readStorage, writeStorage } from '../../lib/storage';
import { toDate } from '../../lib/date';
import { formatDeviceRelativeTime, isDeviceOnline } from '../../lib/deviceActivity';
import { Button, Card, ConfirmDialog, createTabKeyDownHandler, Input, Pagination, Select, ToggleDropdown, Tooltip } from '../common';
import { LineGraph } from '../graphs';
import type { LineGraphScale } from '../graphs/types';
import { SERIES_DEFINITIONS, type SeriesId, useEnabledSeries, getSeriesDefinition } from '../../lib/series';
import { DEVICE_PERIODS, type DevicePeriod } from '../../lib/devicePeriod';
import { EXTERNAL_URLS } from '../../lib/externalUrls';
import { CHART_COLORS, createLineGraphConfig, resolveCssColor } from '../../lib/chartTheme';
import type { DashboardTarget, DeviceDetailTab, DeviceRouteState } from '../../lib/dashboardRoutes';
import { DeviceExportModal } from './DeviceExportModal';
import { DataFillModal } from './DataFillModal';
import { ForecastTab } from './ForecastTab';
import { AlertsTab, type AlertFormRoute } from './AlertsTab';
import { TokensTab } from './TokensTab';
import { DeviceLogsTab } from './DeviceLogsTab';
import '../common/Tabs.css';
import './DevicesPanel.css';

const PAGE_SIZE = 5;

function formatChartLabel(value: Date | string, period: string, withYear = false): string {
  const d = toDate(value);
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = d.toLocaleDateString(
    'en-GB',
    withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' },
  );
  // Short periods only show the time on the axis, but the tooltip always
  // includes the full date (with year) so the exact point is unambiguous.
  if ((period === '1h' || period === '24h') && !withYear) {
    return time;
  }
  return `${date} ${time}`;
}

/** Break lines wherever consecutive samples are further apart than 10x the median
 * sample interval, so real outages show up as gaps instead of straight lines. */
function computeGapThreshold(points: DataPoint[]): number | undefined {
  if (points.length < 3) return undefined;
  const times = points
    .map((p) => toDate(p.timestamp).getTime())
    .sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const delta = times[i] - times[i - 1];
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return undefined;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  return median * 10;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

const GRAPH_INITIAL_WINDOW_MS = 10 * 60 * 1000;
const GRAPH_MAX_ZOOM_IN_MS = 30 * 1000;
const GRAPH_ZOOM_OUT_PADDING = 0.02;
const GRAPH_INITIAL_HEADROOM = 0.1;

type GraphWindow = {
  initialMin: number;
  initialMax: number;
  limitMin: number;
  limitMax: number;
};

function computeGraphWindow(points: DataPoint[], period: Period = '24h'): GraphWindow | null {
  if (points.length === 0) return null;
  const times = points.map((p) => toDate(p.timestamp).getTime()).sort((a, b) => a - b);
  const extentMin = times[0];
  const extentMax = times[times.length - 1];

  if (extentMax <= extentMin) {
    return {
      initialMin: extentMax - GRAPH_INITIAL_WINDOW_MS / 2,
      initialMax: extentMax + GRAPH_INITIAL_WINDOW_MS / 2,
      limitMin: extentMax - GRAPH_INITIAL_WINDOW_MS,
      limitMax: extentMax + GRAPH_INITIAL_WINDOW_MS,
    };
  }

  const padding = (extentMax - extentMin) * GRAPH_ZOOM_OUT_PADDING;

  // 'all' time: start zoomed to the most recent 30 days, but allow panning/
  // zooming out to the entire available range.
  let initialMin: number;
  let initialMax: number;
  if (period === 'all') {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    initialMin = Math.max(extentMin, extentMax - thirtyDays);
    initialMax = extentMax + (extentMax - initialMin) * GRAPH_INITIAL_HEADROOM;
  } else {
    // Fixed periods: show the whole selected range.
    initialMin = extentMin;
    initialMax = extentMax + (extentMax - extentMin) * GRAPH_INITIAL_HEADROOM;
  }

  initialMin = Math.max(initialMin, extentMin);
  initialMin = Math.min(initialMin, extentMax - GRAPH_MAX_ZOOM_IN_MS);

  return {
    initialMin,
    initialMax,
    limitMin: extentMin - padding,
    limitMax: Math.max(extentMax + padding, initialMax),
  };
}

function TelemetryChips({ reading }: Readonly<{ reading: DataPoint | null }>) {
  if (!reading) {
    return <span className="devices__no-data">No telemetry data recorded</span>;
  }

  return (
    <div className="devices__telemetry-chips">
      <div className="devices__telemetry-chip">
        <IconThermometer aria-hidden="true" size={14} strokeWidth={2} />
        <span>{reading.temperature.toFixed(1)} °C</span>
      </div>
      <div className="devices__telemetry-chip">
        <IconDroplet aria-hidden="true" size={14} strokeWidth={2} />
        <span>{reading.humidity.toFixed(1)} %</span>
      </div>
      <div className="devices__telemetry-chip">
        <IconGauge aria-hidden="true" size={14} strokeWidth={2} />
        <span>{reading.airPressure.toFixed(0)} hPa</span>
      </div>
    </div>
  );
}

type Period = DevicePeriod;
const GRAPH_MODES = ['combined', 'separate', 'summary'] as const;
type GraphMode = (typeof GRAPH_MODES)[number];
type DetailTab = DeviceDetailTab;

function getStoredPeriod(): Period {
  try {
    const raw = readStorage(STORAGE_KEYS.devicePeriod, 'local');
    return DEVICE_PERIODS.find((period) => period === raw) ?? '24h';
  } catch {
    return '24h';
  }
}

function getStoredGraphMode(): GraphMode {
  try {
    const raw = readStorage(STORAGE_KEYS.deviceGraphMode, 'local');
    return GRAPH_MODES.find((mode) => mode === raw) ?? 'combined';
  } catch {
    return 'combined';
  }
}
const DETAIL_TABS: readonly DetailTab[] = ['graphs', 'forecasts', 'alerts', 'tokens', 'logs', 'settings'];
type Props = {
  activeDevice?: DeviceRouteState | null;
  onNavigate?: (target: string | DashboardTarget) => void;
  credits?: CreditBalance | null;
  onCreditsChange?: (credits: CreditBalance) => void;
};



function createMetricConfig(
  unit: string,
  showAxes: boolean,
  showXAxis: boolean,
  showLegend: boolean,
  showGrid: boolean,
  period: Period,
  zoomWindow: GraphWindow | null,
) {
  return {
    ...createLineGraphConfig({
      showLegend,
      zoomMinRange: GRAPH_MAX_ZOOM_IN_MS,
      zoomWindow,
      tooltipCallbacks: {
        title: (items) => {
          const x = items[0]?.parsed?.x;
          return typeof x === 'number' ? formatChartLabel(new Date(x), period, true) : '';
        },
      },
    }),
    scales: {
      x: {
        type: 'linear' as const,
        display: true,
        ...(zoomWindow ? { min: zoomWindow.initialMin, max: zoomWindow.initialMax } : {}),
        border: { display: showXAxis },
        grid: { display: showGrid, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: {
          display: showXAxis,
          color: resolveCssColor(CHART_COLORS.mutedText),
          maxTicksLimit: 8,
          callback: (value: string | number) => formatChartLabel(new Date(Number(value)), period),
        },
      },
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        border: { display: showAxes },
        title: { display: showAxes, text: unit, color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { display: showGrid, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: { display: showAxes, color: resolveCssColor(CHART_COLORS.mutedText) },
      },
    },
  };
}

export const DevicesPanel = ({ activeDevice = null, onNavigate, credits: initialCredits = null, onCreditsChange }: Props) => {
  const queryClient = useQueryClient();
  const devicesQuery = useDevicesMine();
  const locationsQuery = useLocationsMine();
  const meQuery = useQuery({ queryKey: queryKeys.bootstrap(), queryFn: () => api.users.me() });
  const [devicePage, setDevicePage] = useState(1);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceLocationFilter, setDeviceLocationFilter] = useState('');
  const [deviceOnlineFilter, setDeviceOnlineFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [deviceSort, setDeviceSort] = useState<'name' | 'serial' | 'lastUpload' | 'dataPoints'>('name');
  const selectedSerial = activeDevice?.serial ?? null;
  const view: 'list' | 'detail' = selectedSerial === null ? 'list' : 'detail';
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isDataFillOpen, setIsDataFillOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditsOverride, setCreditsOverride] = useState<CreditBalance | null>(initialCredits);

  const devices = devicesQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const user = meQuery.data?.user ?? null;
  const credits = creditsOverride ?? meQuery.data?.credits ?? null;
  const planFeatures = user ? getPlanFeaturesForUser(user) : null;
  const canUseAlertsAndWebhooks = planFeatures?.alertsAndWebhooks ?? false;
  const maxDevices = planFeatures?.maxDevices ?? null;
  const requestedDetailTab: DetailTab = activeDevice?.detailTab ?? 'graphs';
  const detailTab: DetailTab = requestedDetailTab === 'alerts' && !canUseAlertsAndWebhooks
    ? 'graphs'
    : requestedDetailTab;
  const detailTabIdPrefix = useId();
  const visibleDetailTabs = DETAIL_TABS.filter((tab) => tab !== 'alerts' || canUseAlertsAndWebhooks);
  const atDeviceLimit = maxDevices !== null && devices.length >= maxDevices;

  // Telemetry graph state
  const [period, setPeriod] = useState<Period>(getStoredPeriod);
  const [graphMode, setGraphMode] = useState<GraphMode>(getStoredGraphMode);
  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);
  const { enabled: enabledSeries, setEnabled: setEnabledSeries } = useEnabledSeries();


  const [showAxes, setShowAxes] = useState<boolean>(() => {
    try {
      const raw = readStorage(STORAGE_KEYS.deviceShowAxes, 'local');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const [showXAxis, setShowXAxis] = useState<boolean>(() => {
    try {
      const raw = readStorage(STORAGE_KEYS.deviceShowXAxis, 'local');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const [showLegend, setShowLegend] = useState<boolean>(() => {
    try {
      const raw = readStorage(STORAGE_KEYS.deviceShowLegend, 'local');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const [showGrid, setShowGrid] = useState<boolean>(() => {
    try {
      const raw = readStorage(STORAGE_KEYS.deviceShowGrid, 'local');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.deviceShowAxes, String(showAxes), 'local');
    } catch {
      // ignore
    }
  }, [showAxes]);
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.deviceShowXAxis, String(showXAxis), 'local');
    } catch {
      // ignore
    }
  }, [showXAxis]);
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.deviceShowLegend, String(showLegend), 'local');
    } catch {
      // ignore
    }
  }, [showLegend]);
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.deviceShowGrid, String(showGrid), 'local');
    } catch {
      // ignore
    }
  }, [showGrid]);
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.devicePeriod, period, 'local');
    } catch {
      // ignore
    }
  }, [period]);
  useEffect(() => {
    try {
      writeStorage(STORAGE_KEYS.deviceGraphMode, graphMode, 'local');
    } catch {
      // ignore
    }
  }, [graphMode]);

  // Handle fullscreen graph overlay: escape to close and prevent background scrolling
  useEffect(() => {
    if (!isGraphFullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsGraphFullscreen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGraphFullscreen]);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [uptime, setUptime] = useState<DeviceUptime | null>(null);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Device settings state
  const [settingsName, setSettingsName] = useState('');
  const [settingsLocationId, setSettingsLocationId] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isUnlinkOpen, setIsUnlinkOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.devicesMine() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.locationsMine() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap() }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    }
  }, [queryClient]);

  const effectiveIsLoading = !devicesQuery.data && devicesQuery.isPending;

  const selectedDevice = useMemo(
    () => devices.find((d) => d.serial === selectedSerial) ?? null,
    [devices, selectedSerial],
  );

  const selectedLocation = useMemo(() => {
    if (!selectedDevice?.locationId) return null;
    return locations.find((l) => l.id === selectedDevice.locationId) ?? null;
  }, [locations, selectedDevice]);

  const canManageAlerts = user ? !user.teamId || user.teamRole === 'manager' : false;
  const canOpenIntegrations = Boolean(user && user.teamId && canUseAlertsAndWebhooks);

  const updateDeviceRoute = (patch: Partial<DeviceRouteState>) => {
    if (!activeDevice) return;
    onNavigate?.({ tab: 'devices', device: { ...activeDevice, ...patch } });
  };

  const selectDetailTab = (tab: DetailTab) => updateDeviceRoute({
    detailTab: tab,
    alertId: undefined,
    alertAction: undefined,
  });
  const handleDetailTabsKeyDown = createTabKeyDownHandler<DetailTab>(selectDetailTab);

  const closeDevice = () => {
    onNavigate?.({ tab: 'devices' });
  };

  const filteredDevices = useMemo(() => {
    const needle = deviceSearch.trim().toLowerCase();
    const result = devices.filter((device) => {
      if (needle) {
        const locationName = locations.find((location) => location.id === device.locationId)?.name ?? '';
        const haystack = [
          deviceLabel(device),
          String(device.serial),
          locationName,
          device.ownerUsername,
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (deviceLocationFilter === '__none__' && device.locationId) return false;
      if (deviceLocationFilter && deviceLocationFilter !== '__none__' && device.locationId !== deviceLocationFilter) return false;
      if (deviceOnlineFilter !== 'all' && isDeviceOnline(device) !== (deviceOnlineFilter === 'online')) return false;
      return true;
    });

    result.sort((a, b) => {
      switch (deviceSort) {
        case 'serial':
          return a.serial - b.serial;
        case 'lastUpload': {
          const left = a.lastUploadAt ? toDate(a.lastUploadAt).getTime() : 0;
          const right = b.lastUploadAt ? toDate(b.lastUploadAt).getTime() : 0;
          return right - left || a.serial - b.serial;
        }
        case 'dataPoints':
          return b.dataPointCount - a.dataPointCount || a.serial - b.serial;
        case 'name':
        default:
          return deviceLabel(a).localeCompare(deviceLabel(b)) || a.serial - b.serial;
      }
    });

    return result;
  }, [devices, locations, deviceSearch, deviceLocationFilter, deviceOnlineFilter, deviceSort]);

  const hasDeviceFilters = Boolean(deviceSearch.trim()) || Boolean(deviceLocationFilter)
    || deviceOnlineFilter !== 'all' || deviceSort !== 'name';

  const clearDeviceFilters = () => {
    setDeviceSearch('');
    setDeviceLocationFilter('');
    setDeviceOnlineFilter('all');
    setDeviceSort('name');
    setDevicePage(1);
  };

  const deviceTotalPages = Math.max(1, Math.ceil(filteredDevices.length / PAGE_SIZE));
  const currentDevicePage = Math.min(devicePage, deviceTotalPages);
  const visibleDevices = useMemo(
    () => filteredDevices.slice((currentDevicePage - 1) * PAGE_SIZE, currentDevicePage * PAGE_SIZE),
    [currentDevicePage, filteredDevices],
  );

  // Sync settings form fields when selected device changes
  useEffect(() => {
    if (!selectedDevice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettingsName(selectedDevice.name?.trim() || '');
    setSettingsLocationId(selectedDevice.locationId || '');
    setSaveSuccess(false);
    setHasLoadedInitialData(false);
  }, [selectedDevice]);

  // Load telemetry data points when a device is selected and tab is 'graphs'
  useEffect(() => {
    if (!selectedDevice || view !== 'detail' || selectedSerial === null || detailTab !== 'graphs') return;
    let cancelled = false;

    const run = async () => {
      setIsFetchingData(true);
      setDataError(null);
      try {
        const res = await api.devices.getDataPoints(selectedSerial, { period });
        if (!cancelled) {
          setDataPoints(res.dataPoints);
          setHasLoadedInitialData(true);
        }
      } catch (err) {
        if (!cancelled) {
          setDataError(err instanceof Error ? err.message : 'Failed to load telemetry data');
        }
      } finally {
        if (!cancelled) {
          setIsFetchingData(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedDevice, view, selectedSerial, detailTab, period]);

  // Current reporting streak, shown instead of "last seen" while the device is online.
  useEffect(() => {
    if (!selectedDevice || view !== 'detail' || selectedSerial === null) return;
    let cancelled = false;
    void api.devices.getUptime(selectedSerial)
      .then((value) => { if (!cancelled) setUptime(value); })
      .catch(() => { if (!cancelled) setUptime(null); });
    return () => { cancelled = true; };
  }, [selectedDevice, view, selectedSerial]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAll();
    if (selectedDevice && selectedSerial !== null) {
      try {
        setUptime(await api.devices.getUptime(selectedSerial));
      } catch {
        // Keep the last known uptime if the refresh fails.
      }
    }
    if (selectedSerial !== null && detailTab === 'graphs') {
      try {
        const res = await api.devices.getDataPoints(selectedSerial, { period });
        setDataPoints(res.dataPoints);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : 'Failed to load telemetry data');
      }
    }
    setIsRefreshing(false);
  };

  const handleSelectDevice = (device: DeviceSummary) => {
    setIsExportOpen(false);
    onNavigate?.({ tab: 'devices', device: { serial: device.serial, detailTab: 'graphs' } });
  };












  const handleSaveSettings = async () => {
    if (!selectedDevice) return;
    setIsSavingSettings(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const updated = await api.devices.update(selectedDevice.serial, {
        name: settingsName.trim() || undefined,
        locationId: settingsLocationId || undefined,
      });
      queryClient.setQueryData<DeviceSummary[]>(queryKeys.devicesMine(), (current = []) =>
        current.map((d) => (d.serial === updated.serial ? { ...d, ...updated } : d)),
      );
      setSaveSuccess(true);
      if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
      saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update device settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleUnlink = async () => {
    if (!selectedDevice) return;
    setIsUnlinking(true);
    setError(null);
    try {
      await api.devices.unlink(selectedDevice.serial);
      queryClient.setQueryData<DeviceSummary[]>(queryKeys.devicesMine(), (current = []) => current.filter((d) => d.serial !== selectedDevice.serial));
      setIsUnlinkOpen(false);
      closeDevice();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink device');
    } finally {
      setIsUnlinking(false);
    }
  };

  // Enabled series definitions (resolved)
  const enabledDefs = useMemo(
    () =>
      enabledSeries
        .map((id) => getSeriesDefinition(id))
        .filter((d): d is NonNullable<ReturnType<typeof getSeriesDefinition>> => Boolean(d)),
    [enabledSeries],
  );

  const seriesLabels = SERIES_DEFINITIONS.map((s) => s.label);
  const enabledLabels = enabledSeries
    .map((id) => getSeriesDefinition(id)?.label)
    .filter((l): l is string => Boolean(l));

  const handleSeriesChange = (labels: string[]) => {
    const ids = labels
      .map((label) => SERIES_DEFINITIONS.find((s) => s.label === label)?.id)
      .filter((id): id is SeriesId => Boolean(id));
    setEnabledSeries(ids);
  };

  const precisionFor = (def: (typeof enabledDefs)[number]) => {
    if (def.id === 'pressure') return 0;
    if (def.unit === '°C' || def.unit === '%') return 1;
    if (def.unit === 'hPa') return 1;
    return 2;
  };

  // Metrics summary statistics for the period
  const seriesStats = useMemo(() => {
    if (dataPoints.length === 0 || enabledDefs.length === 0) return [];
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return enabledDefs.map((def) => {
      const values = dataPoints.map((p) => def.getValue(p));
      return {
        def,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: avg(values),
        count: dataPoints.length,
      };
    });
  }, [dataPoints, enabledDefs]);

  // Unit grouping for combined chart axes
  const unitGroups = useMemo(() => Array.from(new Set(enabledDefs.map((d) => d.unit))), [enabledDefs]);

  const unitToScaleId = useMemo(() => {
    const map = new Map<string, string>();
    unitGroups.forEach((unit, i) => {
      map.set(unit, i === 0 ? 'y' : `y${i}`);
    });
    return map;
  }, [unitGroups]);

  // Combined chart config & data
  const gapThreshold = useMemo(() => computeGapThreshold(dataPoints), [dataPoints]);
  const graphWindow = useMemo(() => computeGraphWindow(dataPoints, period), [dataPoints, period]);

  const combinedData = useMemo(() => {
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    return {
      datasets: enabledDefs.map((def) => ({
        label: def.label,
        data: dataPoints.map((p) => ({
          x: toDate(p.timestamp).getTime(),
          y: def.getValue(p),
        })),
        parsing: false,
        normalized: true,
        spanGaps: gapThreshold,
        borderColor: resolveCssColor(def.color),
        backgroundColor: 'transparent',
        yAxisID: unitToScaleId.get(def.unit) ?? 'y',
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: def.dash,
        pointStyle: def.pointStyle,
        pointRadius,
        pointHoverRadius: 4,
      })),
    };
  }, [dataPoints, enabledDefs, unitToScaleId, gapThreshold]);



  const combinedConfig = useMemo(() => {
    const scales: Record<string, LineGraphScale> = {
      x: {
        type: 'linear',
        display: true,
        ...(graphWindow ? { min: graphWindow.initialMin, max: graphWindow.initialMax } : {}),
        border: { display: showXAxis },
        grid: { display: showGrid, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: {
          display: showXAxis,
          color: resolveCssColor(CHART_COLORS.mutedText),
          maxTicksLimit: 8,
          callback: (value: string | number) => formatChartLabel(new Date(Number(value)), period),
        },
      },
    };
    unitGroups.forEach((unit, i) => {
      const id = i === 0 ? 'y' : `y${i}`;
      scales[id] = {
        type: 'linear',
        display: true,
        position: i === 0 ? 'left' : 'right',
        border: { display: showAxes },
        title: { display: showAxes, text: unit, color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: i === 0
          ? { display: showGrid, color: resolveCssColor(CHART_COLORS.grid) }
          : { drawOnChartArea: false },
        ticks: { display: showAxes, color: resolveCssColor(CHART_COLORS.mutedText) },
      };
    });
    if (unitGroups.length === 0) {
      scales.y = {
        type: 'linear',
        display: true,
        position: 'left',
        border: { display: showAxes },
        title: { display: showAxes, text: '', color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { display: showGrid, color: resolveCssColor(CHART_COLORS.grid) },
        ticks: { display: showAxes, color: resolveCssColor(CHART_COLORS.mutedText) },
      };
    }
    return {
      ...createLineGraphConfig({
        showLegend,
        styledLegend: true,
        zoomMinRange: GRAPH_MAX_ZOOM_IN_MS,
        zoomWindow: graphWindow,
        tooltipCallbacks: {
          title: (items) => {
            const x = items[0]?.parsed?.x;
            return typeof x === 'number' ? formatChartLabel(new Date(x), period, true) : '';
          },
        },
      }),
      scales,
    };
  }, [unitGroups, showAxes, showXAxis, showLegend, showGrid, period, graphWindow]);

  const separateCharts = useMemo(
    () =>
      enabledDefs.map((def) => ({
        def,
        data: {
          datasets: [
            {
              label: def.label,
              data: dataPoints.map((p) => ({
                x: toDate(p.timestamp).getTime(),
                y: def.getValue(p),
              })),
              parsing: false,
              normalized: true,
              spanGaps: gapThreshold,
              borderColor: resolveCssColor(def.color),
              backgroundColor: 'transparent',
              tension: 0.25,
              fill: false,
              borderWidth: 2,
              borderDash: def.dash,
              pointStyle: def.pointStyle,
              pointRadius: dataPoints.length > 80 ? 0 : 2,
              pointHoverRadius: 4,
            },
          ],
        },
        config: createMetricConfig(def.unit, showAxes, showXAxis, showLegend, showGrid, period, graphWindow),
      })),
    [dataPoints, period, enabledDefs, showAxes, showXAxis, showLegend, showGrid, gapThreshold, graphWindow],
  );

  if (effectiveIsLoading) {
    return <p className="devices__notice">Loading devices...</p>;
  }

  // A deep link to an unknown/unshared device must not silently fall back to the list.
  if (view === 'detail' && selectedSerial !== null && !selectedDevice) {
    return (
      <div className="devices">
        <div className="devices__empty devices__empty--not-found">
          <IconAlertCircle aria-hidden="true" size={28} strokeWidth={1.5} />
          <h3>Device not found or not shared with your team</h3>
          <p>The device may have been unlinked, or it is no longer shared with your team.</p>
          <Button variant="secondary" onClick={closeDevice}>
            <IconArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
            Back to devices
          </Button>
        </div>
      </div>
    );
  }

  // LIST VIEW (the detail-with-missing-device case is handled above)
  if (view === 'list' || !selectedDevice) {
    return (
      <div className="devices">
        <div className="devices__toolbar">
          <div className="devices__actions">
            <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
              <IconRefresh aria-hidden="true" size={16} strokeWidth={1.75} />
              Refresh
            </Button>
            <Button
              variant="primary"
              onClick={() => window.open(EXTERNAL_URLS.link, '_blank', 'noopener,noreferrer')}
            >
              <IconExternalLink aria-hidden="true" size={16} strokeWidth={1.75} />
              Add device
            </Button>
          </div>
        </div>

        {devices.length > 0 && (
          <div className="devices__filters">
            <div className="devices__filter-search">
              <IconSearch aria-hidden="true" size={16} strokeWidth={1.8} />
              <Input
                type="search"
                value={deviceSearch}
                onChange={(event) => {
                  setDeviceSearch(event.target.value);
                  setDevicePage(1);
                }}
                placeholder="Search by name, serial, location or owner"
                aria-label="Search devices"
              />
            </div>
            <Select
              value={deviceLocationFilter}
              onChange={(event) => {
                setDeviceLocationFilter(event.target.value);
                setDevicePage(1);
              }}
              aria-label="Filter by location"
              options={[
                { value: '', label: 'All locations' },
                ...locations.map((location) => ({ value: location.id, label: location.name })),
                { value: '__none__', label: 'Unassigned' },
              ]}
            />
            <Select
              value={deviceOnlineFilter}
              onChange={(event) => {
                setDeviceOnlineFilter(event.target.value as 'all' | 'online' | 'offline');
                setDevicePage(1);
              }}
              aria-label="Filter by connection status"
              options={[
                { value: 'all', label: 'All devices' },
                { value: 'online', label: 'Online' },
                { value: 'offline', label: 'Offline' },
              ]}
            />
            <Select
              value={deviceSort}
              onChange={(event) => {
                setDeviceSort(event.target.value as 'name' | 'serial' | 'lastUpload' | 'dataPoints');
                setDevicePage(1);
              }}
              aria-label="Sort devices"
              options={[
                { value: 'name', label: 'Sort: Name' },
                { value: 'serial', label: 'Sort: Serial' },
                { value: 'lastUpload', label: 'Sort: Last upload' },
                { value: 'dataPoints', label: 'Sort: Data points' },
              ]}
            />
            {hasDeviceFilters && (
              <Button variant="secondary" onClick={clearDeviceFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}

        {maxDevices !== null && (
          <p className="devices__limit">
            Devices: {devices.length} / {maxDevices.toLocaleString()}
            {atDeviceLimit && <span className="devices__limit-warning"> Device limit reached.</span>}
          </p>
        )}

        {error && (
          <div className="devices__error" role="alert">
            <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
            <span>{error}</span>
          </div>
        )}

        {devices.length === 0 ? (
          <div className="devices__empty">
            <IconDatabase aria-hidden="true" size={28} strokeWidth={1.5} />
            <h3>No devices yet</h3>
            <p>Use &quot;Add device&quot; to open ayphr.com/link and enter the code shown on your device.</p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="devices__empty">
            <IconSearch aria-hidden="true" size={28} strokeWidth={1.5} />
            <h3>No devices match your filters</h3>
            <p>Try a different search term or clear the filters to see all devices.</p>
            <Button variant="secondary" onClick={clearDeviceFilters}>Clear filters</Button>
          </div>
        ) : (
          <div className="devices__grid">
            {visibleDevices.map((device) => {
              const deviceLoc = locations.find((l) => l.id === device.locationId);
              const online = isDeviceOnline(device);
              const reading = device.latestDataPoint;

              return (
                <Card
                  key={device.serial}
                  elevated
                  className="devices__card"
                  onClick={() => handleSelectDevice(device)} role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectDevice(device); } }}
                >
                  <div className="devices__card-header">
                    <div className="devices__card-title-group">
                      <span className="devices__card-name">{deviceLabel(device)}</span>
                      {device.name?.trim() && (
                        <Tooltip content={`Device serial number: ${device.serial}`}><span className="devices__serial-pill">#{device.serial}</span></Tooltip>
                      )}
                    </div>
                    <Tooltip content={online ? 'Online' : 'Offline'}>
                      <span
                        className={`devices__connection-icon ${online ? 'is-online' : 'is-offline'}`}
                        aria-label={online ? 'Online' : 'Offline'}
                      >
                        {online ? <IconWifi aria-hidden="true" size={18} strokeWidth={1.75} /> : <IconWifiOff aria-hidden="true" size={18} strokeWidth={1.75} />}
                      </span>
                    </Tooltip>
                  </div>

                  <div className="devices__card-telemetry">
                    <TelemetryChips reading={reading} />
                  </div>

                  <div className="devices__card-footer">
                    <span className="devices__card-location">
                      <IconMapPin aria-hidden="true" size={13} strokeWidth={1.75} />
                      {deviceLoc ? deviceLoc.name : 'Unassigned location'}
                    </span>
                    <span className="devices__card-lastseen">
                      <IconClock aria-hidden="true" size={13} strokeWidth={1.75} />
                      {formatDeviceRelativeTime(device.lastUploadAt)}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        <Pagination page={currentDevicePage} totalPages={deviceTotalPages} onPageChange={setDevicePage} disabled={isRefreshing} />
      </div>
    );
  }

  // DETAIL VIEW
  const online = isDeviceOnline(selectedDevice);
  const latest = selectedDevice.latestDataPoint;
  const canFullscreenGraph =
    detailTab === 'forecasts' ||
    (detailTab === 'graphs' && dataPoints.length > 0 && enabledDefs.length > 0 && graphMode !== 'summary');

  return (
    <div className="devices devices--detail">
      {error && (
        <div className="devices__error" role="alert">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      <div className="devices__toolbar">
        <Button
          variant="secondary"
          onClick={() => {
            setIsExportOpen(false);
            closeDevice();
          }}
        >
          <IconArrowLeft aria-hidden="true" size={16} strokeWidth={1.75} />
          Back to devices
        </Button>
        <div className="devices__actions">
          {(detailTab === 'graphs' || detailTab === 'forecasts') && (
            <Tooltip content={isGraphFullscreen ? 'Exit fullscreen' : 'View graph fullscreen'}>
              <button
                type="button"
                className="devices__fullscreen-btn"
                onClick={() => setIsGraphFullscreen((current) => !current)}
                disabled={!canFullscreenGraph}
                aria-label={isGraphFullscreen ? 'Exit fullscreen' : 'View graph fullscreen'}
                aria-pressed={isGraphFullscreen}
              >
                {isGraphFullscreen ? (
                  <IconMinimize aria-hidden="true" size={18} strokeWidth={1.75} />
                ) : (
                  <IconMaximize aria-hidden="true" size={18} strokeWidth={1.75} />
                )}
              </button>
            </Tooltip>
          )}
          {detailTab !== 'forecasts' && detailTab !== 'settings' && detailTab !== 'alerts' && detailTab !== 'tokens' && detailTab !== 'logs' && (
            <Button variant="secondary" onClick={() => setIsDataFillOpen(true)}>
              <IconDatabase aria-hidden="true" size={16} strokeWidth={1.75} />
              Data fill
            </Button>
          )}
          {detailTab !== 'alerts' && detailTab !== 'tokens' && detailTab !== 'logs' && (
            <Button variant="secondary" onClick={() => setIsExportOpen(true)}>
              <IconFileDownload aria-hidden="true" size={16} strokeWidth={1.75} />
              Export
            </Button>
          )}
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh aria-hidden="true" size={16} strokeWidth={1.75} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="devices__detail-header">
        <div className="devices__title-row">
          <div className="devices__title-group">
            <h3 className="devices__detail-title">{deviceLabel(selectedDevice)}</h3>
            <Tooltip content={`Device serial number: ${selectedDevice.serial}`}>
              <span className="devices__serial-pill">#{selectedDevice.serial}</span>
            </Tooltip>
          </div>
          <Tooltip content={online ? 'Online' : 'Offline'}>
            <span
              className={`devices__connection-icon ${online ? 'is-online' : 'is-offline'}`}
              aria-label={online ? 'Online' : 'Offline'}
            >
              {online ? <IconWifi aria-hidden="true" size={18} strokeWidth={1.75} /> : <IconWifiOff aria-hidden="true" size={18} strokeWidth={1.75} />}
            </span>
          </Tooltip>
        </div>

        <div className="devices__detail-data-row">
          <div className="devices__detail-meta">
            <span>
              <IconMapPin aria-hidden="true" size={14} strokeWidth={1.75} />
              {selectedLocation?.name ?? 'No location'}
            </span>
            <span>
              <IconDatabase aria-hidden="true" size={14} strokeWidth={1.75} />
              <span
                style={
                  planFeatures && selectedDevice.dataPointCount > planFeatures.sharedMaxDataPointsPerUser
                    ? { color: 'var(--status-error)' }
                    : undefined
                }
              >
                {selectedDevice.dataPointCount.toLocaleString()}
              </span>{' '}
              data points
            </span>
            <span>
              <IconClock aria-hidden="true" size={14} strokeWidth={1.75} />
              {online
                ? uptime?.online
                  ? `Uptime ${uptime.durationMs < 60_000 ? 'just now' : formatDuration(uptime.durationMs / 1000)}`
                  : 'Online'
                : `Last seen ${formatDeviceRelativeTime(selectedDevice.lastUploadAt)}`}
            </span>
          </div>

          {latest && (
            <div className="devices__detail-telemetry">
              <TelemetryChips reading={latest} />
            </div>
          )}
        </div>
      </div>

      <div className="ui-tabs" role="tablist" aria-label="Device sections" onKeyDown={handleDetailTabsKeyDown}>
        {visibleDetailTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            data-tab-id={tab}
            aria-selected={detailTab === tab}
            aria-controls={`${detailTabIdPrefix}-panel`}
            id={`${detailTabIdPrefix}-tab-${tab}`}
            tabIndex={detailTab === tab ? 0 : -1}
            className={`ui-tab ${detailTab === tab ? 'ui-tab--active' : ''}`}
            onClick={() => selectDetailTab(tab)}
          >
            {tab === 'graphs'
              ? 'Telemetry & Graphs'
              : tab === 'forecasts'
                ? 'Forecasts'
                : tab === 'alerts'
                  ? 'Alerts'
                  : tab === 'tokens'
                    ? 'Tokens'
                    : tab === 'logs'
                      ? 'Logs'
                      : 'Settings'}
          </button>
        ))}
      </div>

      <div
        className="devices__panel-body"
        role="tabpanel"
        id={`${detailTabIdPrefix}-panel`}
        aria-labelledby={`${detailTabIdPrefix}-tab-${detailTab}`}
        tabIndex={0}
      >
        {/* GRAPHS TAB */}
        {detailTab === 'graphs' && (
          <div className="devices__graphs">
            <div className="devices__graphs-controls" onContextMenu={(e) => e.preventDefault()}>
              <div className="devices__period-selector" role="group" aria-label="Time period">
                {DEVICE_PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`devices__control-btn ${period === p ? 'is-active' : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {p === '1h'
                      ? 'Past 1h'
                      : p === '24h'
                        ? 'Past 24h'
                        : p === '7d'
                          ? 'Past 7d'
                          : p === '30d'
                            ? 'Past 30d'
                            : 'All Time'}
                  </button>
                ))}
              </div>

              <div className="devices__series-selector">
                <ToggleDropdown
                  buttonLabel="Series"
                  options={seriesLabels}
                  value={enabledLabels}
                  onChange={handleSeriesChange}
                  placeholder="Series"
                />
              </div>

              <div className="devices__layers-selector">
                <ToggleDropdown
                  buttonLabel="Layers"
                  options={['Y-axis', 'X-axis', 'Legend', 'Grid']}
                  value={[
                    ...(showAxes ? ['Y-axis'] : []),
                    ...(showXAxis ? ['X-axis'] : []),
                    ...(showLegend ? ['Legend'] : []),
                    ...(showGrid ? ['Grid'] : []),
                  ]}
                  onChange={(labels) => {
                    setShowAxes(labels.includes('Y-axis'));
                    setShowXAxis(labels.includes('X-axis'));
                    setShowLegend(labels.includes('Legend'));
                    setShowGrid(labels.includes('Grid'));
                  }}
                  placeholder="Layers"
                />
              </div>

              <div className="devices__mode-selector" role="group" aria-label="Graph display mode">
                <button
                  type="button"
                  className={`devices__control-btn ${graphMode === 'combined' ? 'is-active' : ''}`}
                  onClick={() => setGraphMode('combined')}
                >
                  Combined Graph
                </button>
                <button
                  type="button"
                  className={`devices__control-btn ${graphMode === 'separate' ? 'is-active' : ''}`}
                  onClick={() => setGraphMode('separate')}
                >
                  Separate Graphs
                </button>
                <button
                  type="button"
                  className={`devices__control-btn ${graphMode === 'summary' ? 'is-active' : ''}`}
                  onClick={() => setGraphMode('summary')}
                >
                  Summary
                </button>
              </div>
            </div>

            {dataError && (
              <div className="devices__error" role="alert">
                <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
                <span>{dataError}</span>
              </div>
            )}

            {/* If initial load has not finished yet, show initial placeholder with stable height */}
            {!hasLoadedInitialData && isFetchingData ? (
              <div className="devices__chart-card devices__loading-box">
                <IconRefresh className="devices__spin-icon" size={24} strokeWidth={2} aria-hidden="true" />
                <p>Loading telemetry history...</p>
              </div>
            ) : dataPoints.length === 0 || enabledDefs.length === 0 ? (
              <div className="devices__empty">
                <IconDatabase aria-hidden="true" size={28} strokeWidth={1.5} />
                <h3>{dataPoints.length === 0 ? 'No data points found' : 'No series selected'}</h3>
                <p>
                  {dataPoints.length === 0
                    ? 'No telemetry recorded for this device during the selected time period.'
                    : 'Select at least one series from the Series dropdown to display the graph.'}
                </p>
              </div>
            ) : (
              <div className={`devices__graphs-body ${isFetchingData ? 'is-updating' : ''} ${isGraphFullscreen ? 'is-fullscreen' : ''}`}>
                {seriesStats.length > 0 && graphMode === 'summary' && (
                  <div className="devices__metrics-summary">
                    {seriesStats.map((s) => {
                      const prec = precisionFor(s.def);
                      return (
                        <div className="devices__summary-col" key={s.def.id}>
                          <div className="devices__summary-header">
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                background: s.def.color,
                                display: 'inline-block',
                              }}
                            />
                            <span>{s.def.shortLabel}</span>
                          </div>
                          <div className="devices__summary-metrics">
                            <div>
                              <span className="summary-lbl">Min</span>
                              <span className="summary-val">
                                {s.min.toFixed(prec)} {s.def.unit}
                              </span>
                            </div>
                            <div>
                              <span className="summary-lbl">Max</span>
                              <span className="summary-val">
                                {s.max.toFixed(prec)} {s.def.unit}
                              </span>
                            </div>
                            <div>
                              <span className="summary-lbl">Avg</span>
                              <span className="summary-val">
                                {s.avg.toFixed(prec)} {s.def.unit}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div className="devices__summary-col">
                      <div className="devices__summary-header">
                        <IconCpu aria-hidden="true" size={16} strokeWidth={1.75} />
                        <span>Telemetry Points</span>
                      </div>
                      <div className="devices__summary-metrics">
                        <div>
                          <span className="summary-lbl">Range count</span>
                          <span className="summary-val">{seriesStats[0].count.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {graphMode === 'combined' ? (
                  <div className="devices__chart-card">
                    <div className="devices__chart-container" style={{ position: 'relative' }} onContextMenu={(e) => e.preventDefault()}>
                      <LineGraph key={period} data={combinedData} config={combinedConfig} />

                    </div>
                  </div>
                ) : graphMode === 'separate' ? (
                  <div className="devices__separate-charts">
                    {separateCharts.map(({ def, data, config }) => (
                      <div className="devices__chart-card" key={def.id}>
                        <div className="devices__chart-header">
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: def.color,
                              display: 'inline-block',
                            }}
                          />
                          <h4>{def.label}</h4>
                        </div>
                        <div className="devices__chart-container devices__chart-container--separate" onContextMenu={(e) => e.preventDefault()}>
                          <LineGraph data={data} config={config} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

              </div>
            )}
          </div>
        )}

        {/* FORECASTS TAB */}
        {detailTab === 'forecasts' && selectedDevice && (
          <div className={`devices__graphs-body ${isGraphFullscreen ? 'is-fullscreen' : ''}`}>
            <div className="devices__forecasts">
              <ForecastTab
                serial={selectedDevice.serial}
                locked={!(planFeatures?.forecasts ?? false)}
                onNavigate={onNavigate}
                isFullscreen={isGraphFullscreen}
              />
            </div>
          </div>
        )}

        {/* ALERTS TAB */}
        {detailTab === 'alerts' && canUseAlertsAndWebhooks && selectedDevice && (
          <AlertsTab
            serial={selectedDevice.serial}
            deviceName={deviceLabel(selectedDevice)}
            canManage={canManageAlerts}
            onNavigate={canOpenIntegrations ? onNavigate : undefined}
            route={{ alertId: activeDevice?.alertId, action: activeDevice?.alertAction }}
            onRouteChange={(alertRoute: AlertFormRoute) => updateDeviceRoute({
              detailTab: 'alerts',
              alertId: alertRoute.alertId,
              alertAction: alertRoute.action,
            })}
          />
        )}

        {/* TOKENS TAB */}
        {detailTab === 'tokens' && selectedDevice && (
          <TokensTab
            serial={selectedDevice.serial}
            deviceName={deviceLabel(selectedDevice)}
          />
        )}

        {/* LOGS TAB */}
        {detailTab === 'logs' && selectedDevice && (
          <DeviceLogsTab key={selectedDevice.serial} serial={selectedDevice.serial} />
        )}

        {/* SETTINGS TAB */}
        {detailTab === 'settings' && (
          <div className="devices__settings">
            <div className="devices__settings-section">
              <h4 className="devices__settings-title">Device Details</h4>
              <p className="devices__settings-desc">
                Rename your device or reassign it to a different location.
              </p>

              <label className="devices__field">
                <span className="devices__field-label">Device Name</span>
                <Input
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  placeholder={`Device ${selectedDevice.serial}`}
                  aria-label="Device name"
                />
              </label>

              {locations.length > 0 && (
                <label className="devices__field">
                  <span className="devices__field-label">Assigned Location</span>
                  <select
                    className="devices__select"
                    value={settingsLocationId}
                    onChange={(e) => setSettingsLocationId(e.target.value)}
                  >
                    <option value="">No location (Default)</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} {loc.isDefault ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="devices__settings-save-row">
                <Button
                  variant="primary"
                  onClick={() => void handleSaveSettings()}
                  isLoading={isSavingSettings}
                >
                  Save Changes
                </Button>
                {saveSuccess && (
                  <span className="devices__save-success">
                    <IconCheck aria-hidden="true" size={16} strokeWidth={2} />
                    Saved successfully
                  </span>
                )}
              </div>
            </div>

            <div className="devices__danger-zone">
              <h4 className="devices__danger-title">Danger Zone</h4>
              <p className="devices__danger-desc">
                Unlinking removes this device from your account. The device will stop sending
                telemetry to your dashboard until it is re-linked with a new pairing code.
              </p>

              <Button variant="danger" onClick={() => setIsUnlinkOpen(true)}>
                <IconTrash aria-hidden="true" size={16} strokeWidth={1.75} />
                Unlink device
              </Button>
            </div>

            <ConfirmDialog
              isOpen={isUnlinkOpen}
              title="Unlink Device"
              confirmText={isUnlinking ? 'Unlinking...' : 'Unlink Device'}
              cancelText="Cancel"
              isDangerous
              confirmDisabled={isUnlinking}
              onConfirm={() => void handleUnlink()}
              onCancel={() => setIsUnlinkOpen(false)}
            >
              <p>
                Are you sure you want to unlink &quot;{deviceLabel(selectedDevice)}&quot; (serial #{selectedDevice.serial})?
                All telemetry data recorded for this device will be cleared from your account.
              </p>
            </ConfirmDialog>
          </div>
        )}
      </div>

      <DeviceExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        serial={selectedDevice.serial}
        deviceName={deviceLabel(selectedDevice)}
      />

      {selectedDevice && (
        <DataFillModal
          isOpen={isDataFillOpen}
          onClose={() => setIsDataFillOpen(false)}
          serial={selectedDevice.serial}
          deviceName={deviceLabel(selectedDevice)}
          maxPoints={planFeatures?.dataFillMaxPoints ?? 1000}
          credits={credits}
          creditCostPerThousandPoints={planFeatures?.dataFillCreditCostPerThousandPoints ?? 1}
          onCreditsChange={(next) => {
            setCreditsOverride(next);
            queryClient.setQueryData(queryKeys.bootstrap(), (old: { credits?: unknown } | undefined) => old ? { ...old, credits: next } : old);
            onCreditsChange?.(next);
          }}
          onFilled={() => {
            void (async () => {
              try {
                const res = await api.devices.getDataPoints(selectedDevice.serial, { period });
                setDataPoints(res.dataPoints);
              } catch {
                // ignore
              }
            })();
          }}
        />
      )}
    </div>
  );
};

export default DevicesPanel;
