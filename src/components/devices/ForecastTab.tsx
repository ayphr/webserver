import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';
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

export function ForecastTab({ serial, locked, onNavigate, isFullscreen }: Props) {
  const [forecast, setForecast] = useState<DeviceForecastPayload | null>(null);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [horizonMinutes, setHorizonMinutes] = useState(60);
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
        const dp = await api.devices.getDataPoints(serial, { period: '24h' });
        if (cancelled) return;
        setDataPoints(dp.dataPoints ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load telemetry');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serial, locked]);

  const calculate = useCallback(async () => {
    if (locked) return;
    setLoading(true);
    setError(null);
    setForecast(null);
    setProgress(0);
    try {
      let pts = dataPoints;
      if (pts.length === 0) {
        const dp = await api.devices.getDataPoints(serial, { period: '24h' });
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
  }, [serial, locked, horizonMinutes, dataPoints]);

  // Reset calculated forecast when horizon changes so stale results aren't shown.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForecast(null);
  }, [horizonMinutes]);

  const combinedData = useMemo<LineGraphData>(() => {
    if (!forecast) return { datasets: [] };
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    const datasets: LineGraphData['datasets'] = [];

    for (const m of METRICS) {
      const color = resolveCssColor(m.def.color);
      datasets.push({
        label: `${m.def.shortLabel} (actual)`,
        data: dataPoints.map((p) => ({ x: toDate(p.timestamp).getTime(), y: m.actual(p) })),
        parsing: false,
        normalized: true,
        borderColor: color,
        backgroundColor: 'transparent',
        yAxisID: m.axis,
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: [],
        pointRadius,
        pointHoverRadius: 4,
      });
    }

    const anchorMs = toDate(forecast.anchorTimestamp).getTime();
    const horizonMs = horizonMinutes * 60 * 1000;
    const forecastSamples = forecast.samples.filter((sample) => toDate(sample.timestamp).getTime() <= anchorMs + horizonMs);

    for (const m of METRICS) {
      const color = resolveCssColor(m.def.color);
      datasets.push({
        label: `${m.def.shortLabel} (forecast)`,
        data: forecastSamples.map((s) => ({ x: toDate(s.timestamp).getTime(), y: m.forecast(s) })),
        parsing: false,
        normalized: true,
        borderColor: fade(color, 0.5),
        backgroundColor: 'transparent',
        yAxisID: m.axis,
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 3,
      });
    }

    return { datasets } as LineGraphData;
  }, [dataPoints, forecast, horizonMinutes]);

  const combinedConfig: LineGraphConfig = useMemo(() => {
    const scales: Record<string, unknown> = {
      x: {
        type: 'linear',
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
                ? new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : '';
            },
          },
        },
      },
      scales: scales as LineGraphConfig['scales'],
    };
  }, []);

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

  const horizonOptions = [30, 60, 120, 360, 720];

  return (
    <div className={`forecast-tab ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="devices__graphs-controls" onContextMenu={(e) => e.preventDefault()}>
        <div className="devices__period-selector" role="group" aria-label="Forecast horizon">
          {horizonOptions.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className={`devices__control-btn ${horizonMinutes === minutes ? 'is-active' : ''}`}
              onClick={() => setHorizonMinutes(minutes)}
            >
              {minutes < 60 ? `${minutes}m` : minutes === 60 ? '1h' : minutes === 120 ? '2h' : minutes === 360 ? '6h' : '12h'}
            </button>
          ))}
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
          </p>
        </>
      )}
    </div>
  );
}

export default ForecastTab;