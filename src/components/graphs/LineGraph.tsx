import { useMemo } from 'react';
import { useTooltip } from '../../context';
import type { LineGraphProps } from './types';
import './LineGraph.css';

const WIDTH = 960;
const HEIGHT = 360;
const PADDING = { top: 20, right: 18, bottom: 34, left: 42 };
const COLORS = ['var(--accent-green-solid)', 'var(--accent-yellow-solid)', 'var(--text-primary)'];

function getPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

export function LineGraph({ data, config }: Readonly<LineGraphProps>) {
  const { showTooltip, hideTooltip } = useTooltip();
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const pointsByDataset = useMemo(
    () =>
      data.datasets.map((dataset) => {
        const minValue = Math.min(...dataset.data);
        const maxValue = Math.max(...dataset.data);
        const range = maxValue - minValue || 1;
        return dataset.data.map((value, index) => ({
          x: PADDING.left + (index / Math.max(data.labels.length - 1, 1)) * chartWidth,
          y: PADDING.top + (1 - (value - minValue) / range) * chartHeight,
          value,
          label: data.labels[index] ?? '',
        }));
      }),
    [chartHeight, chartWidth, data.datasets, data.labels],
  );

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={`line-graph ${config?.className ?? ''}`}>
      {data.datasets.length > 1 && (
        <div className="line-graph__legend">
          {data.datasets.map((dataset, index) => (
            <span key={dataset.label} className="line-graph__legend-item">
              <span className="line-graph__legend-line" style={{ backgroundColor: dataset.borderColor ?? COLORS[index % COLORS.length] }} />
              {dataset.label}
            </span>
          ))}
        </div>
      )}
      <svg
        className="line-graph__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${data.datasets.map((dataset) => dataset.label).join(', ')} over time`}
      >
        {gridLines.map((position) => {
          const y = PADDING.top + position * chartHeight;
          return (
            <g key={position}>
              <line className="line-graph__grid" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} />
              {config?.showAxisLabels !== false && data.datasets.length === 1 && (
                <text className="line-graph__axis-label" x={PADDING.left - 8} y={y + 3} textAnchor="end">
                  {formatValue(Math.max(...data.datasets[0].data) - position * (Math.max(...data.datasets[0].data) - Math.min(...data.datasets[0].data) || 1))}
                </text>
              )}
            </g>
          );
        })}
        <line className="line-graph__axis" x1={PADDING.left} x2={WIDTH - PADDING.right} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom} />
        {data.labels.filter((_, index) => index % Math.max(Math.ceil(data.labels.length / 6), 1) === 0).map((label, index) => {
          const sourceIndex = index * Math.max(Math.ceil(data.labels.length / 6), 1);
          const x = PADDING.left + (sourceIndex / Math.max(data.labels.length - 1, 1)) * chartWidth;
          return (
            <text key={`${label}-${sourceIndex}`} className="line-graph__axis-label" x={x} y={HEIGHT - 10} textAnchor="middle">
              {label}
            </text>
          );
        })}
        {pointsByDataset.map((points, datasetIndex) => {
          const dataset = data.datasets[datasetIndex];
          const color = dataset.borderColor ?? COLORS[datasetIndex % COLORS.length];
          return (
            <g key={dataset.label}>
              <path className="line-graph__line" d={getPath(points)} stroke={color} strokeDasharray={dataset.borderDash?.join(' ')} />
              {points.map((point, pointIndex) => (
                <circle
                  key={`${dataset.label}-${pointIndex}`}
                  className="line-graph__point"
                  cx={point.x}
                  cy={point.y}
                  r={points.length > 80 ? 2.5 : 3.5}
                  fill={color}
                  tabIndex={0}
                  aria-label={`${dataset.label}: ${formatValue(point.value)} at ${point.label}`}
                  onMouseEnter={(event) =>
                    showTooltip({
                      content: (
                        <span className="line-graph__tooltip">
                          <strong>{point.label}</strong>
                          <span>{dataset.label}: {formatValue(point.value)}</span>
                        </span>
                      ),
                      anchor: event.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onMouseLeave={hideTooltip}
                  onFocus={(event) =>
                    showTooltip({
                      content: (
                        <span className="line-graph__tooltip">
                          <strong>{point.label}</strong>
                          <span>{dataset.label}: {formatValue(point.value)}</span>
                        </span>
                      ),
                      anchor: event.currentTarget.getBoundingClientRect(),
                    })
                  }
                  onBlur={hideTooltip}
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
