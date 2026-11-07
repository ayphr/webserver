import { forwardRef } from 'react';
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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LineGraph = forwardRef<any, LineGraphProps>(function LineGraph({ data, config }, ref) {
  return <Line ref={ref} options={config as ChartOptions<'line'>} data={data as ChartData<'line'>} />;
});
