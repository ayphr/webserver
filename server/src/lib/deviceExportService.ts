import type { DataPoint, DeviceLog } from '@common';
import { createLogger } from './logger';

const log = createLogger('device-export');

export type ExportFormat = 'csv' | 'json';

/** Accepts ISO 8601 date/date-time strings, but not free-form Date.parse input. */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

export function parseIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function parseExportFormat(value: string | null): ExportFormat | null {
  if (!value) return 'csv';
  const format = value.toLowerCase();
  return format === 'csv' || format === 'json' ? format : null;
}

export function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function deviceLogsToCsv(logs: DeviceLog[]): string {
  const lines = ['timestamp,level,event,message'];
  for (const entry of logs) {
    lines.push(
      [
        new Date(entry.createdAt).toISOString(),
        entry.level,
        entry.event,
        entry.message,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function dataPointsToCsv(points: DataPoint[]): string {
  const lines = ['timestamp,temperature,humidity,airPressure'];
  for (const point of points) {
    lines.push(
      [
        new Date(point.timestamp).toISOString(),
        point.temperature,
        point.humidity,
        point.airPressure,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function fileResponse(options: {
  body: string;
  format: ExportFormat;
  filename: string;
  truncated: boolean;
}): Response {
  const headers: Record<string, string> = {
    'Content-Type': options.format === 'csv' ? 'text/csv' : 'application/json',
    'Content-Disposition': `attachment; filename="${options.filename}"`,
    'Content-Length': String(Buffer.byteLength(options.body)),
  };
  if (options.truncated) headers['X-Export-Truncated'] = '1';
  return new Response(options.body, { headers });
}

export function logExportCompleted(
  kind: 'logs' | 'data',
  serial: number,
  count: number,
  truncated: boolean,
): void {
  log.info({ kind, serial, count, truncated }, 'device export completed');
}
