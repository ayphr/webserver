import type { ChartData, ChartOptions } from 'chart.js';

export type LineGraphPoint = {
  x: number;
  y: number;
};

export type LineGraphAxisData = {
  label: string;
  data: number[] | LineGraphPoint[];
  parsing?: boolean;
  normalized?: boolean;
  spanGaps?: boolean | number;
  borderColor: string;
  backgroundColor: string;
  yAxisID?: string;
  tension?: number;
  fill?: boolean | string;
  pointRadius?: number;
  pointHoverRadius?: number;
  borderWidth?: number;
  borderDash?: number[];
};

export type LineGraphScale = {
  type?: 'linear';
  display?: boolean;
  position?: 'right' | 'left';
  grid?: {
    drawOnChartArea?: boolean;
    color?: string;
  };
  ticks?: {
    color?: string;
    maxTicksLimit?: number;
    callback?: (value: number | string) => string;
  };
  title?: {
    display?: boolean;
    text?: string;
    color?: string;
  };
  min?: number;
  max?: number;
};

export type LineGraphConfig = ChartOptions<'line'> | {
  responsive?: boolean;
  maintainAspectRatio?: boolean;
  interaction?: {
    mode?: 'index' | 'nearest' | 'point' | 'dataset' | 'x' | 'y';
    intersect?: boolean;
  };
  stacked?: boolean;
  plugins?: {
    title?: {
      display?: boolean;
      text?: string;
      color?: string;
    };
    legend?: {
      display?: boolean;
      position?: 'top' | 'bottom' | 'left' | 'right';
      labels?: {
        color?: string;
        boxWidth?: number;
      };
    };
    tooltip?: Record<string, unknown>;
  };
  scales?: Record<string, LineGraphScale>;
};

export type LineGraphData = ChartData<'line'> | {
  labels?: string[];
  datasets: LineGraphAxisData[];
};

export type LineGraphProps = {
  data: LineGraphData;
  config: LineGraphConfig;
};
