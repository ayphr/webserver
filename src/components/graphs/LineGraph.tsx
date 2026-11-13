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
  Decimation,
  type Chart,
  type ChartOptions,
  type ChartData,
} from 'chart.js';
import type { LineGraphProps } from './types';
import ZoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';

ChartJS.register(ZoomPlugin);
ChartJS.register(Decimation);
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

export const LineGraph = forwardRef<Chart<'line'> | undefined, LineGraphProps>(function LineGraph({ data, config }, ref) {
  return <Line ref={ref} options={config as ChartOptions<'line'>} data={data as ChartData<'line'>} />;
});
