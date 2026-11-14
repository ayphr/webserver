import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconClock,
  IconDatabase,
  IconDroplet,
  IconExternalLink,
  IconFileDownload,
  IconGauge,
  IconMapPin,
  IconMaximize,
  IconMinimize,
  IconRefresh,
  IconTerminal2,
  IconThermometer,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { getPlanFeaturesForUser, type DataPoint, type DeviceSummary, type Location, type PublicUser } from '@common';
import { api } from '../../lib/api';
import { formatDeviceRelativeTime, isDeviceOnline } from '../../lib/deviceActivity';
import { Button, Card, Pagination } from '../common';
import { SERIES_DEFINITIONS, type SeriesId, useEnabledSeries, getSeriesDefinition } from '../../lib/series';
import { DeviceGraphs, type GraphMode } from './DeviceGraphs';
import { DeviceSettings } from './DeviceSettings';
import { ForecastTab } from './ForecastTab';
import type { DevicePeriod } from '../../lib/devicePeriod';
import { DeviceQueryModal } from './DeviceQueryModal';
import { DeviceExportModal } from './DeviceExportModal';
import '../settings/SettingsPanel.css';
import './DevicesPanel.css';

const PAGE_SIZE = 5;

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

type Period = DevicePeriod;
type DetailTab = 'graphs' | 'forecasts' | 'settings';
type Props = {
  initialDeviceSerial?: number | null;
  onNavigate?: (tab: string) => void;
};



export const DevicesPanel = ({ initialDeviceSerial = null, onNavigate }: Props) => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [devicePage, setDevicePage] = useState(1);
  const [selectedSerial, setSelectedSerial] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('graphs');
  const [isQueryOpen, setIsQueryOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);

  const planFeatures = user ? getPlanFeaturesForUser(user) : null;
  const maxDevices = planFeatures?.maxDevices ?? null;
  const atDeviceLimit = maxDevices !== null && devices.length >= maxDevices;

  // Telemetry graph state
  const [period, setPeriod] = useState<Period>('24h');
  const [graphMode, setGraphMode] = useState<GraphMode>('combined');
  const [isGraphFullscreen, setIsGraphFullscreen] = useState(false);
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
  const appliedInitialDeviceRef = useRef<number | null>(null);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [loadedDevices, loadedLocations, userData] = await Promise.all([
        api.devices.listMine(),
        api.locations.listMine().catch(() => []),
        api.users.me().catch(() => null)
      ]);
      setDevices(loadedDevices);
      setLocations(loadedLocations);
      if (userData) setUser(userData.user);
      if (
        initialDeviceSerial !== null &&
        initialDeviceSerial !== undefined &&
        initialDeviceSerial !== appliedInitialDeviceRef.current &&
        loadedDevices.some((device) => device.serial === initialDeviceSerial)
      ) {
        setSelectedSerial(initialDeviceSerial);
        setDetailTab('graphs');
        setView('detail');
        appliedInitialDeviceRef.current = initialDeviceSerial;
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
    setIsQueryOpen(false);
    setIsExportOpen(false);
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

        {maxDevices !== null && (
          <p className="devices__limit">
            Devices: {devices.length} / {maxDevices.toLocaleString()}
            {atDeviceLimit && <span className="devices__limit-warning"> Device limit reached.</span>}
          </p>
        )}

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
                  onClick={() => handleSelectDevice(device)} role="button" tabIndex={0} onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectDevice(device); } }}
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
  const canFullscreenGraph =
    detailTab === 'graphs' && dataPoints.length > 0 && enabledDefs.length > 0 && graphMode !== 'summary';

  return (
    <div className="devices">
      {error && (
        <div className="devices__error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      )}

      <div className="devices__toolbar">
        <Button
          variant="secondary"
          onClick={() => {
            setIsQueryOpen(false);
            setIsExportOpen(false);
            setView('list');
          }}
        >
          <IconArrowLeft size={16} strokeWidth={1.75} />
          Back to devices
        </Button>
        <div className="devices__actions">
          {detailTab === 'graphs' && (
            <button
              type="button"
              className="devices__fullscreen-btn"
              onClick={() => setIsGraphFullscreen((current) => !current)}
              disabled={!canFullscreenGraph}
              title={isGraphFullscreen ? 'Exit fullscreen' : 'View graph fullscreen'}
              aria-label={isGraphFullscreen ? 'Exit fullscreen' : 'View graph fullscreen'}
              aria-pressed={isGraphFullscreen}
            >
              {isGraphFullscreen ? (
                <IconMinimize size={18} strokeWidth={1.75} />
              ) : (
                <IconMaximize size={18} strokeWidth={1.75} />
              )}
            </button>
          )}
          <Button variant="secondary" onClick={() => setIsQueryOpen(true)}>
            <IconTerminal2 size={16} strokeWidth={1.75} />
            New query
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsExportOpen(true)}
            disabled={dataPoints.length === 0}
          >
            <IconFileDownload size={16} strokeWidth={1.75} />
            Export
          </Button>
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
        {(['graphs', 'forecasts', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={detailTab === tab}
            className={`settings__tab ${detailTab === tab ? 'settings__tab--active' : ''}`}
            onClick={() => setDetailTab(tab)}
          >
            {tab === 'graphs'
              ? 'Telemetry & Graphs'
              : tab === 'forecasts'
                ? 'Forecasts'
                : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="devices__panel-body">
        {/* GRAPHS TAB */}
        {detailTab === 'graphs' && (
          <DeviceGraphs
            dataPoints={dataPoints}
            enabledDefs={enabledDefs}
            period={period}
            onPeriodChange={setPeriod}
            graphMode={graphMode}
            onGraphModeChange={setGraphMode}
            showAxes={showAxes}
            onShowAxesChange={setShowAxes}
            enabledLabels={enabledLabels}
            seriesLabels={seriesLabels}
            onSeriesChange={handleSeriesChange}
            isFetchingData={isFetchingData}
            hasLoadedInitialData={hasLoadedInitialData}
            dataError={dataError}
            precisionFor={precisionFor}
          />
        )}

        {/* FORECASTS TAB */}
        {detailTab === 'forecasts' && selectedDevice && (
          <div className="devices__forecasts">
            <ForecastTab
              serial={selectedDevice.serial}
              locked={!(planFeatures?.forecasts ?? false)}
              onNavigate={onNavigate}
            />
          </div>
        )}

        {/* SETTINGS TAB */}
        {detailTab === 'settings' && selectedDevice && (
          <DeviceSettings
            device={selectedDevice}
            locations={locations}
            settingsName={settingsName}
            onSettingsNameChange={setSettingsName}
            settingsLocationId={settingsLocationId}
            onSettingsLocationIdChange={setSettingsLocationId}
            isSavingSettings={isSavingSettings}
            saveSuccess={saveSuccess}
            onSave={handleSaveSettings}
            isUnlinkOpen={isUnlinkOpen}
            onUnlinkOpenChange={setIsUnlinkOpen}
            isUnlinking={isUnlinking}
            onUnlink={handleUnlink}
          />
        )}
      </div>

      <DeviceQueryModal
        key={`query-${selectedDevice.serial}-${period}`}
        isOpen={isQueryOpen}
        onClose={() => setIsQueryOpen(false)}
        serial={selectedDevice.serial}
        deviceName={deviceLabel(selectedDevice)}
        defaultPeriod={period}
      />

      <DeviceExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        deviceName={deviceLabel(selectedDevice)}
        period={period}
        dataPoints={dataPoints}
        series={enabledDefs}
      />
    </div>
  );
};

export default DevicesPanel;
