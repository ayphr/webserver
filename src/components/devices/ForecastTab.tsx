import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ScriptableLineSegmentContext } from 'chart.js';
import type { DataPoint, DeviceForecastPayload, ForecastSample } from '@common';
import { forecastFromHistory, forecastHorizons, FORECAST_STEP_SECONDS } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { Button } from '../common';
import { LineGraph } from '../graphs';
import type { LineGraphConfig, LineGraphData } from '../graphs/types';
import { getSeriesDefinition } from '../../lib/series';
import './ForecastTab.css';

type Props = {
  serial: number;
  locked: boolean;
  onNavigate?: (tab: string) => void;
  isFullscreen?: boolean;
};

const FORECAST_MAX_ZOOM_IN_MS = 60 * 1000;
const FORECAST_ZOOM_OUT_PADDING = 0.02;

function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return value;
  const name = value.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || value;
}

function fade(color: string, alpha: number): string {
  const resolved = resolveCssColor(color).trim();
  if (resolved.startsWith('rgb(')) {
    return resolved.replace('rgb(', 'rgba(').replace(/\)$/, `, ${alpha})`);
  }
  if (resolved.startsWith('rgba(')) {
    return resolved.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  if (resolved.startsWith('#')) {
    const hex = resolved.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return resolved;
}

const METRICS = [
  {
    shortLabel: 'Temperature',
    unit: '°C',
    axis: 'y',
    def: getSeriesDefinition('temperature')!,
    actual: (p: DataPoint) => p.temperature,
    forecast: (s: ForecastSample) => s.temperature,
  },
  {
    shortLabel: 'Humidity',
    unit: '%',
    axis: 'y1',
    def: getSeriesDefinition('humidity')!,
    actual: (p: DataPoint) => p.humidity,
    forecast: (s: ForecastSample) => s.humidity,
  },
  {
    shortLabel: 'Pressure',
    unit: 'hPa',
    axis: 'y2',
    def: getSeriesDefinition('pressure')!,
    actual: (p: DataPoint) => p.airPressure,
    forecast: (s: ForecastSample) => s.airPressure,
  },
];

type AxisWindow = {
  initialMin: number;
  initialMax: number;
  limitMin: number;
  limitMax: number;
};

function computeAxisWindow(points: { x: number }[]): AxisWindow | null {
  if (points.length === 0) return null;
  let min = points[0]!.x;
  let max = points[0]!.x;
  for (const point of points) {
    if (point.x < min) min = point.x;
    if (point.x > max) max = point.x;
  }
  if (max <= min) {
    return {
      initialMin: max - FORECAST_MAX_ZOOM_IN_MS / 2,
      initialMax: max + FORECAST_MAX_ZOOM_IN_MS / 2,
      limitMin: max - FORECAST_MAX_ZOOM_IN_MS,
      limitMax: max + FORECAST_MAX_ZOOM_IN_MS,
    };
  }
  const padding = (max - min) * FORECAST_ZOOM_OUT_PADDING;
  return {
    initialMin: min - padding,
    initialMax: max + padding,
    limitMin: min - padding,
    limitMax: max + padding,
  };
}

export function ForecastTab({ serial, locked, onNavigate, isFullscreen }: Props) {
  const [forecast, setForecast] = useState<DeviceForecastPayload | null>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [horizonMinutes, setHorizonMinutes] = useState(60);
  const [historyPeriod, setHistoryPeriod] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (locked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    setDataPoints([]);
    void (async () => {
      try {
        const dp = await api.devices.getDataPoints(serial, { period: historyPeriod });
        if (cancelled) return;
        setDataPoints(dp.dataPoints ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load telemetry');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serial, locked, historyPeriod]);

  const calculate = useCallback(async () => {
    if (locked) return;
    setLoading(true);
    setError(null);
    setForecast(null);
    setProgress(0);
    try {
      let pts = dataPoints;
      if (pts.length === 0) {
        const dp = await api.devices.getDataPoints(serial, { period: historyPeriod });
        pts = dp.dataPoints ?? [];
        setDataPoints(pts);
      }
      const horizons = forecastHorizons(horizonMinutes * 60, FORECAST_STEP_SECONDS);
      const result = await forecastFromHistory(pts, {
        horizons,
        onProgress: (p) => setProgress(Math.round(p * 100)),
      });
      if (!result) {
        setError('Not enough telemetry history to produce a forecast.');
        return;
      }
      const payload: DeviceForecastPayload = {
        serial,
        generatedAt: new Date(result.generatedAt),
        anchorTimestamp: new Date(result.anchorTimestamp),
        horizonSeconds: horizonMinutes * 60,
        stepSeconds: FORECAST_STEP_SECONDS,
        samples: result.horizons.map((h) => ({
          timestamp: new Date(h.targetTimestamp),
          temperature: h.point.temperature,
          humidity: h.point.humidity,
          airPressure: h.point.pressure,
          temperatureStd: h.uncertainty.temperature,
          humidityStd: h.uncertainty.humidity,
          airPressureStd: h.uncertainty.pressure,
        })),
      };
      setProgress(100);
      setForecast(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate forecast');
    } finally {
      setLoading(false);
    }
  }, [serial, locked, horizonMinutes, dataPoints, historyPeriod]);

  // Reset calculated forecast when horizon changes so stale results aren't shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForecast(null);
  }, [horizonMinutes]);

  // Reset calculated forecast when the history window changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForecast(null);
  }, [historyPeriod]);

  // Forecast samples within the selected horizon.
  const forecastSamples = useMemo(() => {
    if (!forecast) return [];
    const anchorMs = toDate(forecast.anchorTimestamp).getTime();
    const horizonMs = horizonMinutes * 60 * 1000;
    return forecast.samples.filter((sample) => toDate(sample.timestamp).getTime() <= anchorMs + horizonMs);
  }, [forecast, horizonMinutes]);

  const combinedData = useMemo<LineGraphData>(() => {
    if (!forecast || forecastSamples.length === 0) return { datasets: [] };
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    const boundary = dataPoints.length;
    const datasets: LineGraphData['datasets'] = [];

    for (const m of METRICS) {
      const color = resolveCssColor(m.def.color);
      // One dataset per metric so `index` tooltips stay aligned across the
      // recorded and forecast regions; `segment` styles the forecast portion.
      const data = [
        ...dataPoints.map((p) => ({ x: toDate(p.timestamp).getTime(), y: m.actual(p) })),
        ...forecastSamples.map((s) => ({ x: toDate(s.timestamp).getTime(), y: m.forecast(s) })),
      ];
      const isForecast = (ctx: ScriptableLineSegmentContext) => ctx.p0DataIndex >= boundary - 1;

      datasets.push({
        label: m.shortLabel,
        data,
        parsing: false,
        normalized: true,
        borderColor: color,
        backgroundColor: 'transparent',
        yAxisID: m.axis,
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        pointRadius,
        pointHoverRadius: 4,
        segment: {
          borderColor: (ctx: ScriptableLineSegmentContext) => (isForecast(ctx) ? fade(color, 0.55) : color),
          borderDash: (ctx: ScriptableLineSegmentContext) => (isForecast(ctx) ? [6, 4] : undefined),
        },
      });
    }

    return { datasets } as LineGraphData;
  }, [dataPoints, forecast, forecastSamples]);

  const axisWindow = useMemo(() => {
    if (dataPoints.length === 0) return null;
    const points = [
      ...dataPoints.map((p) => ({ x: toDate(p.timestamp).getTime() })),
      ...forecastSamples.map((s) => ({ x: toDate(s.timestamp).getTime() })),
    ];
    return computeAxisWindow(points);
  }, [dataPoints, forecastSamples]);

  const combinedConfig: LineGraphConfig = useMemo(() => {
    const boundary = dataPoints.length;
    const scales: Record<string, unknown> = {
      x: {
        type: 'linear',
        ...(axisWindow ? { min: axisWindow.initialMin, max: axisWindow.initialMax } : {}),
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: {
          color: 'hsl(180, 1%, 53%)',
          maxTicksLimit: 8,
          callback: (value: string | number) => {
            const d = new Date(Number(value));
            return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          },
        },
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: { display: true, text: '°C', color: 'hsl(180, 1%, 53%)' },
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: { display: true, text: '%', color: 'hsl(180, 1%, 53%)' },
        grid: { drawOnChartArea: false },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      },
      y2: {
        type: 'linear',
        display: true,
        position: 'right',
        title: { display: true, text: 'hPa', color: 'hsl(180, 1%, 53%)' },
        grid: { drawOnChartArea: false },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      },
    };

    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      font: { family: "'DM Sans', sans-serif" },
      animation: { duration: 250 },
      transitions: {
        zoom: { animation: { duration: 0 } },
        active: { animation: { duration: 0 } },
      },
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
          callbacks: {
            title: (items: { parsed: { x: number | null } }[]) => {
              const x = items[0]?.parsed?.x;
              return typeof x === 'number'
                ? new Date(x).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : '';
            },
            label: (item: { datasetIndex: number; dataIndex: number; parsed: { y: number | null } }) => {
              const metric = METRICS[item.datasetIndex];
              if (!metric) return '';
              const value = item.parsed.y;
              if (value === null || !Number.isFinite(value)) return '';
              const region = item.dataIndex >= boundary ? 'forecast' : 'recorded';
              return `${metric.shortLabel} (${region}): ${value.toFixed(1)} ${metric.unit}`;
            },
          },
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
          ...(axisWindow
            ? {
                limits: {
                  x: { min: axisWindow.limitMin, max: axisWindow.limitMax, minRange: FORECAST_MAX_ZOOM_IN_MS },
                },
              }
            : {}),
        },
      },
      scales: scales as LineGraphConfig['scales'],
    };
  }, [axisWindow, dataPoints.length]);

  if (locked) {
    return (
      <div className="forecast-tab forecast-tab--locked">
        <p className="forecast-tab__locked-message">Forecasts are available for Plus &amp; Ultra plans.</p>
        <Button variant="primary" onClick={() => onNavigate?.('subscription')}>
          Go to subscription
        </Button>
      </div>
    );
  }

  const horizonOptions = [
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
];

const historyOptions = [
  { value: '24h', label: '24h' },
  { value: '2d', label: '2d' },
  { value: '7d', label: '7d' },
  { value: '2w', label: '2w' },
];

  return (
    <div className={`forecast-tab ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="devices__graphs-controls" onContextMenu={(e) => e.preventDefault()}>
        <div className="forecast-tab__control-group">
          <span className="forecast-tab__control-label">Forecast horizon</span>
          <div className="devices__period-selector" role="group" aria-label="Forecast horizon">
            {horizonOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`devices__control-btn ${horizonMinutes === option.value ? 'is-active' : ''}`}
                onClick={() => setHorizonMinutes(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="forecast-tab__control-group">
          <span className="forecast-tab__control-label">History used</span>
          <div className="devices__period-selector" role="group" aria-label="History used for forecast">
            {historyOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`devices__control-btn ${historyPeriod === option.value ? 'is-active' : ''}`}
                onClick={() => setHistoryPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Button variant="primary" onClick={() => void calculate()} isLoading={loading}>
          Calculate forecast
        </Button>
      </div>

      {loading ? (
        <div className="forecast-tab forecast-tab--loading">
          <div className="forecast-tab__progress">
            <div className="forecast-tab__progress-bar" style={{ width: `${progress}%` }} />
          </div>
          <p className="forecast-tab__progress-caption">Calculating forecast… {progress}%</p>
        </div>
      ) : error ? (
        <div className="forecast-tab forecast-tab--error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      ) : !forecast || forecast.samples.length === 0 ? (
        <div className="forecast-tab forecast-tab--empty">
          <p>Select a horizon and click &quot;Calculate forecast&quot; to generate a prediction.</p>
        </div>
      ) : (
        <>
          <div className="forecast-tab__chart-card">
            <div className={`forecast-tab__chart-container ${isFullscreen ? 'devices__chart-container' : ''}`}>
              <LineGraph data={combinedData} config={combinedConfig} />
            </div>
          </div>
          <p className="forecast-tab__caption">
            Solid lines show recorded telemetry; dashed lines show the forecast up to {horizonMinutes >= 60 ? `${horizonMinutes / 60}h` : `${horizonMinutes}m`} ahead.
            Scroll to zoom and drag to pan.
          </p>
        </>
      )}
    </div>
  );
}

export default ForecastTab;
