import { describe, expect, test } from 'bun:test';
import type { DataPoint, DeviceLog } from '@common';
import {
  csvCell,
  dataPointsToCsv,
  deviceLogsToCsv,
  fileResponse,
  parseExportFormat,
  parseIsoTimestamp,
} from './deviceExportService';

describe('device export helpers', () => {
  test('accepts ISO timestamps and rejects free-form dates', () => {
    expect(parseIsoTimestamp('2026-01-02T03:04:05.678Z')?.toISOString()).toBe('2026-01-02T03:04:05.678Z');
    expect(parseIsoTimestamp('2026-01-02T03:04+02:00')?.toISOString()).toBe('2026-01-02T01:04:00.000Z');
    expect(parseIsoTimestamp('2026-01-02')?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(parseIsoTimestamp('Jan 2, 2026')).toBeNull();
    expect(parseIsoTimestamp(1234)).toBeNull();
    expect(parseIsoTimestamp('not-a-date')).toBeNull();
  });

  test('defaults to csv and only accepts supported formats', () => {
    expect(parseExportFormat(null)).toBe('csv');
    expect(parseExportFormat('JSON')).toBe('json');
    expect(parseExportFormat('xml')).toBeNull();
  });

  test('escapes CSV cells containing delimiters or quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  test('writes log and data point CSV with stable headers', () => {
    const logEntry: DeviceLog = {
      id: 'log-1',
      serial: 42,
      event: 'upload_error',
      level: 'error',
      message: 'disk full, retry later',
      createdAt: new Date('2026-01-02T03:04:05.000Z'),
    };
    const point: DataPoint = {
      timestamp: new Date('2026-01-02T03:04:05.000Z'),
      temperature: 21.5,
      humidity: 48,
      airPressure: 1013.2,
    };

    expect(deviceLogsToCsv([logEntry])).toBe(
      'timestamp,level,event,message\n'
      + '2026-01-02T03:04:05.000Z,error,upload_error,"disk full, retry later"\n',
    );
    expect(dataPointsToCsv([point])).toBe(
      'timestamp,temperature,humidity,airPressure\n'
      + '2026-01-02T03:04:05.000Z,21.5,48,1013.2\n',
    );
  });

  test('builds a download response with attachment and truncation headers', async () => {
    const response = fileResponse({
      body: 'timestamp\n',
      format: 'csv',
      filename: 'device-42-logs.csv',
      truncated: true,
    });

    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="device-42-logs.csv"');
    expect(response.headers.get('X-Export-Truncated')).toBe('1');
    expect(await response.text()).toBe('timestamp\n');
  });
});
