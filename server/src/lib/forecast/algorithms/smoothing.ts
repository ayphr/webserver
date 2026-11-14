import { clamp } from '@common';
import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { linearSlope } from '../math';
import { dampedTrendSum, frameValue, horizonSteps, series, seriesTimes, setTriple } from './helpers';

export type ExponentialSmootherOptions = {
  id: string;
  /** Level smoothing factor in (0, 1]. */
  alpha: number;
  /** Trend smoothing factor; omit for simple exponential smoothing. */
  beta?: number;
  /** Trend damping factor in (0, 1]; defaults to 1 (undamped). */
  phi?: number;
  /** Seasonal smoothing factor; enables additive Holt-Winters when provided. */
  gamma?: number;
};

/**
 * Exponential smoothing family. A single implementation covers M10 (simple),
 * M11 (Holt linear trend), M12 (Holt damped trend) and M13 (Holt-Winters
 * additive seasonal) by varying which components are enabled.
 */
export class ExponentialSmoother implements ForecastAlgorithm {
  readonly id: string;
  private readonly level = [Number.NaN, Number.NaN, Number.NaN];
  private readonly trend = [0, 0, 0];
  private readonly seasonal: number[][] = [[], [], []];
  private seasonLength = 0;
  private readonly initialized = [false, false, false];
  private ticks = 0;

  constructor(private readonly options: ExponentialSmootherOptions) {
    this.id = options.id;
  }

  private ensureSeasonality(ctx: AlgorithmContext): void {
    if (this.options.gamma === undefined) return;
    const period = ctx.periods[0];
    if (!period || !Number.isFinite(period)) return;
    const length = clamp(Math.round(period / Math.max(ctx.meanDt, 1e-3)), 4, 1024);
    if (length === this.seasonLength) return;
    this.seasonLength = length;
    for (let v = 0; v < 3; v += 1) this.seasonal[v] = new Array<number>(length).fill(0);
  }

  update(ctx: AlgorithmContext): void {
    this.ensureSeasonality(ctx);
    const phi = this.options.phi ?? 1;
    const beta = this.options.beta ?? 0;
    const gamma = this.options.gamma ?? 0;

    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(ctx.frame, v);
      if (!Number.isFinite(value)) continue;

      if (!this.initialized[v]) {
        this.level[v] = value;
        this.trend[v] = 0;
        this.initialized[v] = true;
        continue;
      }

      const index = this.seasonLength > 0 ? this.ticks % this.seasonLength : 0;
      const season = this.seasonLength > 0 ? (this.seasonal[v]![index] ?? 0) : 0;
      const previousLevel = this.level[v]!;
      const previousTrend = this.trend[v]!;

      this.level[v] =
        this.options.alpha * (value - season) +
        (1 - this.options.alpha) * (previousLevel + phi * previousTrend);
      this.trend[v] = beta * (this.level[v]! - previousLevel) + (1 - beta) * phi * previousTrend;
      if (this.seasonLength > 0) {
        this.seasonal[v]![index] = gamma * (value - this.level[v]!) + (1 - gamma) * season;
      }
    }

    this.ticks += 1;
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    const phi = this.options.phi ?? 1;
    return horizons.map((h) => {
      const steps = horizonSteps(h, ctx.meanDt);
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        if (!this.initialized[v]) continue;
        const trendContribution =
          this.options.beta !== undefined ? this.trend[v]! * dampedTrendSum(phi, steps) : 0;
        const season =
          this.seasonLength > 0
            ? (this.seasonal[v]![(this.ticks + steps) % this.seasonLength] ?? 0)
            : 0;
        setTriple(triple, v, this.level[v]! + trendContribution + season);
      }
      return triple;
    });
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) this.initialized[v] = false;
    this.seasonLength = 0;
    this.ticks = 0;
    this.update(ctx);
  }
}

/**
 * M14 — Theta method. Blends a simple exponential smoother with half the drift
 * of an ordinary least-squares line fitted to the medium history, the classical
 * Theta(0) / Theta(2) decomposition.
 */
export class ThetaMethod implements ForecastAlgorithm {
  readonly id = 'M14';
  private readonly level = [Number.NaN, Number.NaN, Number.NaN];
  private readonly slope = [0, 0, 0];
  private readonly initialized = [false, false, false];

  constructor(private readonly alpha = 0.5) {}

  update(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(ctx.frame, v);
      if (!Number.isFinite(value)) continue;

      if (!this.initialized[v]) {
        this.level[v] = value;
        this.initialized[v] = true;
      } else {
        this.level[v] = this.alpha * value + (1 - this.alpha) * this.level[v]!;
      }

      const values = series(ctx.medium, (frame) => frameValue(frame, v));
      const times = seriesTimes(ctx.medium);
      this.slope[v] = values.length >= 3 ? linearSlope(values, times) : 0;
    }
  }

  predict(horizons: number[]): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        if (!this.initialized[v]) continue;
        setTriple(triple, v, this.level[v]! + 0.5 * this.slope[v]! * h);
      }
      return triple;
    });
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) this.initialized[v] = false;
    this.update(ctx);
  }
}
