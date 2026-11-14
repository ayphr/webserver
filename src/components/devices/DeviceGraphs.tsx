import { useMemo } from 'react';
import {
  IconAlertCircle,
  IconDatabase,
  IconRefresh,
} from '@tabler/icons-react';
import type { DataPoint } from '@common';
import type { DevicePeriod } from '../../lib/devicePeriod';
import type { SeriesDefinition } from '../../lib/series';
import { Checkbox, ToggleDropdown } from '../common';
import { LineGraph } from '../graphs';
import { useDeviceGraphs, type GraphMode } from './useDeviceGraphs';
export type { GraphMode };
import './DevicesPanel.css';

type Period = DevicePeriod;

type Props = {
  dataPoints: DataPoint[];
  enabledDefs: SeriesDefinition[];
  period: Period;
  onPeriodChange: (p: Period) => void;
  graphMode: GraphMode;
  onGraphModeChange: (m: GraphMode) => void;
  showAxes: boolean;
  onShowAxesChange: (v: boolean) => void;
  enabledLabels: string[];
  seriesLabels: string[];
  onSeriesChange: (labels: string[]) => void;
  isFetchingData: boolean;
  hasLoadedInitialData: boolean;
  dataError: string | null;
  precisionFor: (def: SeriesDefinition) => number;
};

const PERIODS: Period[] = ['1h', '24h', '7d', '30d', 'all'];

function periodLabel(p: Period): string {
  switch (p) {
    case '1h':
      return 'Past 1h';
    case '24h':
      return 'Past 24h';
    case '7d':
      return 'Past 7d';
    case '30d':
      return 'Past 30d';
    case 'all':
      return 'All Time';
    default:
      return '';
  }
}

export function DeviceGraphs({
  dataPoints,
  enabledDefs,
  period,
  onPeriodChange,
  graphMode,
  onGraphModeChange,
  showAxes,
  onShowAxesChange,
  enabledLabels,
  seriesLabels,
  onSeriesChange,
  isFetchingData,
  hasLoadedInitialData,
  dataError,
  precisionFor,
}: Props) {
  const { combinedData, combinedConfig, separateCharts } = useDeviceGraphs(
    dataPoints,
    enabledDefs,
    period,
    showAxes,
  );

  const seriesStats = useMemo(() => {
    if (dataPoints.length === 0 || enabledDefs.length === 0) return [];
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return enabledDefs.map((def) => {
      const values = dataPoints.map((p) => def.getValue(p));
      return {
        def,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: avg(values),
        count: dataPoints.length,
      };
    });
  }, [dataPoints, enabledDefs]);

  if (!hasLoadedInitialData && isFetchingData) {
    return (
      <div className="devices__chart-card devices__loading-box">
        <IconRefresh className="devices__spin-icon" size={24} strokeWidth={2} />
        <p>Loading telemetry history...</p>
      </div>
    );
  }

  if (dataPoints.length === 0 || enabledDefs.length === 0) {
    return (
      <div className="devices__empty">
        <IconDatabase size={28} strokeWidth={1.5} />
        <h3>{dataPoints.length === 0 ? 'No data points found' : 'No series selected'}</h3>
        <p>
          {dataPoints.length === 0
            ? 'No telemetry recorded for this device during the selected time period.'
            : 'Select at least one series from the Series dropdown to display the graph.'}
        </p>
      </div>
    );
  }

  return (
    <div className="devices__graphs">
      <div className="devices__graphs-controls" onContextMenu={(e) => e.preventDefault()}>
        <div className="devices__period-selector" role="group" aria-label="Time period">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`devices__control-btn ${period === p ? 'is-active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>

        <div className="devices__series-selector">
          <ToggleDropdown
            buttonLabel="Series"
            options={seriesLabels}
            value={enabledLabels}
            onChange={onSeriesChange}
            placeholder="Series"
          />
        </div>

        <div className="devices__axes-toggle">
          <Checkbox
            label="Y axes"
            checked={showAxes}
            onChange={(e) => onShowAxesChange(e.target.checked)}
          />
        </div>

        <div className="devices__mode-selector" role="group" aria-label="Graph display mode">
          <button
            type="button"
            className={`devices__control-btn ${graphMode === 'combined' ? 'is-active' : ''}`}
            onClick={() => onGraphModeChange('combined')}
          >
            Combined Graph
          </button>
          <button
            type="button"
            className={`devices__control-btn ${graphMode === 'separate' ? 'is-active' : ''}`}
            onClick={() => onGraphModeChange('separate')}
          >
            Separate Graphs
          </button>
          <button
            type="button"
            className={`devices__control-btn ${graphMode === 'summary' ? 'is-active' : ''}`}
            onClick={() => onGraphModeChange('summary')}
          >
            Summary
          </button>
        </div>
      </div>

      {dataError && (
        <div className="devices__error">
          <IconAlertCircle size={16} strokeWidth={1.75} />
          <span>{dataError}</span>
        </div>
      )}

      <div className={`devices__graphs-body ${isFetchingData ? 'is-updating' : ''}`}>
        {seriesStats.length > 0 && graphMode === 'summary' && (
          <div className="devices__metrics-summary">
            {seriesStats.map((s) => {
              const prec = precisionFor(s.def);
              return (
                <div className="devices__summary-col" key={s.def.id}>
                  <div className="devices__summary-header">
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: s.def.color,
                        display: 'inline-block',
                      }}
                    />
                    <span>{s.def.shortLabel}</span>
                  </div>
                  <div className="devices__summary-metrics">
                    <div>
                      <span className="summary-lbl">Min</span>
                      <span className="summary-val">
                        {s.min.toFixed(prec)} {s.def.unit}
                      </span>
                    </div>
                    <div>
                      <span className="summary-lbl">Max</span>
                      <span className="summary-val">
                        {s.max.toFixed(prec)} {s.def.unit}
                      </span>
                    </div>
                    <div>
                      <span className="summary-lbl">Avg</span>
                      <span className="summary-val">
                        {s.avg.toFixed(prec)} {s.def.unit}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="devices__summary-col">
              <div className="devices__summary-header">
                <IconDatabase size={16} strokeWidth={1.75} />
                <span>Telemetry Points</span>
              </div>
              <div className="devices__summary-metrics">
                <div>
                  <span className="summary-lbl">Range count</span>
                  <span className="summary-val">{seriesStats[0].count.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {graphMode === 'combined' ? (
          <div className="devices__chart-card">
            <div className="devices__chart-container" style={{ position: 'relative' }} onContextMenu={(e) => e.preventDefault()}>
              <LineGraph data={combinedData} config={combinedConfig} />
            </div>
          </div>
        ) : graphMode === 'separate' ? (
          <div className="devices__separate-charts">
            {separateCharts.map(({ def, data, config }) => (
              <div className="devices__chart-card" key={def.id}>
                <div className="devices__chart-header">
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: def.color,
                      display: 'inline-block',
                    }}
                  />
                  <h4>{def.label}</h4>
                </div>
                <div className="devices__chart-container devices__chart-container--separate" onContextMenu={(e) => e.preventDefault()}>
                  <LineGraph data={data} config={config as never} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default DeviceGraphs;