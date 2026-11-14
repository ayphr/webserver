import type { DataPoint } from '../types';
import { FORECAST_HORIZON_SECONDS, FORECAST_STEP_SECONDS } from '../types';
import { ForecastEngine } from './engine';
import type { ForecastOutput } from './types';

/**
 * Horizons in seconds ahead of the anchor, sampled more densely near term and
 * progressively less often as the horizon grows. The step starts at
 * `stepSeconds` and grows geometrically so distant, less certain predictions
 * cost fewer samples. The full horizon is always included.
 */
export function forecastHorizons(
  horizonSeconds = FORECAST_HORIZON_SECONDS,
  stepSeconds = FORECAST_STEP_SECONDS,
  growth = 1.1,
): number[] {
  const horizons: number[] = [];
  if (!(horizonSeconds > 0) || !(stepSeconds > 0)) return horizons;

  let horizon = 0;
  let step = stepSeconds;
  while (horizon + step < horizonSeconds) {
    horizon += step;
    horizons.push(Math.round(horizon));
    step *= growth;
  }

  const last = horizons[horizons.length - 1];
  if (last !== horizonSeconds) horizons.push(Math.round(horizonSeconds));
  return horizons;
}

export type ForecastFromHistoryOptions = {
  horizons?: number[];
  shortCapacity?: number;
  mediumCapacity?: number;
  longCapacity?: number;
  /** Called with progress in [0, 1] as history is replayed. */
  onProgress?: (progress: number) => void;
};

/**
 * Replays recent history through a fresh engine and returns the ensemble
 * forecast. Stateless by design: the caller supplies the warm-up window.
 */
export async function forecastFromHistory(
  points: DataPoint[],
  options: ForecastFromHistoryOptions = {},
): Promise<ForecastOutput | null> {
  const engine = new ForecastEngine({
    horizons: options.horizons ?? forecastHorizons(),
    shortCapacity: options.shortCapacity,
    mediumCapacity: options.mediumCapacity,
    longCapacity: options.longCapacity,
  });

  const total = points.length;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    engine.ingest({
      timestamp: point.timestamp.getTime(),
      temperature: point.temperature,
      humidity: point.humidity,
      pressure: point.airPressure,
    });
    if (options.onProgress && (i % 16 === 0 || i === points.length - 1)) {
      options.onProgress((i + 1) / Math.max(total, 1));
      // Yield to the event loop so the UI can paint progress.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }
  if (options.onProgress) options.onProgress(1);

  return engine.forecast();
}

export * from './engine';
export * from './types';
export * from './reconstruct';
export * from './arbitrator';
