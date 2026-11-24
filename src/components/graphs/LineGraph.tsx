import { forwardRef, useId } from 'react';
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

type AccessibleLineGraphProps = LineGraphProps & {
  /** Short name announced for the canvas. */
  ariaLabel?: string;
  /** Longer text alternative describing the trend or key values. */
  summary?: string;
};

function describeDatasets(data: LineGraphProps['data']): string {
  const datasets = (data as { datasets?: Array<{ label?: string; data?: unknown[] }> }).datasets ?? [];
  const labels = datasets
    .map((dataset) => dataset.label)
    .filter((label): label is string => Boolean(label && label.trim()));
  const pointCount = datasets.reduce((total, dataset) => total + (dataset.data?.length ?? 0), 0);
  return labels.length > 0
    ? `Line chart with ${labels.join(', ')}. ${pointCount} plotted values.`
    : `Line chart with ${datasets.length} data series and ${pointCount} plotted values.`;
}

export const LineGraph = forwardRef<Chart<'line'> | undefined, AccessibleLineGraphProps>(function LineGraph(
  { data, config, ariaLabel, summary },
  ref,
) {
  const descriptionId = useId();
  const fallbackDescription = describeDatasets(data);
  const label = ariaLabel ?? fallbackDescription;
  const description = summary ?? fallbackDescription;

  return (
    <div className="line-graph" role="group" aria-label={label} aria-describedby={descriptionId}>
      <Line
        ref={ref}
        options={config as ChartOptions<'line'>}
        data={data as ChartData<'line'>}
        role="img"
        aria-label={label}
        aria-describedby={descriptionId}
      />
      <p id={descriptionId} className="sr-only">{description}</p>
    </div>
  );
});
