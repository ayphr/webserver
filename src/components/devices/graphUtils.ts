import type { DataPoint } from '@common';

export const GRAPH_INITIAL_WINDOW_MS = 10 * 60 * 1000;
export const GRAPH_INITIAL_MIN_SAMPLES = 5;
export const GRAPH_MAX_ZOOM_IN_MS = 30 * 1000;
export const GRAPH_ZOOM_OUT_PADDING = 0.02;
export const GRAPH_INITIAL_HEADROOM = 0.1;

export type GraphWindow = {
  initialMin: number;
  initialMax: number;
  limitMin: number;
  limitMax: number;
};

export function formatChartLabel(value: Date | string, period: string): string {
  const d = value instanceof Date ? value : new Date(value);
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (period === '1h' || period === '24h') {
    return time;
  }
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

export function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return value;
  const name = value.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || value;
}

export function computeGapThreshold(points: DataPoint[]): number | undefined {
  if (points.length < 3) return undefined;
  const times = points
    .map((p) => (p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime()))
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

export function computeGraphWindow(points: DataPoint[]): GraphWindow | null {
  if (points.length === 0) return null;
  const times = points
    .map((p) => (p.timestamp instanceof Date ? p.timestamp.getTime() : new Date(p.timestamp).getTime()))
    .sort((a, b) => a - b);
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

  let initialMin = extentMax - GRAPH_INITIAL_WINDOW_MS;
  let firstVisible = times.findIndex((t) => t >= initialMin);

  if (firstVisible < 0) firstVisible = times.length - 1;

  if (times.length - firstVisible < GRAPH_INITIAL_MIN_SAMPLES) {
    initialMin = times[Math.max(0, times.length - GRAPH_INITIAL_MIN_SAMPLES)];
  }

  initialMin = Math.min(initialMin, extentMax - GRAPH_MAX_ZOOM_IN_MS);
  initialMin = Math.max(initialMin, extentMin);

  const initialMax = extentMax + (extentMax - initialMin) * GRAPH_INITIAL_HEADROOM;
  const padding = (extentMax - extentMin) * GRAPH_ZOOM_OUT_PADDING;
  return {
    initialMin,
    initialMax,
    limitMin: extentMin - padding,
    limitMax: Math.max(extentMax + padding, initialMax),
  };
}

export function createMetricConfig(
  unit: string,
  showAxes: boolean,
  period: string,
  zoomWindow: GraphWindow | null,
): Record<string, unknown> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    font: {
      family: "'DM Sans', sans-serif",
    },
    animation: { duration: 250 },
    transitions: {
      zoom: { animation: { duration: 0 } },
      active: { animation: { duration: 0 } },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      decimation: {
        enabled: true,
        algorithm: 'lttb' as const,
        samples: 300,
        threshold: 350,
      },
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(18, 18, 20, 0.96)',
        titleColor: 'hsla(180, 67%, 99%, 1)',
        bodyColor: 'hsl(180, 1%, 53%)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items: { parsed: { x: number | null } }[]) => {
            const x = items[0]?.parsed?.x;
            return typeof x === 'number' ? formatChartLabel(new Date(x), period) : '';
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
        ...(zoomWindow
          ? {
              limits: {
                x: { min: zoomWindow.limitMin, max: zoomWindow.limitMax, minRange: GRAPH_MAX_ZOOM_IN_MS },
              },
            }
          : {}),
      },
    },
    scales: {
      x: {
        type: 'linear' as const,
        ...(zoomWindow ? { min: zoomWindow.initialMin, max: zoomWindow.initialMax } : {}),
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: {
          color: 'hsl(180, 1%, 53%)',
          maxTicksLimit: 8,
          callback: (value: string | number) => formatChartLabel(new Date(Number(value)), period),
        },
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
  };
}

// (SeriesDefinition is imported from ../../lib/series by consumers)