import type { RingBuffer } from './ringBuffer';

/** A raw observation as ingested by the engine. */
export type SensorInput = {
  timestamp: number;
  temperature: number;
  humidity: number;
  pressure: number;
};

/** Psychrometric and kinematic values expanded from a raw observation. */
export type StateFrame = {
  timestamp: number;
  /** Elapsed seconds since the previous accepted frame. */
  dt: number;
  temperature: number;
  humidity: number;
  pressure: number;

  saturationVapourPressure: number;
  actualVapourPressure: number;
  dewPoint: number;
  vapourPressureDeficit: number;
  /** Mixing ratio in kg/kg dry air: the mass-conserved prognostic variable. */
  mixingRatio: number;
  absoluteHumidity: number;
  enthalpy: number;
  wetBulb: number;
  moistAirDensity: number;

  /** Savitzky-Golay smoothed value and first/second time derivatives. */
  smoothedTemperature: number;
  temperatureRate: number;
  temperatureAcceleration: number;
  smoothedMixingRatio: number;
  mixingRatioRate: number;
  mixingRatioAcceleration: number;
  smoothedPressure: number;
  pressureRate: number;
  pressureAcceleration: number;

  /** Residual variance of the smoothing fit, a proxy for sensor noise. */
  temperatureNoise: number;
  mixingRatioNoise: number;
  pressureNoise: number;

  isChangepoint: boolean;
  dominantPeriods: number[];
};

/** Point forecast for the three prognostic variables at one horizon. */
export type ForecastTriple = {
  temperature: number;
  mixingRatio: number;
  pressure: number;
};

export type ForecastVariable = 'temperature' | 'mixingRatio' | 'pressure';

/** Every derived quantity reconstructed from a forecast triple. */
export type ReconstructedForecast = {
  temperature: number;
  humidity: number;
  pressure: number;
  saturationVapourPressure: number;
  actualVapourPressure: number;
  dewPoint: number;
  vapourPressureDeficit: number;
  mixingRatio: number;
  absoluteHumidity: number;
  enthalpy: number;
  wetBulb: number;
  moistAirDensity: number;
};

export type ForecastHorizon = {
  horizonSeconds: number;
  targetTimestamp: number;
  point: ReconstructedForecast;
  uncertainty: Record<keyof ReconstructedForecast, number>;
  lower: Record<keyof ReconstructedForecast, number>;
  upper: Record<keyof ReconstructedForecast, number>;
};

export type ForecastOutput = {
  generatedAt: number;
  anchorTimestamp: number;
  activeRegime: {
    dominantPeriods: number[];
    changepoint: boolean;
    topAlgorithms: string[];
  };
  horizons: ForecastHorizon[];
};

/** Shared context handed to every algorithm on each tick. */
export type AlgorithmContext = {
  now: number;
  dt: number;
  meanDt: number;
  sampleCount: number;
  frame: StateFrame;
  short: RingBuffer<StateFrame>;
  medium: RingBuffer<StateFrame>;
  long: RingBuffer<StateFrame>;
  periods: number[];
};

export interface ForecastAlgorithm {
  readonly id: string;
  /** Consume the newest frame and advance internal state. */
  update(ctx: AlgorithmContext): void;
  /** Produce point forecasts for each horizon (seconds ahead). */
  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[];
  /** Optional reaction to a detected changepoint. */
  shock?(ctx: AlgorithmContext): void;
  /** Optional full reset from the current frame. */
  reset?(ctx: AlgorithmContext): void;
}

export function emptyTriple(): ForecastTriple {
  return { temperature: Number.NaN, mixingRatio: Number.NaN, pressure: Number.NaN };
}

export function isFiniteTriple(triple: ForecastTriple): boolean {
  return (
    Number.isFinite(triple.temperature) &&
    Number.isFinite(triple.mixingRatio) &&
    Number.isFinite(triple.pressure)
  );
}
