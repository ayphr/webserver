/** Shared Chart.js palette so every graph uses the same theme. */
export const CHART_COLORS = {
  tooltipBackground: 'var(--chart-tooltip-bg)',
  tooltipTitle: 'var(--text-primary)',
  mutedText: 'var(--text-muted)',
  border: 'var(--chart-border)',
  grid: 'var(--chart-grid)',
} as const;

/** Resolves a CSS custom property (e.g. `var(--text-primary)`) to its computed value. */
export function resolveCssColor(value: string): string {
  if (!value.startsWith('var(')) return value;
  if (typeof document === 'undefined') return value;
  const name = value.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || value;
}

/** Applies an alpha channel to a color, supporting rgb/rgba/hex inputs. */
export function fade(color: string, alpha: number): string {
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

export type ChartZoomWindow = {
  initialMin: number;
  initialMax: number;
  limitMin: number;
  limitMax: number;
};

export type ChartTooltipItem = {
  datasetIndex: number;
  dataIndex: number;
  parsed: { x: number | null; y: number | null };
};

export type ChartTooltipCallbacks = {
  title?: (items: ChartTooltipItem[]) => string;
  label?: (item: ChartTooltipItem) => string;
};

export type LineGraphConfigOptions = {
  showLegend: boolean;
  /** Adds the top-positioned, themed legend labels used by multi-axis graphs. */
  styledLegend?: boolean;
  zoomMinRange: number;
  zoomWindow?: ChartZoomWindow | null;
  tooltipCallbacks?: ChartTooltipCallbacks;
  tooltipFilter?: (item: ChartTooltipItem) => boolean;
};

/**
 * Root Chart.js options shared by every device graph: animation, interaction,
 * decimation, tooltip/legend theming and zoom limits. Scales are supplied by
 * each graph because they differ per view.
 */
export function createLineGraphConfig({
  showLegend,
  styledLegend = false,
  zoomMinRange,
  zoomWindow,
  tooltipCallbacks,
  tooltipFilter,
}: LineGraphConfigOptions) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false as const,
    font: { family: "'DM Sans', sans-serif" },
    animation: { duration: 250 },
    transitions: {
      zoom: { animation: { duration: 0 } },
      active: { animation: { duration: 0 } },
    },
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      decimation: {
        enabled: true,
        algorithm: 'lttb' as const,
        samples: 300,
        threshold: 350,
      },
      legend: {
        display: showLegend,
        ...(styledLegend
          ? { position: 'top' as const, labels: { color: resolveCssColor(CHART_COLORS.tooltipTitle), boxWidth: 16, padding: 14 } }
          : {}),
      },
      tooltip: {
        backgroundColor: resolveCssColor(CHART_COLORS.tooltipBackground),
        titleColor: resolveCssColor(CHART_COLORS.tooltipTitle),
        bodyColor: resolveCssColor(CHART_COLORS.mutedText),
        borderColor: resolveCssColor(CHART_COLORS.border),
        borderWidth: 1,
        padding: 10,
        callbacks: tooltipCallbacks ?? {},
        ...(tooltipFilter ? { filter: tooltipFilter } : {}),
      },
      zoom: {
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' as const },
        pan: { enabled: true, mode: 'x' as const },
        ...(zoomWindow
          ? { limits: { x: { min: zoomWindow.limitMin, max: zoomWindow.limitMax, minRange: zoomMinRange } } }
          : {}),
      },
    },
  };
}
