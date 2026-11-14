import { useMemo } from 'react';
import type { DataPoint } from '@common';
import type { LineGraphConfig, LineGraphData } from '../graphs/types';
import type { SeriesDefinition } from '../../lib/series';
import type { DevicePeriod } from '../../lib/devicePeriod';
import { resolveCssColor, computeGapThreshold, computeGraphWindow, GRAPH_MAX_ZOOM_IN_MS, formatChartLabel, createMetricConfig } from './graphUtils';

export type GraphMode = 'combined' | 'separate' | 'summary';

export function useDeviceGraphs(
  dataPoints: DataPoint[],
  enabledDefs: SeriesDefinition[],
  period: DevicePeriod,
  showAxes: boolean,
) {
  const gapThreshold = useMemo(() => computeGapThreshold(dataPoints), [dataPoints]);
  const graphWindow = useMemo(() => computeGraphWindow(dataPoints), [dataPoints]);

  const unitGroups = useMemo(() => Array.from(new Set(enabledDefs.map((d) => d.unit))), [enabledDefs]);

  const unitToScaleId = useMemo(() => {
    const map = new Map<string, string>();
    unitGroups.forEach((unit, i) => {
      map.set(unit, i === 0 ? 'y' : `y${i}`);
    });
    return map;
  }, [unitGroups]);

  const combinedData: LineGraphData = useMemo(() => {
    const pointRadius = dataPoints.length > 80 ? 0 : 2;
    return {
      datasets: enabledDefs.map((def) => ({
        label: def.label,
        data: dataPoints.map((p) => ({
          x: (p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp)).getTime(),
          y: def.getValue(p),
        })),
        parsing: false,
        normalized: true,
        spanGaps: gapThreshold,
        borderColor: resolveCssColor(def.color),
        backgroundColor: 'transparent',
        yAxisID: unitToScaleId.get(def.unit) ?? 'y',
        tension: 0.25,
        fill: false,
        borderWidth: 2,
        borderDash: def.dash,
        pointRadius,
        pointHoverRadius: 4,
      })),
    };
  }, [dataPoints, enabledDefs, unitToScaleId, gapThreshold]);

  const combinedConfig: LineGraphConfig = useMemo(() => {
    const scales: Record<string, unknown> = {
      x: {
        type: 'linear',
        ...(graphWindow ? { min: graphWindow.initialMin, max: graphWindow.initialMax } : {}),
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: {
          color: 'hsl(180, 1%, 53%)',
          maxTicksLimit: 8,
          callback: (value: string | number) => formatChartLabel(new Date(Number(value)), period),
        },
      },
    };
    unitGroups.forEach((unit, i) => {
      const id = i === 0 ? 'y' : `y${i}`;
      scales[id] = {
        type: 'linear',
        display: showAxes,
        position: i === 0 ? 'left' : 'right',
        title: { display: showAxes, text: unit, color: 'hsl(180, 1%, 53%)' },
        grid: i === 0 ? { color: 'rgba(255, 255, 255, 0.08)' } : { drawOnChartArea: false },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      };
    });
    if (unitGroups.length === 0) {
      scales.y = {
        type: 'linear',
        display: showAxes,
        position: 'left',
        title: { display: showAxes, text: '', color: 'hsl(180, 1%, 53%)' },
        grid: { color: 'rgba(255, 255, 255, 0.08)' },
        ticks: { color: 'hsl(180, 1%, 53%)' },
      };
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
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
          display: true,
          position: 'top' as const,
          labels: { color: 'hsla(180, 67%, 99%, 1)', boxWidth: 16, padding: 14 },
        },
        tooltip: {
          backgroundColor: 'rgba(18, 18, 20, 0.96)',
          titleColor: 'hsla(180, 67%, 99%, 1)',
          bodyColor: 'hsl(180, 1%, 53%)',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items: { parsed: { x: number | null } }[]) => {
              const x = items[0]?.parsed?.x;
              return typeof x === 'number' ? formatChartLabel(new Date(x), period) : '';
            },
          },
        },
        zoom: {
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
          },
          pan: {
            enabled: true,
            mode: 'x',
          },
          ...(graphWindow
            ? {
                limits: {
                  x: { min: graphWindow.limitMin, max: graphWindow.limitMax, minRange: GRAPH_MAX_ZOOM_IN_MS },
                },
              }
            : {}),
        },
      },
      scales: scales as LineGraphConfig['scales'],
    };
  }, [unitGroups, showAxes, period, graphWindow]);

  const separateCharts = useMemo(
    () =>
      enabledDefs.map((def) => ({
        def,
        data: {
          datasets: [
            {
              label: def.label,
              data: dataPoints.map((p) => ({
                x: (p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp)).getTime(),
                y: def.getValue(p),
              })),
              parsing: false,
              normalized: true,
              spanGaps: gapThreshold,
              borderColor: resolveCssColor(def.color),
              backgroundColor: 'transparent',
              tension: 0.25,
              fill: false,
              borderWidth: 2,
              borderDash: def.dash,
              pointRadius: dataPoints.length > 80 ? 0 : 2,
              pointHoverRadius: 4,
            },
          ],
        },
        config: createMetricConfig(def.unit, showAxes, period, graphWindow),
      })),
    [dataPoints, period, enabledDefs, showAxes, gapThreshold, graphWindow],
  );

  return { gapThreshold, graphWindow, unitGroups, unitToScaleId, combinedData, combinedConfig, separateCharts };
}