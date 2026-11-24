import { estimateTokens, redactPII } from '@common';
import {
  countDataPointsForDevice,
  getDataPointSummariesForDevices,
  getDataPointsForDevice,
} from './db';
import type { QueryAuthorDeviceData, QueryAuthorFieldSummary } from './queryAuthor';

const MAX_SUMMARIZED_DEVICES = 12;
const MAX_SAMPLED_POINTS = 6;
const MAX_STATS_POINTS = 240;
const MAX_DIGEST_TOKENS = 3_000;

type SelectedDevice = { serial: number; name?: string | null };

type QueryAuthorDataReaders = {
  summarize: typeof getDataPointSummariesForDevices;
  count: typeof countDataPointsForDevice;
  read: typeof getDataPointsForDevice;
};

const defaultReaders: QueryAuthorDataReaders = {
  summarize: getDataPointSummariesForDevices,
  count: countDataPointsForDevice,
  read: getDataPointsForDevice,
};

export type QueryAuthorDataResult = {
  devices: QueryAuthorDeviceData[];
  /** Points in the range currently selected in the editor. */
  totalPointCount: number;
  /** All-time points across the selected devices. */
  availablePointCount: number;
  availableFrom?: string;
  availableTo?: string;
};

const round = (value: number, digits = 1): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const summarizeField = (
  points: Array<{ timestamp: Date; temperature: number; humidity: number; airPressure: number }>,
  key: 'temperature' | 'humidity' | 'airPressure',
): QueryAuthorFieldSummary | undefined => {
  if (points.length === 0) return undefined;
  const values = points.map((point) => point[key]).filter(Number.isFinite);
  if (values.length === 0) return undefined;
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    latest: round(values[values.length - 1]!),
  };
};

const pickEvenly = <T>(values: T[], limit: number): T[] => {
  if (values.length <= limit) return values;
  if (limit === 1) return [values[values.length - 1]!];
  return Array.from({ length: limit }, (_, index) => (
    values[Math.round((index * (values.length - 1)) / (limit - 1))]!
  ));
};

/**
 * Builds the bounded telemetry digest Iris receives while authoring a query.
 * Device selection and team scope are resolved by the caller; this helper only
 * reads the requested devices and never lets client or model input choose them.
 * It also reports when readings exist so Iris can pick a populated time range.
 */
export async function loadQueryAuthorDeviceData(
  selected: SelectedDevice[],
  from: string,
  to: string,
  readers: QueryAuthorDataReaders = defaultReaders,
): Promise<QueryAuthorDataResult> {
  const since = new Date(from);
  const until = new Date(to);

  const availability = await readers.summarize(selected.map((device) => device.serial));
  const availabilityBySerial = new Map(availability.map((device) => [device.serial, device]));
  const availablePointCount = availability.reduce((sum, device) => sum + device.count, 0);
  const observedBounds = availability.flatMap((device) => [device.firstAt, device.lastAt])
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()));
  const availableFrom = observedBounds.length > 0
    ? new Date(Math.min(...observedBounds.map((value) => value.getTime()))).toISOString()
    : undefined;
  const availableTo = observedBounds.length > 0
    ? new Date(Math.max(...observedBounds.map((value) => value.getTime()))).toISOString()
    : undefined;

  const counts = await Promise.all(selected.map(async (device) => {
    try {
      return await readers.count(device.serial, { since, until });
    } catch {
      return 0;
    }
  }));
  const totalPointCount = counts.reduce((sum, count) => sum + count, 0);

  const summaries = await Promise.all(selected.slice(0, MAX_SUMMARIZED_DEVICES).map(
    async (device, index): Promise<QueryAuthorDeviceData> => {
      const name = redactPII(device.name?.trim() || `Device ${device.serial}`, [String(device.serial)]);
      const available = availabilityBySerial.get(device.serial);
      const base: QueryAuthorDeviceData = {
        serial: device.serial,
        name: name.slice(0, 80) || `Device ${device.serial}`,
        pointCount: counts[index] ?? 0,
        availablePointCount: available?.count ?? 0,
        availableFrom: available?.firstAt?.toISOString(),
        availableTo: available?.lastAt?.toISOString(),
      };

      const hasCurrentPoints = base.pointCount > 0;
      const sampleRange = hasCurrentPoints
        ? { since, until }
        : available?.firstAt && available.lastAt
          ? { since: available.firstAt, until: available.lastAt }
          : null;
      if (!sampleRange) return base;

      try {
        const { points } = await readers.read(device.serial, {
          ...sampleRange,
          maxPoints: MAX_STATS_POINTS,
        });
        if (points.length === 0) return base;

        return {
          ...base,
          firstAt: points[0]!.timestamp.toISOString(),
          lastAt: points[points.length - 1]!.timestamp.toISOString(),
          temperature: summarizeField(points, 'temperature'),
          humidity: summarizeField(points, 'humidity'),
          airPressure: summarizeField(points, 'airPressure'),
          sample: pickEvenly(points, MAX_SAMPLED_POINTS).map((point) => ({
            at: point.timestamp.toISOString(),
            temperature: round(point.temperature),
            humidity: round(point.humidity),
            airPressure: round(point.airPressure),
          })),
        };
      } catch {
        return { ...base, unavailable: true };
      }
    },
  ));

  const devices: QueryAuthorDeviceData[] = [];
  for (const device of summaries) {
    devices.push(device);
    if (estimateTokens(JSON.stringify(devices)) > MAX_DIGEST_TOKENS) {
      devices.pop();
      break;
    }
  }

  return { devices, totalPointCount, availablePointCount, availableFrom, availableTo };
}
