/**
 * Shared forecast contracts. The server runs the state-estimation engine and
 * returns a compact payload; the client renders it on top of the recent
 * telemetry history.
 */

/** Total time horizon covered by a device forecast, in seconds. */
export const FORECAST_HORIZON_SECONDS = 12 * 60 * 60;

/** Spacing between returned forecast samples, in seconds. */
export const FORECAST_STEP_SECONDS = 5 * 60;

/** Number of forecast samples returned across the horizon. */
export const FORECAST_SAMPLE_COUNT = Math.floor(FORECAST_HORIZON_SECONDS / FORECAST_STEP_SECONDS);

/** A single point of a device forecast, including ensemble uncertainty. */
export type ForecastSample = {
  timestamp: Date;
  temperature: number;
  humidity: number;
  airPressure: number;
  temperatureStd: number;
  humidityStd: number;
  airPressureStd: number;
};

export type DeviceForecastPayload = {
  serial: number;
  /** When the forecast was produced. */
  generatedAt: Date;
  /** Timestamp of the most recent real observation the forecast is anchored to. */
  anchorTimestamp: Date;
  /** Total horizon covered, in seconds. */
  horizonSeconds: number;
  /** Spacing between samples, in seconds. */
  stepSeconds: number;
  samples: ForecastSample[];
};

/** Payload returned when the user's plan does not include forecasting. */
export type DeviceForecastLockedPayload = {
  serial: number;
  locked: true;
  requiredPlans: string[];
};
