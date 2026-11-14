import { relativeHumidityFromMixingRatio } from '../../utils';
import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple, StateFrame } from '../types';
import { emptyTriple } from '../types';
import { diagonal, inverse, linearSlope, matVec, mean, zeros } from '../math';
import { frameValue, recentVariance, series, seriesTimes, setTriple } from './helpers';
import { UnscentedKalmanFilter } from './ukf';

const VARIABLES = 3;

/** Relaxation time constants (seconds) for the Newton-cooling model. */
const RELAXATION_TAU = [1800, 3600, 21600];

/**
 * M07 — Newton cooling. Each prognostic variable relaxes exponentially toward
 * its long-run equilibrium, a physically motivated mean-reversion baseline.
 */
export class NewtonCooling implements ForecastAlgorithm {
  readonly id = 'M07';
  private readonly equilibrium = [Number.NaN, Number.NaN, Number.NaN];

  update(ctx: AlgorithmContext): void {
    for (let v = 0; v < VARIABLES; v += 1) {
      const values = series(ctx.long, (frame) => frameValue(frame, v), 256);
      this.equilibrium[v] = values.length >= 4 ? mean(values) : frameValue(ctx.frame, v);
    }
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < VARIABLES; v += 1) {
        const current = frameValue(ctx.frame, v);
        const equilibrium = this.equilibrium[v]!;
        if (!Number.isFinite(current) || !Number.isFinite(equilibrium)) continue;
        const tau = RELAXATION_TAU[v]!;
        setTriple(triple, v, equilibrium + (current - equilibrium) * Math.exp(-h / tau));
      }
      return triple;
    });
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < VARIABLES; v += 1) this.equilibrium[v] = Number.NaN;
    this.update(ctx);
  }
}

/**
 * M08 — coupled psychrometric unscented Kalman filter. The state carries the
 * three prognostic variables plus their rates; the measurement couples them
 * through relative humidity, which is a nonlinear function of temperature,
 * mixing ratio and pressure.
 */
export class PsychrometricUkf implements ForecastAlgorithm {
  readonly id = 'M08';
  private readonly filter = new UnscentedKalmanFilter(6);
  private initialized = false;

  private transition(dt: number): (state: number[]) => number[] {
    return (state) => [
      state[0]! + state[3]! * dt,
      Math.max(0, state[1]! + state[4]! * dt),
      state[2]! + state[5]! * dt,
      state[3]!,
      state[4]!,
      state[5]!,
    ];
  }

  update(ctx: AlgorithmContext): void {
    const temperature = ctx.frame.temperature;
    const mixingRatio = ctx.frame.mixingRatio;
    const pressure = ctx.frame.pressure;
    if (!Number.isFinite(temperature) || !Number.isFinite(mixingRatio) || !Number.isFinite(pressure)) {
      return;
    }

    const dt = Math.max(ctx.dt, 1e-3);
    const scales = [0, 1, 2].map((v) => Math.max(recentVariance(ctx.short, v, 32), 1e-8));

    if (!this.initialized) {
      const state = [temperature, mixingRatio, pressure, 0, 0, 0];
      const covariance = diagonal([
        scales[0]!, scales[1]!, scales[2]!,
        scales[0]! * 1e-4, scales[1]! * 1e-4, scales[2]! * 1e-4,
      ]);
      this.filter.initialize(state, covariance);
      this.initialized = true;
      return;
    }

    const processNoise = diagonal([
      scales[0]! * dt, scales[1]! * dt, scales[2]! * dt,
      scales[0]! * 1e-3, scales[1]! * 1e-3, scales[2]! * 1e-3,
    ]);
    this.filter.predict(this.transition(dt), processNoise);

    const observation = [temperature, ctx.frame.humidity, pressure];
    const measurementNoise = diagonal([
      Math.max(ctx.frame.temperatureNoise, 1e-4),
      Math.max(1e-3, ctx.frame.humidity * 1e-4),
      Math.max(ctx.frame.pressureNoise, 1e-4),
    ]);
    this.filter.update(
      (state) => [
        state[0]!,
        relativeHumidityFromMixingRatio(state[0]!, state[1]!, state[2]!),
        state[2]!,
      ],
      observation,
      measurementNoise,
    );
  }

  predict(horizons: number[]): ForecastTriple[] {
    if (!this.initialized) return horizons.map(() => emptyTriple());
    const state = this.filter.getMean();
    return horizons.map((h) => {
      const triple = emptyTriple();
      setTriple(triple, 0, state[0]! + state[3]! * h);
      setTriple(triple, 1, state[1]! + state[4]! * h);
      setTriple(triple, 2, state[2]! + state[5]! * h);
      return triple;
    });
  }

  reset(): void {
    this.initialized = false;
  }
}

/**
 * M09 — barometric-advective ridge. A ridge regression predicts the next
 * pressure step from the barometric tendency, the temperature rate (advection
 * proxy) and the pressure level; temperature and humidity follow a linear
 * drift. Normal equations are accumulated online so memory stays constant.
 */
export class BarometricAdvective implements ForecastAlgorithm {
  readonly id = 'M09';
  private readonly normalA = zeros(4, 4);
  private readonly normalB = new Array<number>(4).fill(0);
  private coefficients = new Array<number>(4).fill(0);
  private previous: StateFrame | null = null;
  private tick = 0;
  private readonly ridge: number;
  private readonly refitEvery: number;

  constructor(
    ridge = 1e-3,
    refitEvery = 8,
  ) {
    this.ridge = ridge;
    this.refitEvery = refitEvery;
  }

  update(ctx: AlgorithmContext): void {
    const frame = ctx.frame;
    const previous = this.previous;
    if (previous) {
      const phi = [1, previous.pressureRate, previous.temperatureRate, previous.pressure];
      const target = frame.pressure - previous.pressure;
      for (let i = 0; i < phi.length; i += 1) {
        for (let j = 0; j < phi.length; j += 1) {
          this.normalA[i]![j] = this.normalA[i]![j]! + phi[i]! * phi[j]!;
        }
        this.normalB[i] = (this.normalB[i] ?? 0) + phi[i]! * target;
      }
    }
    this.previous = frame;

    this.tick += 1;
    if (this.tick % this.refitEvery !== 0) return;
    const regularized = this.normalA.map((row, i) =>
      row.map((value, j) => value + (i === j ? this.ridge : 0)),
    );
    const solved = matVec(inverse(regularized), this.normalB);
    if (solved.every((coefficient) => Number.isFinite(coefficient))) this.coefficients = solved;
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    const frame = ctx.frame;
    const phi = [1, frame.pressureRate, frame.temperatureRate, frame.pressure];
    const pressureStep = this.coefficients.reduce((sum, coefficient, i) => sum + coefficient * phi[i]!, 0);

    const times = seriesTimes(ctx.medium);
    const temperatureSlope = linearSlope(series(ctx.medium, (f) => f.temperature), times);
    const mixingRatioSlope = linearSlope(series(ctx.medium, (f) => f.mixingRatio), times);
    const steps = (h: number) => Math.max(1, Math.round(h / Math.max(ctx.meanDt, 1e-3)));

    return horizons.map((h) => {
      const triple = emptyTriple();
      setTriple(triple, 0, frame.temperature + temperatureSlope * h);
      setTriple(triple, 1, frame.mixingRatio + mixingRatioSlope * h);
      setTriple(triple, 2, frame.pressure + pressureStep * steps(h));
      return triple;
    });
  }

  reset(): void {
    for (const row of this.normalA) row.fill(0);
    this.normalB.fill(0);
    this.coefficients = new Array<number>(4).fill(0);
    this.previous = null;
    this.tick = 0;
  }
}
