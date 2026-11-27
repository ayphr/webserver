import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
import type { ScriptableLineSegmentContext } from 'chart.js';
import type { DataPoint, DeviceForecastPayload, ForecastSample } from '@common';
import { forecastFromHistory, forecastHorizons, FORECAST_STEP_SECONDS } from '@common';
import { api } from '../../lib/api';
import { toDate } from '../../lib/date';
import { Button, ProgressBar } from '../common';
import { LineGraph } from '../graphs';
import type { LineGraphConfig, LineGraphData } from '../graphs/types';
import { getSeriesDefinition } from '../../lib/series';
import { CHART_COLORS, createLineGraphConfig, fade, resolveCssColor } from '../../lib/chartTheme';
import './ForecastTab.css';

type Props = {
  serial: number;
  locked: boolean;
  onNavigate?: (tab: string) => void;
  isFullscreen?: boolean;
};

const FORECAST_MAX_ZOOM_IN_MS = 60 * 1000;
const FORECAST_ZOOM_OUT_PADDING = 0.02;

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
  const [horizonMinutes, setHorizonMinutes] = useState(360);
  const [historyPeriod, setHistoryPeriod] = useState('7d');
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
      // One dataset per metric keeps index tooltips aligned across recorded and
      // forecast regions; `segment` styles only the forecast portion.
      const data = [
        ...dataPoints.map((p) => ({ x: toDate(p.timestamp).getTime(), y: m.actual(p) })),
        ...forecastSamples.map((s) => ({ x: toDate(s.timestamp).getTime(), y: m.forecast(s) })),
      ];
      const isForecastSegment = (ctx: ScriptableLineSegmentContext) => ctx.p0DataIndex >= boundary - 1;

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
        borderDash: [],
        pointStyle: m.def.pointStyle,
        pointRadius,
        pointHoverRadius: 4,
        segment: {
          borderColor: (ctx: ScriptableLineSegmentContext) => (isForecastSegment(ctx) ? fade(color, 0.7) : color),
          borderDash: (ctx: ScriptableLineSegmentContext) => (isForecastSegment(ctx) ? [6, 4] : []),
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
    const scales: Record<string, unknown> = {
      x: {
        type: 'linear',
        ...(axisWindow ? { min: axisWindow.initialMin, max: axisWindow.initialMax } : {}),
        grid: { color: resolveCssColor(CHART_COLORS.grid) },
        ticks: {
          color: resolveCssColor(CHART_COLORS.mutedText),
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
        title: { display: true, text: '°C', color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { color: resolveCssColor(CHART_COLORS.grid) },
        ticks: { color: resolveCssColor(CHART_COLORS.mutedText) },
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: { display: true, text: '%', color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { drawOnChartArea: false },
        ticks: { color: resolveCssColor(CHART_COLORS.mutedText) },
      },
      y2: {
        type: 'linear',
        display: true,
        position: 'right',
        title: { display: true, text: 'hPa', color: resolveCssColor(CHART_COLORS.mutedText) },
        grid: { drawOnChartArea: false },
        ticks: { color: resolveCssColor(CHART_COLORS.mutedText) },
      },
    };

    return {
      ...createLineGraphConfig({
        showLegend: true,
        styledLegend: true,
        zoomMinRange: FORECAST_MAX_ZOOM_IN_MS,
        zoomWindow: axisWindow,
        enableDecimation: false,
        tooltipCallbacks: {
          title: (items) => {
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
          label: (item) => {
            const metric = METRICS[item.datasetIndex];
            if (!metric) return '';
            const value = item.parsed.y;
            if (value === null || !Number.isFinite(value)) return '';
            return `${metric.shortLabel}: ${value.toFixed(1)} ${metric.unit}`;
          },
        },
      }),
      scales: scales as LineGraphConfig['scales'],
    };
  }, [axisWindow]);

  if (locked) {
    return (
      <div className="forecast-tab forecast-tab--locked">
        <p className="forecast-tab__locked-message">Forecasts are available for Plus &amp; Ultra plans.</p>
        <Button variant="primary" onClick={() => onNavigate?.('credits')}>
          Go to subscription
        </Button>
      </div>
    );
  }

  const horizonOptions = [
  { value: 60, label: '1h' },
  { value: 180, label: '3h' },
  { value: 360, label: '6h' },
  { value: 720, label: '12h' },
  { value: 1440, label: '24h' },
];

const historyOptions = [
  { value: '3d', label: '3d' },
  { value: '7d', label: '7d' },
  { value: '2w', label: '2w' },
  { value: '2mo', label: '2mo' },
];

  return (
    <div className={`forecast-tab${isFullscreen ? ' is-fullscreen' : ''}`}>
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
        <div className="forecast-tab__calculate">
          <Button variant="primary" onClick={() => void calculate()} isLoading={loading}>
            Calculate forecast
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="forecast-tab forecast-tab--loading">
          <div className="forecast-tab__progress">
            <ProgressBar value={progress} />
          </div>
          <p className="forecast-tab__progress-caption">Calculating forecast… {progress}%</p>
        </div>
      ) : error ? (
        <div className="forecast-tab forecast-tab--error">
          <IconAlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
          <span>{error}</span>
        </div>
      ) : !forecast || forecast.samples.length === 0 ? (
        <div className="forecast-tab forecast-tab--empty">
          <p>Select a horizon and click &quot;Calculate forecast&quot; to generate a prediction.</p>
        </div>
      ) : (
        <>
          <div className="forecast-tab__chart-card">
            <div className={`forecast-tab__chart-container${isFullscreen ? ' forecast-tab__chart-container--fullscreen' : ''}`}>
              <LineGraph data={combinedData} config={combinedConfig} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ForecastTab;
