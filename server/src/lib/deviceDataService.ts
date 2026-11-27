import type { DataPoint, PlanFeatures, QueryType } from '@common';
import { parseTimestamp } from './deviceValidation';

export function resolveDeviceTimeRange(
  period: string,
  fromParam?: string | null,
  toParam?: string | null,
  now = Date.now(),
): { since?: Date; until?: Date } {
  let since: Date | undefined;
  let until: Date | undefined;

  if (fromParam) {
    const parsed = parseTimestamp(fromParam);
    if (parsed) since = parsed;
  } else {
    const periods: Record<string, number | undefined> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '2d': 2 * 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '2w': 14 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '2mo': 60 * 24 * 60 * 60 * 1000,
      all: undefined,
    };
    const duration = Object.hasOwn(periods, period) ? periods[period] : periods['24h'];
    since = duration === undefined ? undefined : new Date(now - duration);
  }

  if (toParam) {
    const parsed = parseTimestamp(toParam);
    if (parsed) until = parsed;
  }

  return { since, until };
}

type QueryRateFeatures = {
  queryCostCredits: number;
  boostedQueryCostCredits?: number;
};

export function getQueryCreditRate(features: QueryRateFeatures, type: QueryType = 'standard'): number {
  if (type === 'boost') return features.boostedQueryCostCredits ?? features.queryCostCredits;
  return features.queryCostCredits;
}

export function calculateQueryCreditCost(
  computeUnits: number,
  features: QueryRateFeatures,
  type: QueryType = 'standard',
): number {
  return Math.max(0.1, computeUnits * getQueryCreditRate(features, type));
}

export function calculateDataFillCreditCost(
  pointCount: number,
  features: Pick<PlanFeatures, 'dataFillCreditCostPerThousandPoints'>,
): number {
  return Math.max(0.1, (pointCount / 1000) * features.dataFillCreditCostPerThousandPoints);
}

export function* generateSyntheticDataPointBatches(
  startMs: number,
  count: number,
  intervalSeconds: number,
  batchSize = 5_000,
): Generator<DataPoint[]> {
  const intervalMs = Math.round(intervalSeconds * 1000);
  const dtHours = intervalSeconds / 3600;
  const walkScale = Math.sqrt(dtHours);
  let tempBaseline = 19 + (Math.random() - 0.5) * 4;
  let humidityBaseline = 58 + (Math.random() - 0.5) * 10;
  let pressure = 1013 + (Math.random() - 0.5) * 12;
  let pressureVelocity = 0;
  let tempNoise = 0;
  let humidityNoise = 0;

  for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, count);
    const points: DataPoint[] = [];

    for (let i = batchStart; i < batchEnd; i += 1) {
      const date = new Date(startMs + i * intervalMs);
      const hourOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
      const diurnalPhase = ((hourOfDay - 15) / 24) * 2 * Math.PI;
      const diurnalTemp = 3.8 * Math.cos(diurnalPhase) + 0.7 * Math.cos(2 * diurnalPhase);

      tempBaseline += ((19 - tempBaseline) * 0.02 * dtHours) + (Math.random() - 0.5) * 0.5 * walkScale;
      humidityBaseline += ((58 - humidityBaseline) * 0.02 * dtHours) + (Math.random() - 0.5) * 1.8 * walkScale;
      pressureVelocity = pressureVelocity * 0.96 + ((1013 - pressure) * 0.002 * dtHours) + (Math.random() - 0.5) * 0.25 * walkScale;
      pressure = Math.max(980, Math.min(1042, pressure + pressureVelocity));
      tempNoise = tempNoise * 0.7 + (Math.random() - 0.5) * 0.18;
      humidityNoise = humidityNoise * 0.7 + (Math.random() - 0.5) * 0.6;

      const pressureAnomaly = pressure - 1013;
      const rawTemp = tempBaseline + diurnalTemp + pressureAnomaly * 0.08 + tempNoise;
      const rawHumidity = humidityBaseline - diurnalTemp * 2.2 - pressureAnomaly * 0.45 + humidityNoise;

      points.push({
        timestamp: date,
        temperature: Math.round(rawTemp * 10) / 10,
        humidity: Math.round(Math.max(15, Math.min(99, rawHumidity)) * 10) / 10,
        airPressure: Math.round(pressure * 10) / 10,
      });
    }

    yield points;
  }
}
