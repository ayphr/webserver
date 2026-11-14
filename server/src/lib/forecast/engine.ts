import {
  absoluteHumidity,
  actualVapourPressure,
  clamp,
  dewPointTemperature,
  enthalpy,
  mixingRatio,
  moistAirDensity,
  saturationVapourPressure,
  vapourPressureDeficit,
  wetBulbTemperature,
} from '@common';
import type {
  AlgorithmContext,
  ForecastAlgorithm,
  ForecastHorizon,
  ForecastOutput,
  ForecastTriple,
  ReconstructedForecast,
  SensorInput,
  StateFrame,
} from './types';
import { RingBuffer } from './ringBuffer';
import { CusumDetector, detectPeriods, savitzkyGolay, type SmoothedSample } from './signal';
import { createAlgorithmBank } from './algorithms';
import { Arbitrator } from './arbitrator';
import { reconstructForecast } from './reconstruct';
import { frameValue, series, seriesTimes } from './algorithms/helpers';

const SMOOTHING_WINDOW = 8;
const PERIODICITY_INTERVAL = 64;
const PERIODICITY_MIN_SAMPLES = 128;
const CONFIDENCE_Z = 1.96;
const DERIVATIVE_FLOOR = [1e-3, 1e-7, 1e-3];
const PRESSURE_MIN = 1;
const PRESSURE_MAX = 2000;

export type ForecastEngineOptions = {
  /** Horizons in seconds ahead of the anchor to predict. */
  horizons: number[];
  shortCapacity?: number;
  mediumCapacity?: number;
  longCapacity?: number;
};

function buildSmoothed(
  historyValues: number[],
  historyTimes: number[],
  current: number,
  currentTime: number,
): SmoothedSample {
  const window = Math.min(historyValues.length, SMOOTHING_WINDOW);
  const values = historyValues.slice(historyValues.length - window).concat(current);
  const times = historyTimes.slice(historyTimes.length - window).concat(currentTime);
  return savitzkyGolay(values, times);
}

/**
 * Deterministic, online, constant-memory forecast engine. Feed it observations
 * oldest-first with `ingest`, then read the ensemble forecast with `forecast`.
 * It keeps no cross-request state; a fresh instance replays recent history.
 */
export class ForecastEngine {
  private readonly short: RingBuffer<StateFrame>;
  private readonly medium: RingBuffer<StateFrame>;
  private readonly long: RingBuffer<StateFrame>;
  private readonly algorithms: ForecastAlgorithm[];
  private readonly arbitrator: Arbitrator;
  private readonly horizons: number[];
  private readonly detectors = [0, 1, 2].map(() => new CusumDetector());
  private readonly previousRaw = [Number.NaN, Number.NaN, Number.NaN];

  private lastSeconds: number | null = null;
  private lastMs: number | null = null;
  private meanDt = 60;
  private sampleCount = 0;
  private periods: number[] = [];
  private currentFrame: StateFrame | null = null;
  private lastPredictions: ForecastTriple[][] = [];

  constructor(options: ForecastEngineOptions) {
    this.horizons = options.horizons.slice().sort((a, b) => a - b);
    this.short = new RingBuffer(options.shortCapacity ?? 32, () => this.createEmptyFrame());
    this.medium = new RingBuffer(options.mediumCapacity ?? 512, () => this.createEmptyFrame());
    this.long = new RingBuffer(options.longCapacity ?? 2048, () => this.createEmptyFrame());
    this.algorithms = createAlgorithmBank();
    this.arbitrator = new Arbitrator(
      this.algorithms.map((algorithm) => algorithm.id),
      this.horizons,
    );
  }

  get sampleCountValue(): number {
    return this.sampleCount;
  }

  private createEmptyFrame(): StateFrame {
    return {
      timestamp: 0,
      dt: 0,
      temperature: Number.NaN,
      humidity: Number.NaN,
      pressure: Number.NaN,
      saturationVapourPressure: Number.NaN,
      actualVapourPressure: Number.NaN,
      dewPoint: Number.NaN,
      vapourPressureDeficit: Number.NaN,
      mixingRatio: Number.NaN,
      absoluteHumidity: Number.NaN,
      enthalpy: Number.NaN,
      wetBulb: Number.NaN,
      moistAirDensity: Number.NaN,
      smoothedTemperature: Number.NaN,
      temperatureRate: 0,
      temperatureAcceleration: 0,
      smoothedMixingRatio: Number.NaN,
      mixingRatioRate: 0,
      mixingRatioAcceleration: 0,
      smoothedPressure: Number.NaN,
      pressureRate: 0,
      pressureAcceleration: 0,
      temperatureNoise: 0,
      mixingRatioNoise: 0,
      pressureNoise: 0,
      isChangepoint: false,
      dominantPeriods: [],
    };
  }

  private buildContext(frame: StateFrame, dt: number): AlgorithmContext {
    return {
      now: frame.timestamp,
      dt,
      meanDt: this.meanDt,
      sampleCount: this.sampleCount,
      frame,
      short: this.short,
      medium: this.medium,
      long: this.long,
      periods: this.periods,
    };
  }

  /** Validates and folds one observation into the engine. Returns false if rejected. */
  ingest(input: SensorInput): boolean {
    const seconds = input.timestamp / 1000;
    const temperature = input.temperature;
    const humidity = clamp(input.humidity, 0, 100);
    const pressure = input.pressure;

    if (!Number.isFinite(seconds) || !Number.isFinite(temperature) || !Number.isFinite(humidity)) {
      return false;
    }
    if (!Number.isFinite(pressure) || pressure < PRESSURE_MIN || pressure > PRESSURE_MAX) {
      return false;
    }
    if (this.lastSeconds !== null && seconds <= this.lastSeconds) return false;

    const dt = this.lastSeconds === null ? this.meanDt : seconds - this.lastSeconds;
    if (this.lastSeconds !== null) this.meanDt = 0.9 * this.meanDt + 0.1 * dt;

    const historyValues = [0, 1, 2].map((v) => series(this.short, (frame) => frameValue(frame, v)));
    const historyTimes = seriesTimes(this.short);

    const mixingRatioValue = mixingRatio(temperature, humidity, pressure);
    const raw = [temperature, mixingRatioValue, pressure];
    const smoothed = [0, 1, 2].map((v) =>
      buildSmoothed(historyValues[v]!, historyTimes, raw[v]!, seconds),
    );

    let changepoint = false;
    for (let v = 0; v < 3; v += 1) {
      const previous = this.previousRaw[v]!;
      if (Number.isFinite(previous) && this.detectors[v]!.update(raw[v]! - previous)) {
        changepoint = true;
      }
    }

    this.sampleCount += 1;
    if (this.sampleCount % PERIODICITY_INTERVAL === 0 && this.medium.size >= PERIODICITY_MIN_SAMPLES) {
      const values = series(this.medium, (frame) => frame.temperature);
      const times = seriesTimes(this.medium);
      const detected = detectPeriods(values, times);
      if (detected.length > 0) this.periods = detected;
    }

    const frame: StateFrame = {
      timestamp: seconds,
      dt,
      temperature,
      humidity,
      pressure,
      saturationVapourPressure: saturationVapourPressure(temperature),
      actualVapourPressure: actualVapourPressure(temperature, humidity),
      dewPoint: dewPointTemperature(temperature, humidity),
      vapourPressureDeficit: vapourPressureDeficit(temperature, humidity),
      mixingRatio: mixingRatioValue,
      absoluteHumidity: absoluteHumidity(temperature, humidity),
      enthalpy: enthalpy(temperature, humidity, pressure),
      wetBulb: wetBulbTemperature(temperature, humidity),
      moistAirDensity: moistAirDensity(temperature, humidity, pressure),
      smoothedTemperature: smoothed[0]!.value,
      temperatureRate: smoothed[0]!.first,
      temperatureAcceleration: smoothed[0]!.second,
      smoothedMixingRatio: smoothed[1]!.value,
      mixingRatioRate: smoothed[1]!.first,
      mixingRatioAcceleration: smoothed[1]!.second,
      smoothedPressure: smoothed[2]!.value,
      pressureRate: smoothed[2]!.first,
      pressureAcceleration: smoothed[2]!.second,
      temperatureNoise: smoothed[0]!.residualVariance,
      mixingRatioNoise: smoothed[1]!.residualVariance,
      pressureNoise: smoothed[2]!.residualVariance,
      isChangepoint: changepoint,
      dominantPeriods: this.periods,
    };

    this.short.push(frame);
    this.medium.push(frame);
    this.long.push(frame);
    for (let v = 0; v < 3; v += 1) this.previousRaw[v] = raw[v]!;

    const ctx = this.buildContext(frame, dt);
    this.arbitrator.observe(frame);

    for (const algorithm of this.algorithms) {
      algorithm.update(ctx);
      if (changepoint) algorithm.shock?.(ctx);
    }

    const predictions = this.algorithms.map((algorithm) => algorithm.predict(this.horizons, ctx));

    // Sanitise implausible extrapolations so a single unstable expert cannot
    // corrupt the ensemble blend or the deferred scoring ledger.
    for (const perAlgorithm of predictions) {
      for (const triple of perAlgorithm) {
        if (!Number.isFinite(triple.temperature) || triple.temperature < -200 || triple.temperature > 200) {
          triple.temperature = Number.NaN;
        }
        if (!Number.isFinite(triple.mixingRatio) || triple.mixingRatio < 0 || triple.mixingRatio > 1) {
          triple.mixingRatio = Number.NaN;
        }
        if (!Number.isFinite(triple.pressure) || triple.pressure < 1 || triple.pressure > 2000) {
          triple.pressure = Number.NaN;
        }
      }
    }

    this.arbitrator.pushPredictions(seconds, predictions);

    this.lastPredictions = predictions;
    this.currentFrame = frame;
    this.lastSeconds = seconds;
    this.lastMs = input.timestamp;
    return true;
  }

  private uncertainty(
    triple: ForecastTriple,
    variance: number[],
    point: ReconstructedForecast,
  ): Record<keyof ReconstructedForecast, number> {
    const fields = Object.keys(point) as (keyof ReconstructedForecast)[];
    const std = [0, 1, 2].map((v) => Math.sqrt(Math.max(variance[v] ?? 0, 0)));
    const result = {} as Record<keyof ReconstructedForecast, number>;
    const values = [triple.temperature, triple.mixingRatio, triple.pressure];

    for (const field of fields) {
      let total = 0;
      for (let v = 0; v < 3; v += 1) {
        const step = Math.max(std[v]! * 0.5, DERIVATIVE_FLOOR[v]!);
        const plus = values.slice();
        const minus = values.slice();
        plus[v] = plus[v]! + step;
        minus[v] = minus[v]! - step;
        const high = reconstructForecast(plus[0]!, plus[1]!, plus[2]!)[field];
        const low = reconstructForecast(minus[0]!, minus[1]!, minus[2]!)[field];
        const derivative = (high - low) / (2 * step);
        total += derivative * derivative * Math.max(variance[v] ?? 0, 0);
      }
      result[field] = Math.sqrt(Math.max(total, 0));
    }
    return result;
  }

  /** Produces the ensemble forecast, or null when too little history is available. */
  forecast(): ForecastOutput | null {
    const frame = this.currentFrame;
    if (!frame || this.sampleCount < 3 || this.lastPredictions.length === 0 || this.lastMs === null) {
      return null;
    }

    const anchorMs = this.lastMs;
    const horizons: ForecastHorizon[] = this.horizons.map((horizonSeconds, index) => {
      const { triple, variance } = this.arbitrator.blend(index, this.lastPredictions);
      const point = reconstructForecast(triple.temperature, triple.mixingRatio, triple.pressure);
      const uncertainty = this.uncertainty(triple, variance, point);
      const lower = {} as Record<keyof ReconstructedForecast, number>;
      const upper = {} as Record<keyof ReconstructedForecast, number>;
      for (const field of Object.keys(point) as (keyof ReconstructedForecast)[]) {
        lower[field] = point[field] - CONFIDENCE_Z * uncertainty[field];
        upper[field] = point[field] + CONFIDENCE_Z * uncertainty[field];
      }
      return {
        horizonSeconds,
        targetTimestamp: anchorMs + horizonSeconds * 1000,
        point,
        uncertainty,
        lower,
        upper,
      };
    });

    return {
      generatedAt: Date.now(),
      anchorTimestamp: anchorMs,
      activeRegime: {
        dominantPeriods: this.periods,
        changepoint: frame.isChangepoint,
        topAlgorithms: this.arbitrator.topAlgorithms(this.horizons.length - 1, 3),
      },
      horizons,
    };
  }
}
