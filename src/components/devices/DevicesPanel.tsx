import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconDroplet,
  IconExternalLink,
  IconGauge,
  IconMapPin,
  IconMaximize,
  IconShare,
  IconRefresh,
  IconThermometer,
  IconTrash,
  IconWifi,
  IconWifiOff,
  IconUserPlus,
  IconCopy,
  IconX,
} from '@tabler/icons-react';
import type { Chart } from 'chart.js';
import type { DataPoint, DeviceSummary, Location } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { formatDeviceRelativeTime, isDeviceOnline } from '../../lib/deviceActivity';
import { Button, Card, ConfirmDialog, Input, Modal, Pagination, ToggleDropdown } from '../common';
import { LineGraph } from '../graphs';
import { SERIES_DEFINITIONS, type SeriesId, useEnabledSeries, getSeriesDefinition } from '../../lib/series';
import '../settings/SettingsPanel.css';
import './DevicesPanel.css';

const PAGE_SIZE = 5;

function formatChartLabel(value: Date | string, period: string, timezone?: string, includeDate = false): string {
  const d = toDate(value);
  const timeOptions = timezone ? { timeZone: timezone } : {};
  if (includeDate) {
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...timeOptions })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...timeOptions })}`;
  }
  if (period === '1h') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...timeOptions });
  }
  if (period === '24h') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...timeOptions });
  }
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...timeOptions })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...timeOptions })}`;
}

function deviceLabel(device: DeviceSummary): string {
  return device.name?.trim() || `Device ${device.serial}`;
}

function TelemetryChips({ reading }: Readonly<{ reading: DataPoint | null }>) {
  if (!reading) {
    return <span className="devices__no-data">No telemetry data recorded</span>;
  }

  return (
    <div className="devices__telemetry-chips">
      <div className="devices__telemetry-chip">
        <IconThermometer size={14} strokeWidth={2} />
        <span>{reading.temperature.toFixed(1)} °C</span>
      </div>
      <div className="devices__telemetry-chip">
        <IconDroplet size={14} strokeWidth={2} />
        <span>{reading.humidity.toFixed(1)} %</span>
      </div>
      <div className="devices__telemetry-chip">
        <IconGauge size={14} strokeWidth={2} />
        <span>{reading.airPressure.toFixed(0)} hPa</span>
      </div>
    </div>
  );
}

type Period = '1h' | '24h' | '7d' | '30d' | 'all';
type GraphMode = 'combined' | 'separate' | 'summary' | 'table';
type DetailTab = 'graphs' | 'settings';
type Props = {
  initialDeviceSerial?: number | null;
  initialDateFrom?: string;
  initialDateTo?: string;
  initialShareToken?: string | null;
};



function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return value;
  const name = value.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || value;
}

function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  );
  return asUtc - date.getTime();
}

function toTimezoneBoundaryIso(dateValue: string, timezone: string, endOfDay: boolean): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) return undefined;
  const [, yearPart, monthPart, dayPart] = match;
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timezone);
  const corrected = firstPass - getTimeZoneOffsetMs(new Date(firstPass), timezone);
  return new Date(corrected).toISOString();
}

export const DevicesPanel = ({
  initialDeviceSerial = null,
  initialDateFrom = '',
  initialDateTo = '',
  initialShareToken = null,
}: Props) => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [devicePage, setDevicePage] = useState(1);
  const [selectedSerial, setSelectedSerial] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('graphs');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Telemetry graph state
  const [period] = useState<Period>('24h');
  const [graphMode, setGraphMode] = useState<GraphMode>('combined');
  const { enabled: enabledSeries, setEnabled: setEnabledSeries } = useEnabledSeries();
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [showAxes, setShowAxes] = useState(true);
  const [showXAxis, setShowXAxis] = useState(true);
  const [layers, setLayers] = useState<string[]>(['y-axis', 'x-axis']);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [shareAccess, setShareAccess] = useState<'restricted' | 'anyone'>('restricted');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [invitedUsers, setInvitedUsers] = useState<string[]>([]);
  const [inviteInput, setInviteInput] = useState('');
  const [isSavingShare, setIsSavingShare] = useState(false);
  const chartRef = useRef<Chart<'line'> | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeShareToken, setActiveShareToken] = useState<string | null>(initialShareToken);

  useEffect(() => {
    setDateFrom(initialDateFrom);
    setDateTo(initialDateTo);
  }, [initialDateFrom, initialDateTo]);

  useEffect(() => {
    setActiveShareToken(initialShareToken);
  }, [initialShareToken]);

  const graphStorageKey = selectedSerial === null ? null : `ayphr:device:${selectedSerial}:graphPreferences`;
  useEffect(() => {
    if (selectedSerial === null) return;
    try {
      const raw = window.localStorage.getItem(`ayphr:device:${selectedSerial}:graphPreferences`);
      const stored = raw ? JSON.parse(raw) as Partial<{ showAxes: boolean; showXAxis: boolean; layers: string[]; refreshInterval: number; timezone: string }> : {};
      // These values intentionally reset when the device changes so preferences never leak across devices.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowAxes(stored.showAxes ?? true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowXAxis(stored.showXAxis ?? true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLayers(stored.layers ?? ['y-axis', 'x-axis']);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRefreshInterval(stored.refreshInterval ?? 0);
      setTimezone(stored.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
      setDataPoints([]);
      setHasLoadedInitialData(false);
    } catch {
      setShowAxes(true);
      setShowXAxis(true);
      setLayers(['y-axis', 'x-axis']);
      setRefreshInterval(0);
      setTimezone('UTC');
    }
  }, [selectedSerial]);

  useEffect(() => {
    if (!graphStorageKey) return;
    try {
      window.localStorage.setItem(graphStorageKey, JSON.stringify({ showAxes, showXAxis, layers, refreshInterval, timezone }));
    } catch {
      // Local preferences are best effort.
    }
  }, [graphStorageKey, layers, refreshInterval, showAxes, showXAxis, timezone]);

  // Device settings state
  const [settingsName, setSettingsName] = useState('');
  const [settingsLocationId, setSettingsLocationId] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isUnlinkOpen, setIsUnlinkOpen] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const hasAppliedInitialDevice = useRef(false);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [loadedDevices, loadedLocations] = await Promise.all([
        api.devices.listMine(),
        api.locations.listMine().catch(() => []),
      ]);
      setDevices(loadedDevices);
      setLocations(loadedLocations);
      if (
        !hasAppliedInitialDevice.current &&
        initialDeviceSerial !== null &&
        initialDeviceSerial !== undefined &&
        loadedDevices.some((device) => device.serial === initialDeviceSerial)
      ) {
        setSelectedSerial(initialDeviceSerial);
        setDetailTab('graphs');
        setView('detail');
        hasAppliedInitialDevice.current = true;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    }
  }, [initialDeviceSerial]);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      await loadAll();
      setIsLoading(false);
    })();
  }, [loadAll]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.serial === selectedSerial) ?? null,
    [devices, selectedSerial],
  );

  const selectedLocation = useMemo(() => {
    if (!selectedDevice?.locationId) return null;
    return locations.find((l) => l.id === selectedDevice.locationId) ?? null;
  }, [locations, selectedDevice]);

  const deviceTotalPages = Math.max(1, Math.ceil(devices.length / PAGE_SIZE));
  const currentDevicePage = Math.min(devicePage, deviceTotalPages);
  const visibleDevices = useMemo(
    () => devices.slice((currentDevicePage - 1) * PAGE_SIZE, currentDevicePage * PAGE_SIZE),
    [currentDevicePage, devices],
  );

  // Sync settings form fields when selected device changes
  const [prevDeviceSerial, setPrevDeviceSerial] = useState<number | null>(null);
  if (selectedDevice && selectedDevice.serial !== prevDeviceSerial) {
    setPrevDeviceSerial(selectedDevice.serial);
    setSettingsName(selectedDevice.name?.trim() || '');
    setSettingsLocationId(selectedDevice.locationId || '');
    setSaveSuccess(false);
    setHasLoadedInitialData(false);
  }

  // Load telemetry data points when a device is selected and tab is 'graphs'
  const fromIso = useMemo(
    () => (dateFrom ? toTimezoneBoundaryIso(dateFrom, timezone, false) : undefined),
    [dateFrom, timezone],
  );
  const toIso = useMemo(
    () => (dateTo ? toTimezoneBoundaryIso(dateTo, timezone, true) : undefined),
    [dateTo, timezone],
  );

  useEffect(() => {
    if (view !== 'detail' || selectedSerial === null || detailTab !== 'graphs') return;
    let cancelled = false;

    const run = async () => {
      setIsFetchingData(true);
      setDataError(null);
      try {
        const res = activeShareToken
          ? await api.devices.getSharedDataPoints(selectedSerial, activeShareToken, {
            period,
            from: fromIso,
            to: toIso,
          })
          : await api.devices.getDataPoints(selectedSerial, {
          period,
          from: fromIso,
          to: toIso,
        });
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
  }, [view, selectedSerial, detailTab, period, fromIso, toIso, activeShareToken]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadAll();
    if (selectedSerial !== null && detailTab === 'graphs') {
      try {
        const res = activeShareToken
          ? await api.devices.getSharedDataPoints(selectedSerial, activeShareToken, {
            period,
            from: fromIso,
            to: toIso,
          })
          : await api.devices.getDataPoints(selectedSerial, {
          period,
          from: fromIso,
          to: toIso,
        });
        setDataPoints(res.dataPoints);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : 'Failed to load telemetry data');
      }
    }
    setIsRefreshing(false);
  }, [detailTab, loadAll, period, selectedSerial, fromIso, toIso, activeShareToken]);

  useEffect(() => {
    if (refreshInterval <= 0 || view !== 'detail' || detailTab !== 'graphs') return;
    const timer = window.setInterval(() => {
      void handleRefresh();
    }, refreshInterval * 1000);
    return () => window.clearInterval(timer);
  }, [refreshInterval, view, detailTab, handleRefresh]);

  useEffect(() => {
    if (view !== 'detail' || detailTab !== 'graphs') return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.toLowerCase() === 'r') void handleRefresh();
      if (event.key === '1') setGraphMode('combined');
      if (event.key === '2') setGraphMode('separate');
      if (event.key === '3') setGraphMode('summary');
      if (event.key === '4') setGraphMode('table');
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [detailTab, handleRefresh, view]);

  const downloadExport = async (format: 'csv' | 'json') => {
    if (selectedSerial === null) return;
    try {
      const blob = await api.devices.exportData(selectedSerial, format, {
        period,
        from: fromIso,
        to: toIso,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `device-${selectedSerial}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : `Failed to export ${format.toUpperCase()}`);
    }
  };

  const includeDateInLabels = useMemo(() => {
    if (period !== '1h' && period !== '24h') return true;
    if (dateFrom && dateTo) return dateFrom !== dateTo;
    return Boolean(dateFrom || dateTo);
  }, [period, dateFrom, dateTo]);

  const downloadPng = () => {
    const chart = chartRef.current;
    if (!chart?.toBase64Image) return;
    const anchor = document.createElement('a');
    anchor.href = chart.toBase64Image();
    anchor.download = `device-${selectedSerial ?? 'telemetry'}.png`;
    anchor.click();
  };

  const toggleLayer = (labels: string[]) => {
    setLayers(labels);
    setShowAxes(labels.includes('y-axis'));
    setShowXAxis(labels.includes('x-axis'));
  };

  const getShareUrl = (token: string | null) => {
    const params = new URLSearchParams({ tab: 'devices', device: String(selectedSerial ?? '') });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (token) params.set('share', token);
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  };

  const openShareDialog = async () => {
    if (selectedSerial === null) return;
    try {
     const share = await api.devices.getShare(selectedSerial);
     setShareAccess(share.access);
     setShareToken(share.token);
     setActiveShareToken(share.token);
     setInvitedUsers(share.invitedUsernames);
     setIsShareOpen(true);
    } catch (err) {
     setDataError(err instanceof Error ? err.message : 'Failed to load share settings');
    }
  };

  const saveShare = async () => {
    if (selectedSerial === null) return;
    setIsSavingShare(true);
    try {
     const share = await api.devices.updateShare(selectedSerial, {
       access: shareAccess,
       invitedUsernames: invitedUsers,
     });
     setShareToken(share.token);
     setActiveShareToken(share.token);
    } catch (err) {
     setDataError(err instanceof Error ? err.message : 'Failed to save share settings');
    } finally {
     setIsSavingShare(false);
    }
  };

  const addInvite = () => {
    const username = inviteInput.trim().replace(/^@/, '').toLowerCase();
    if (username && !invitedUsers.includes(username)) setInvitedUsers((current) => [...current, username]);
    setInviteInput('');
  };

  const copyShareLink = async () => {
    try {
     let token = shareToken;
     if (!token && selectedSerial !== null) {
       const share = await api.devices.updateShare(selectedSerial, {
         access: shareAccess,
         invitedUsernames: invitedUsers,
       });
       token = share.token;
       setShareToken(token);
       setActiveShareToken(token);
     }
     if (!token) return;
     await navigator.clipboard.writeText(getShareUrl(token));
     setDataError('Share link copied to clipboard.');
    } catch (err) {
     setDataError(err instanceof Error ? err.message : 'Failed to copy share link');
    }
  };

  const handleSelectDevice = (device: DeviceSummary) => {
    setSelectedSerial(device.serial);
    setActiveShareToken(null);
    setDetailTab('graphs');
    setView('detail');
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
      setDevices((current) =>
        current.map((d) => (d.serial === updated.serial ? { ...d, ...updated } : d)),
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
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
      setDevices((current) => current.filter((d) => d.serial !== selectedDevice.serial));
      setSelectedSerial(null);
      setIsUnlinkOpen(false);
      setView('list');
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
  const combinedData = useMemo(() => {
    const labels = dataPoints.map((p) => formatChartLabel(p.timestamp, period, timezone, includeDateInLabels));
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    const datasets = enabledDefs.map((def) => {
      const values = dataPoints.map((p) => def.getValue(p));
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      const deviation = values.length
        ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
        : 0;
      const anomalyColor = resolveCssColor('var(--status-error)');
      const anomalies = values.map((value) => Math.abs(value - average) > deviation * 2);
      return {
        label: def.label,
        data: values,
        borderColor: resolveCssColor(def.color),
        backgroundColor: layers.includes('anomalies')
          ? anomalies.map((isAnomaly) => (isAnomaly ? anomalyColor : resolveCssColor(def.color)))
          : 'transparent',
        yAxisID: unitToScaleId.get(def.unit) ?? 'y',
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: def.dash,
        pointRadius: layers.includes('anomalies')
          ? anomalies.map((isAnomaly) => (isAnomaly ? Math.max(pointRadius, 3) : pointRadius))
          : pointRadius,
        pointHoverRadius: 4,
      };
    });
    const primary = enabledDefs[0];
    if (primary && layers.includes('thresholds')) {
      const values = dataPoints.map((p) => primary.getValue(p));
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1));
      datasets.push(
        {
          label: 'Threshold upper',
          data: values.map(() => average + deviation * 2),
          borderColor: 'rgba(248, 113, 113, 0.45)',
          backgroundColor: 'rgba(248, 113, 113, 0.08)',
          yAxisID: unitToScaleId.get(primary.unit) ?? 'y',
          borderDash: [4, 4],
          fill: false,
          borderWidth: 1,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
        },
        {
          label: 'Threshold lower',
          data: values.map(() => average - deviation * 2),
          borderColor: 'rgba(248, 113, 113, 0.45)',
          backgroundColor: 'rgba(248, 113, 113, 0.08)',
          yAxisID: unitToScaleId.get(primary.unit) ?? 'y',
          borderDash: [4, 4],
          fill: false,
          borderWidth: 1,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
        },
      );
    }
    if (primary && layers.includes('forecast') && dataPoints.length > 1) {
      const values = dataPoints.map((p) => primary.getValue(p));
      const last = values.length - 1;
      const meanX = last / 2;
      const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
      const slope = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0)
        / Math.max(values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0), 1);
      datasets.push({
        label: 'Forecast trend',
        data: values.map((_, index) => meanY + slope * (index - meanX)),
        borderColor: 'rgba(96, 165, 250, 0.9)',
        backgroundColor: 'transparent',
        yAxisID: unitToScaleId.get(primary.unit) ?? 'y',
        borderDash: [8, 4],
        fill: false,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      });
    }
    return {
      labels,
      datasets,
    };
  }, [dataPoints, period, enabledDefs, layers, timezone, unitToScaleId, includeDateInLabels]);



  const combinedConfig = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scales: Record<string, any> = {
      x: {
        display: showXAxis,
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)', maxTicksLimit: 8 },
      },
    };
    unitGroups.forEach((unit, i) => {
      const id = i === 0 ? 'y' : `y${i}`;
      scales[id] = {
        type: 'linear',
        display: showAxes,
        position: i === 0 ? 'left' : 'right',
        title: { display: showAxes, text: unit, color: 'hsl(180, 1%, 53%)' },
        grid: i === 0 ? { color: 'rgba(255, 255, 255, 0.08)' } : { drawOnChartArea: false },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      };
    });
    if (unitGroups.length === 0) {
      scales.y = {
        type: 'linear',
        display: showAxes,
        position: 'left',
        title: { display: showAxes, text: '', color: 'hsl(180, 1%, 53%)' },
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      };
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      font: { family: "'DM Sans', sans-serif" },
      animation: { duration: 0 },
      interaction: { mode: 'index' as const, intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top' as const,
          labels: { color: 'hsla(180, 67%, 99%, 1)', boxWidth: 16, padding: 14 },
        },
        tooltip: {
          backgroundColor: 'rgba(18, 18, 18, 0.96)',
          titleColor: 'hsla(180, 67%, 99%, 1)',
          bodyColor: 'hsl(180, 1%, 53%)',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          padding: 10,
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
          },
          pan: {
            enabled: true,
            mode: 'x',
          },
        },
      },
      scales,
    };
  }, [unitGroups, showAxes, showXAxis]);

  const createMetricConfig = (unit: string, showAxes: boolean, showXAxis: boolean) => ({
    responsive: true,
    maintainAspectRatio: false,
    font: {
      family: "'DM Sans', sans-serif",
    },
    animation: { duration: 0 },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(18, 18, 18, 0.96)',
        titleColor: 'hsla(180, 67%, 99%, 1)',
        bodyColor: 'hsl(180, 1%, 53%)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        padding: 10,
      },
      zoom: {
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          mode: 'x',
        },
        pan: {
          enabled: true,
          mode: 'x',
        },
      },
    },
    scales: {
      x: {
        display: showXAxis,
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)', maxTicksLimit: 8 },
      },
      y: {
        type: 'linear' as const,
        display: showAxes,
        position: 'left' as const,
        title: { display: showAxes, text: unit, color: 'hsl(180, 1%, 53%)' },
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      },
    },
  });

  const separateCharts = useMemo(
    () =>
      enabledDefs.map((def) => ({
        def,
        data: {
          labels: dataPoints.map((p) => formatChartLabel(p.timestamp, period, timezone, includeDateInLabels)),
          datasets: [
            {
              label: def.label,
              data: dataPoints.map((p) => def.getValue(p)),
              borderColor: resolveCssColor(def.color),
              backgroundColor: 'transparent',
              tension: 0.25,
              fill: false,
              borderWidth: 2,
              borderDash: def.dash,
              pointRadius: dataPoints.length > 80 ? 0 : 2,
              pointHoverRadius: 4,
            },
          ],
        },
        config: createMetricConfig(def.unit, showAxes, showXAxis),
      })),
    [dataPoints, period, enabledDefs, showAxes, showXAxis, timezone, includeDateInLabels],
  );
  const canUseCombinedChartActions = graphMode === 'combined' && dataPoints.length > 0 && enabledDefs.length > 0;

  if (isLoading) {
    return <p className="devices__notice">Loading devices...</p>;
  }

  // LIST VIEW
  if (view === 'list' || !selectedDevice) {
    return (
      <div className="devices">
        <div className="devices__toolbar">
          <div className="devices__actions">
            <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
              <IconRefresh size={16} strokeWidth={1.75} />
              Refresh
            </Button>
            <Button
              variant="primary"
              onClick={() => window.open('https://ayphr.com/link', '_blank', 'noopener,noreferrer')}
            >
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

        {devices.length === 0 ? (
          <div className="devices__empty">
            <IconDatabase size={28} strokeWidth={1.5} />
            <h3>No devices yet</h3>
            <p>Use &quot;Add device&quot; to open ayphr.com/link and enter the code shown on your device.</p>
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
                  onClick={() => handleSelectDevice(device)}
                >
                  <div className="devices__card-header">
                    <div className="devices__card-title-group">
                      <span className="devices__card-name">{deviceLabel(device)}</span>
                      {device.name?.trim() && (
                        <span className="devices__serial-pill">#{device.serial}</span>
                      )}
                    </div>
                    <span
                      className={`devices__connection-icon ${online ? 'is-online' : 'is-offline'}`}
                      title={online ? 'Online' : 'Offline'}
                      aria-label={online ? 'Online' : 'Offline'}
                    >
                      {online ? <IconWifi size={18} strokeWidth={1.75} /> : <IconWifiOff size={18} strokeWidth={1.75} />}
                    </span>
                  </div>

                  <div className="devices__card-telemetry">
                    <TelemetryChips reading={reading} />
                  </div>

                  <div className="devices__card-footer">
                    <span className="devices__card-location">
                      <IconMapPin size={13} strokeWidth={1.75} />
                      {deviceLoc ? deviceLoc.name : 'Unassigned location'}
                    </span>
                    <span className="devices__card-lastseen">
                      <IconClock size={13} strokeWidth={1.75} />
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

  return (
    <div className="devices">
      {error && (
        <div className="devices__error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      <div className="devices__toolbar">
        <Button variant="secondary" onClick={() => setView('list')}>
          <IconArrowLeft size={16} strokeWidth={1.75} />
          Back to devices
        </Button>
        <div className="devices__actions">
          <Button variant="secondary" onClick={() => void handleRefresh()} isLoading={isRefreshing}>
            <IconRefresh size={16} strokeWidth={1.75} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="devices__detail-header">
        <div className="devices__title-row">
          <div className="devices__title-group">
            <h3 className="devices__detail-title">{deviceLabel(selectedDevice)}</h3>
            <span className="devices__serial-pill">#{selectedDevice.serial}</span>
          </div>
          <span
            className={`devices__connection-icon ${online ? 'is-online' : 'is-offline'}`}
            title={online ? 'Online' : 'Offline'}
            aria-label={online ? 'Online' : 'Offline'}
          >
            {online ? <IconWifi size={18} strokeWidth={1.75} /> : <IconWifiOff size={18} strokeWidth={1.75} />}
          </span>
        </div>

        <div className="devices__detail-data-row">
          <div className="devices__detail-meta">
            <span>
              <IconMapPin size={14} strokeWidth={1.75} />
              {selectedLocation?.name ?? 'No location'}
            </span>
            <span>
              <IconDatabase size={14} strokeWidth={1.75} />
              {selectedDevice.dataPointCount.toLocaleString()} data points
            </span>
            <span>
              <IconClock size={14} strokeWidth={1.75} />
              Last seen {formatDeviceRelativeTime(selectedDevice.lastUploadAt)}
            </span>
          </div>

          {latest && (
            <div className="devices__detail-telemetry">
              <TelemetryChips reading={latest} />
            </div>
          )}
        </div>
      </div>

      <div className="settings__tabs" role="tablist" aria-label="Device sections">
        {(['graphs', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={detailTab === tab}
            className={`settings__tab ${detailTab === tab ? 'settings__tab--active' : ''}`}
            onClick={() => setDetailTab(tab)}
          >
            {tab === 'graphs' ? 'Telemetry & Graphs' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="devices__panel-body">
        {/* GRAPHS TAB */}
        {detailTab === 'graphs' && (
          <div className="devices__graphs">
            <div className="devices__graphs-controls" onContextMenu={(e) => e.preventDefault()}>
              <div className="devices__date-picker" role="group" aria-label="Date range">
                <label>
                  From
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label>
                  To
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
              </div>

              <div className="devices__series-selector">
                <ToggleDropdown
                  buttonLabel="Series"
                  options={seriesLabels}
                  value={enabledLabels}
                  onChange={handleSeriesChange}
                  placeholder="Series"
                  className="toggle-dropdown--compact"
                />
              </div>

              <div className="devices__layers-selector">
                <ToggleDropdown
                  buttonLabel="Layers"
                  options={['y-axis', 'x-axis', 'thresholds', 'anomalies', 'forecast']}
                  value={layers}
                  onChange={toggleLayer}
                  placeholder="Layers"
                  className="toggle-dropdown--compact"
                />
              </div>

              <label className="devices__refresh-control">
                Refresh
                <select value={refreshInterval} onChange={(e) => setRefreshInterval(Number(e.target.value))}>
                  <option value={0}>Off</option>
                  <option value={15}>15s</option>
                  <option value={30}>30s</option>
                  <option value={60}>1m</option>
                  <option value={300}>5m</option>
                </select>
              </label>

              <label className="devices__refresh-control">
                Timezone
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  <option value={timezone}>{timezone}</option>
                  {timezone !== 'UTC' && <option value="UTC">UTC</option>}
                  {timezone !== 'America/New_York' && <option value="America/New_York">New York</option>}
                  {timezone !== 'Europe/London' && <option value="Europe/London">London</option>}
                  {timezone !== 'Asia/Tokyo' && <option value="Asia/Tokyo">Tokyo</option>}
                </select>
              </label>

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
                <button
                  type="button"
                  className={`devices__control-btn ${graphMode === 'table' ? 'is-active' : ''}`}
                  onClick={() => setGraphMode('table')}
                >
                  Table
                </button>
              </div>
              <div className="devices__export-actions" aria-label="Export and chart actions">
                <button type="button" className="devices__icon-btn" onClick={() => void downloadExport('csv')} title="Export CSV" aria-label="Export CSV"><IconDownload size={16} /> CSV</button>
                <button type="button" className="devices__icon-btn" onClick={() => void downloadExport('json')} title="Export JSON" aria-label="Export JSON">JSON</button>
                <button type="button" className="devices__icon-btn" onClick={downloadPng} title="Export PNG" aria-label="Export PNG" disabled={!canUseCombinedChartActions}>PNG</button>
                <button type="button" className="devices__icon-btn" onClick={() => void chartContainerRef.current?.requestFullscreen?.()} title="Fullscreen chart" aria-label="Fullscreen chart" disabled={!canUseCombinedChartActions}><IconMaximize size={16} /></button>
                <button type="button" className="devices__icon-btn" onClick={() => void openShareDialog()} title="Share chart" aria-label="Share chart"><IconShare size={16} /></button>
              </div>
              </div>

            {dataError && (
              <div className="devices__error">
                <IconAlertCircle size={16} strokeWidth={1.75} />
                <span>{dataError}</span>
              </div>
            )}

            {/* If initial load has not finished yet, show initial placeholder with stable height */}
            {!hasLoadedInitialData && isFetchingData ? (
              <div className="devices__chart-card devices__loading-box">
                <IconRefresh className="devices__spin-icon" size={24} strokeWidth={2} />
                <p>Loading telemetry history...</p>
              </div>
            ) : dataPoints.length === 0 || enabledDefs.length === 0 ? (
              <div className="devices__empty">
                <IconDatabase size={28} strokeWidth={1.5} />
                <h3>{dataPoints.length === 0 ? 'No data points found' : 'No series selected'}</h3>
                <p>
                  {dataPoints.length === 0
                    ? 'No telemetry recorded for this device during the selected time period.'
                    : 'Select at least one series from the Series dropdown to display the graph.'}
                </p>
              </div>
            ) : (
              <div className={`devices__graphs-body ${isFetchingData ? 'is-updating' : ''}`}>
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
                        <IconCpu size={16} strokeWidth={1.75} />
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
                    <div ref={chartContainerRef} className="devices__chart-container" style={{ position: 'relative' }} onContextMenu={(e) => e.preventDefault()}>
                      <LineGraph ref={chartRef} data={combinedData} config={combinedConfig} />

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
                ) : graphMode === 'table' ? (
                  <div className="devices__table-wrap">
                    <table className="devices__data-table">
                      <caption className="sr-only">Telemetry data</caption>
                      <thead>
                        <tr>
                          <th scope="col">Timestamp</th>
                          {enabledDefs.map((def) => <th scope="col" key={def.id}>{def.shortLabel} ({def.unit})</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {dataPoints.map((point) => (
                          <tr key={new Date(point.timestamp).toISOString()}>
                            <td>{new Date(point.timestamp).toLocaleString(undefined, { timeZone: timezone, timeZoneName: 'short' })}</td>
                            {enabledDefs.map((def) => <td key={def.id}>{def.getValue(point).toFixed(2)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

              </div>
            )}
          </div>
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
                    <IconCheck size={16} strokeWidth={2} />
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
                <IconTrash size={16} strokeWidth={1.75} />
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

      <Modal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        title="Share chart"
        showCancel={false}
        size="md"
      >
        <div className="devices__share-modal">
          <p className="devices__share-description">
            Choose who can view this chart and invite specific Ayphr users.
          </p>

          <div className="devices__share-access" role="group" aria-label="Link access">
            <button
              type="button"
              className={`devices__share-access-option ${shareAccess === 'restricted' ? 'is-selected' : ''}`}
              onClick={() => setShareAccess('restricted')}
            >
              <strong>Restricted</strong>
              <span>Only you and invited people can view</span>
            </button>
            <button
              type="button"
              className={`devices__share-access-option ${shareAccess === 'anyone' ? 'is-selected' : ''}`}
              onClick={() => setShareAccess('anyone')}
            >
              <strong>Anyone with the link</strong>
              <span>Anyone who has the link can view</span>
            </button>
          </div>

          {shareAccess === 'restricted' && (
            <div className="devices__share-invites">
              <label htmlFor="share-invite-username">Invite people</label>
              <div className="devices__share-invite-row">
                <Input
                  id="share-invite-username"
                  value={inviteInput}
                  onChange={(event) => setInviteInput(event.target.value)}
                  placeholder="Username"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addInvite();
                    }
                  }}
                />
                <Button variant="secondary" onClick={addInvite}>
                  <IconUserPlus size={16} />
                  Add
                </Button>
              </div>
              {invitedUsers.length > 0 && (
                <div className="devices__share-user-list" aria-label="Invited people">
                  {invitedUsers.map((username) => (
                    <span className="devices__share-user" key={username}>
                      @{username}
                      <button type="button" onClick={() => setInvitedUsers((current) => current.filter((value) => value !== username))} aria-label={`Remove ${username}`}>
                        <IconX size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="devices__share-link-row">
            <Input readOnly value={shareToken ? getShareUrl(shareToken) : 'Save settings to create a link'} aria-label="Share link" />
            <Button variant="secondary" onClick={() => void copyShareLink()} disabled={!shareToken && isSavingShare}>
              <IconCopy size={16} />
              Copy
            </Button>
          </div>

          <div className="devices__share-footer">
            <Button variant="secondary" onClick={() => setIsShareOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveShare()} isLoading={isSavingShare}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DevicesPanel;
