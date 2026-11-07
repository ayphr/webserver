import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import type { LineGraphProps } from './types';
import { Line } from 'react-chartjs-2';
import { memo } from 'react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export const LineGraph = memo(function LineGraph({ data, config }: Readonly<LineGraphProps>) {
  return <Line options={config as ChartOptions<'line'>} data={data as ChartData<'line'>} />;
});
