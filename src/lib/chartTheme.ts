/** Shared Chart.js palette so every graph uses the same theme. */
export const CHART_COLORS = {
  tooltipBackground: 'rgba(18, 18, 18, 0.96)',
  tooltipTitle: 'hsla(180, 67%, 99%, 1)',
  mutedText: 'hsl(180, 1%, 53%)',
  border: 'rgba(255, 255, 255, 0.15)',
  grid: 'rgba(255, 255, 255, 0.08)',
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

export type ChartTooltipCallbacks = {
  title?: (items: Array<{ parsed: { x: number | null } }>) => string;
  label?: (item: { datasetIndex: number; dataIndex: number; parsed: { y: number | null } }) => string;
};

export type LineGraphConfigOptions = {
  showLegend: boolean;
  /** Adds the top-positioned, themed legend labels used by multi-axis graphs. */
  styledLegend?: boolean;
  zoomMinRange: number;
  zoomWindow?: ChartZoomWindow | null;
  tooltipCallbacks?: ChartTooltipCallbacks;
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
          ? { position: 'top' as const, labels: { color: CHART_COLORS.tooltipTitle, boxWidth: 16, padding: 14 } }
          : {}),
      },
      tooltip: {
        backgroundColor: CHART_COLORS.tooltipBackground,
        titleColor: CHART_COLORS.tooltipTitle,
        bodyColor: CHART_COLORS.mutedText,
        borderColor: CHART_COLORS.border,
        borderWidth: 1,
        padding: 10,
        callbacks: tooltipCallbacks ?? {},
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
