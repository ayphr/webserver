import type { DataPoint } from '@common';
import { FORECAST_HORIZON_SECONDS, FORECAST_STEP_SECONDS } from '@common';
import { ForecastEngine } from './engine';
import type { ForecastOutput } from './types';

/** Evenly spaced forecast horizons from one step out to the full horizon. */
export function forecastHorizons(
  horizonSeconds = FORECAST_HORIZON_SECONDS,
  stepSeconds = FORECAST_STEP_SECONDS,
): number[] {
  const horizons: number[] = [];
  for (let horizon = stepSeconds; horizon <= horizonSeconds; horizon += stepSeconds) {
    horizons.push(horizon);
  }
  return horizons;
}

export type ForecastFromHistoryOptions = {
  horizons?: number[];
  shortCapacity?: number;
  mediumCapacity?: number;
  longCapacity?: number;
};

/**
 * Replays recent history through a fresh engine and returns the ensemble
 * forecast. Stateless by design: the caller supplies the warm-up window.
 */
export function forecastFromHistory(
  points: DataPoint[],
  options: ForecastFromHistoryOptions = {},
): ForecastOutput | null {
  const engine = new ForecastEngine({
    horizons: options.horizons ?? forecastHorizons(),
    shortCapacity: options.shortCapacity,
    mediumCapacity: options.mediumCapacity,
    longCapacity: options.longCapacity,
  });

  for (const point of points) {
    engine.ingest({
      timestamp: point.timestamp.getTime(),
      temperature: point.temperature,
      humidity: point.humidity,
      pressure: point.airPressure,
    });
  }

  return engine.forecast();
}

export * from './engine';
export * from './types';
export * from './reconstruct';
export * from './arbitrator';
