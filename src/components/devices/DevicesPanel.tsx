import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDroplet,
  IconExternalLink,
  IconGauge,
  IconMapPin,
  IconRefresh,
  IconThermometer,
  IconTrash,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import type { DataPoint, DeviceSummary, Location } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { formatDeviceRelativeTime, isDeviceOnline } from '../../lib/deviceActivity';
import { Button, Card, Checkbox, ConfirmDialog, Input, Pagination, ToggleDropdown } from '../common';
import { LineGraph } from '../graphs';
import { SERIES_DEFINITIONS, type SeriesId, useEnabledSeries, getSeriesDefinition } from '../../lib/series';
import '../settings/SettingsPanel.css';
import './DevicesPanel.css';

const PAGE_SIZE = 5;

function formatChartLabel(value: Date | string, period: string): string {
  const d = toDate(value);
  if (period === '1h') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  if (period === '24h') {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
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
type GraphMode = 'combined' | 'separate' | 'summary';
type DetailTab = 'graphs' | 'settings';
type Props = {
  initialDeviceSerial?: number | null;
};



function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return value;
  const name = value.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || value;
}

export const DevicesPanel = ({ initialDeviceSerial = null }: Props) => {
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
  const [period, setPeriod] = useState<Period>('24h');
  const [graphMode, setGraphMode] = useState<GraphMode>('combined');
  const { enabled: enabledSeries, setEnabled: setEnabledSeries } = useEnabledSeries();


  const [showAxes, setShowAxes] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem('ayphr:device:showAxes');
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('ayphr:device:showAxes', String(showAxes));
    } catch {
      // ignore
    }
  }, [showAxes]);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
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
  useEffect(() => {
    if (view !== 'detail' || selectedSerial === null || detailTab !== 'graphs') return;
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
  }, [view, selectedSerial, detailTab, period]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAll();
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
    setSelectedSerial(device.serial);
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
    const labels = dataPoints.map((p) => formatChartLabel(p.timestamp, period));
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    return {
      labels,
      datasets: enabledDefs.map((def) => ({
        label: def.label,
        data: dataPoints.map((p) => def.getValue(p)),
        borderColor: resolveCssColor(def.color),
        backgroundColor: 'transparent',
        yAxisID: unitToScaleId.get(def.unit) ?? 'y',
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: def.dash,
        pointRadius,
        pointHoverRadius: 4,
      })),
    };
  }, [dataPoints, period, enabledDefs, unitToScaleId]);



  const combinedConfig = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scales: Record<string, any> = {
      x: {
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
  }, [unitGroups, showAxes]);

  const createMetricConfig = (unit: string, showAxes: boolean) => ({
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
          labels: dataPoints.map((p) => formatChartLabel(p.timestamp, period)),
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
        config: createMetricConfig(def.unit, showAxes),
      })),
    [dataPoints, period, enabledDefs, showAxes],
  );

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
              <div className="devices__period-selector" role="group" aria-label="Time period">
                {(['1h', '24h', '7d', '30d', 'all'] as const).map((p) => (
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

              <div className="devices__axes-toggle">
                <Checkbox
                  label="Y axes"
                  checked={showAxes}
                  onChange={(e) => setShowAxes(e.target.checked)}
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
                    <div className="devices__chart-container" style={{ position: 'relative' }} onContextMenu={(e) => e.preventDefault()}>
                      <LineGraph data={combinedData} config={combinedConfig} />

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
    </div>
  );
};

export default DevicesPanel;
