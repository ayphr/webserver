import type { ReactNode } from 'react';

export type LineGraphAxisData = {
  label: string;
  data: number[];
  borderColor?: string;
  borderDash?: number[];
};

export type LineGraphData = {
  labels: string[];
  datasets: LineGraphAxisData[];
};

export type LineGraphConfig = {
  unit?: string;
  className?: string;
  showAxisLabels?: boolean;
  children?: ReactNode;
};

export type LineGraphProps = {
  data: LineGraphData;
  config?: LineGraphConfig;
};
