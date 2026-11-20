import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconRefresh, IconSparkle2 } from '@tabler/icons-react';
import type { AssistantMetricsPayload } from '@common';
import { api } from '../../lib/api';
import { LineGraph } from '../graphs';
import type { LineGraphConfig, LineGraphData } from '../graphs/types';
import './AssistantMetricsPanel.css';

const PERIOD_OPTIONS = [7, 30, 90] as const;

const numberFormat = new Intl.NumberFormat('en-GB');

function formatNumber(value: number): string {
  return numberFormat.format(Math.round(value));
}

function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

function chartColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

type CountTableProps = {
  title: string;
  rows: ReadonlyArray<{ label: string; count: number }>;
};

function CountTable({ title, rows }: CountTableProps) {
  return (
    <section className="assistant-metrics__card">
      <h3>{title}</h3>
      <table className="assistant-metrics__table">
        <caption className="assistant-metrics__sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{formatNumber(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AssistantMetricsPanel() {
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [metrics, setMetrics] = useState<AssistantMetricsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await api.assistant.getMetrics(periodDays, signal);
      if (!signal?.aborted) setMetrics(payload);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Failed to load assistant metrics');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [periodDays]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const chartData = useMemo<LineGraphData>(() => {
    const daily = metrics?.daily ?? [];
    return {
      labels: daily.map((day) => day.date),
      datasets: [
        {
          label: 'Streams',
          data: daily.map((day) => day.streams),
          borderColor: chartColor('--accent-purple-solid', 'hsl(270, 70%, 60%)'),
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: daily.length > 31 ? 0 : 2,
          borderWidth: 2,
        },
        {
          label: 'Messages',
          data: daily.map((day) => day.messages),
          borderColor: chartColor('--accent-cyan-solid', 'hsl(190, 85%, 50%)'),
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: daily.length > 31 ? 0 : 2,
          borderWidth: 2,
        },
        {
          label: 'Tokens',
          data: daily.map((day) => day.tokens),
          borderColor: chartColor('--accent-yellow-solid', 'hsl(41, 99%, 59%)'),
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: daily.length > 31 ? 0 : 2,
          borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    };
  }, [metrics]);

  const chartConfig = useMemo<LineGraphConfig>(() => {
    const tickColor = chartColor('--text-muted', 'hsl(180, 1%, 53%)');
    const gridColor = chartColor('--border-subtle', 'hsl(0, 0%, 20%)');
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: tickColor, boxWidth: 14 },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label ?? '',
            label: (item) => {
              const value = item.parsed.y;
              return `${item.dataset.label ?? ''}: ${value === null ? '—' : formatNumber(value)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false, color: gridColor },
          ticks: { color: tickColor, maxTicksLimit: 10 },
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: tickColor, precision: 0 },
          title: { display: true, text: 'Activity', color: tickColor },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: { color: tickColor, precision: 0 },
          title: { display: true, text: 'Tokens', color: tickColor },
        },
      },
    };
  }, []);

  const statCards = useMemo(() => {
    if (!metrics) return [];
    const { totals, duration } = metrics;
    return [
      { label: 'Events', value: formatNumber(totals.events) },
      { label: 'Streams', value: formatNumber(totals.streams) },
      { label: 'Messages', value: formatNumber(totals.messages) },
      { label: 'Tokens', value: formatNumber(totals.tokens) },
      { label: 'Cost proxy', value: formatNumber(totals.costProxy) },
      { label: 'Avg response', value: formatDuration(duration.averageMs) },
      { label: 'P95 response', value: formatDuration(duration.p95Ms) },
      { label: 'Thinking steps', value: formatNumber(totals.thinkingSteps) },
      { label: 'Tool calls', value: formatNumber(totals.toolCalls) },
      { label: 'Errors', value: formatNumber(totals.errors) },
      { label: 'Cancelled', value: formatNumber(totals.cancelled) },
      { label: 'Active chats', value: formatNumber(totals.activeChats) },
      { label: 'Active folders', value: formatNumber(totals.activeFolders) },
      { label: 'Feedback (likes / dislikes)', value: `${formatNumber(totals.likes)} / ${formatNumber(totals.dislikes)}` },
    ];
  }, [metrics]);

  return (
    <section className="assistant-metrics" aria-labelledby="assistant-metrics-heading" aria-busy={isLoading}>
      <header className="assistant-metrics__header">
        <div>
          <h2 id="assistant-metrics-heading">
            <IconSparkle2 size={20} /> Assistant metrics
          </h2>
          <p>Iris usage for your account over the selected period.</p>
        </div>
        <div className="assistant-metrics__controls">
          <label htmlFor="assistant-metrics-period">Period</label>
          <select
            id="assistant-metrics-period"
            value={periodDays}
            onChange={(event) => setPeriodDays(Number(event.target.value))}
          >
            {PERIOD_OPTIONS.map((days) => (
              <option key={days} value={days}>Last {days} days</option>
            ))}
          </select>
          <button
            type="button"
            className="assistant-metrics__refresh"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="Refresh assistant metrics"
          >
            <IconRefresh size={16} />
            Refresh
          </button>
        </div>
      </header>

      <p className="assistant-metrics__status" role="status" aria-live="polite">
        {isLoading ? 'Loading assistant metrics…' : error ? `Error: ${error}` : ''}
      </p>

      {!isLoading && !error && metrics?.totals.events === 0 && (
        <div className="assistant-metrics__empty">
          <IconSparkle2 size={28} />
          <h3>No assistant metrics yet</h3>
          <p>Send an Iris message to start collecting usage, performance, and feedback metrics.</p>
        </div>
      )}

      {!isLoading && !error && metrics && metrics.totals.events > 0 && (
        <>
          <div className="assistant-metrics__stats">
            {statCards.map((card) => (
              <div className="assistant-metrics__stat" key={card.label}>
                <span className="assistant-metrics__stat-label">{card.label}</span>
                <strong className="assistant-metrics__stat-value">{card.value}</strong>
              </div>
            ))}
          </div>

          <section className="assistant-metrics__card assistant-metrics__chart" aria-labelledby="assistant-metrics-chart-heading">
            <h3 id="assistant-metrics-chart-heading">Daily activity</h3>
            <div className="assistant-metrics__chart-canvas" role="img" aria-label="Line chart of daily assistant streams, messages, and tokens">
              <LineGraph data={chartData} config={chartConfig} />
            </div>
          </section>

          <div className="assistant-metrics__grid">
            <CountTable title="By mode" rows={Object.entries(metrics.byMode).map(([label, count]) => ({ label, count }))} />
            <CountTable title="By variant" rows={Object.entries(metrics.byVariant).map(([label, count]) => ({ label, count }))} />
            <CountTable title="By feedback" rows={Object.entries(metrics.byFeedback).map(([label, count]) => ({ label, count }))} />
            <CountTable title="By role" rows={Object.entries(metrics.byRole).map(([label, count]) => ({ label, count }))} />
            <CountTable title="By result" rows={Object.entries(metrics.byResult).map(([label, count]) => ({ label, count }))} />
            <CountTable title="Thinking steps" rows={Object.entries(metrics.thinkingByStatus).map(([label, count]) => ({ label, count }))} />
            <CountTable title="Tool calls" rows={Object.entries(metrics.toolsByStatus).map(([label, count]) => ({ label, count }))} />
            <CountTable title="Top tools" rows={metrics.topTools.map((tool) => ({ label: tool.name, count: tool.count }))} />
          </div>

          <section className="assistant-metrics__card">
            <h3>Response duration</h3>
            <ul className="assistant-metrics__list">
              <li><span>Samples</span><strong>{formatNumber(metrics.duration.count)}</strong></li>
              <li><span>Total</span><strong>{formatDuration(metrics.duration.totalMs)}</strong></li>
              <li><span>Average</span><strong>{formatDuration(metrics.duration.averageMs)}</strong></li>
              <li><span>Median (P50)</span><strong>{formatDuration(metrics.duration.p50Ms)}</strong></li>
              <li><span>P95</span><strong>{formatDuration(metrics.duration.p95Ms)}</strong></li>
              <li><span>Minimum</span><strong>{formatDuration(metrics.duration.minMs)}</strong></li>
              <li><span>Maximum</span><strong>{formatDuration(metrics.duration.maxMs)}</strong></li>
            </ul>
          </section>

          <section className="assistant-metrics__card">
            <h3>Errors</h3>
            {Object.entries(metrics.byError).length === 0 ? (
              <p className="assistant-metrics__note">No errors recorded.</p>
            ) : (
              <ul className="assistant-metrics__list">
                {Object.entries(metrics.byError)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <li key={code}>
                      <span>{code}</span>
                      <strong>{formatNumber(count)}</strong>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
