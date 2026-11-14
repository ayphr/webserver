import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { matVec, solveLeastSquares, zeros } from '../math';
import { frameValue, series, seriesTimes, setTriple } from './helpers';

type HarmonicModel = {
  /** Evaluation origin (last fitted timestamp). */
  origin: number;
  /** Characteristic time scale used to normalise the linear trend. */
  timeScale: number;
  periods: number[];
  coefficients: number[];
};

/** Least-squares fit of a linear trend plus sinusoids at the given periods. */
function fitTrendHarmonics(values: number[], times: number[], periods: number[]): HarmonicModel | null {
  const n = values.length;
  if (n < 4) return null;

  const origin = times[n - 1]!;
  const duration = Math.max(1, times[n - 1]! - times[0]!);
  const timeScale = duration;
  const design = times.map((time) => {
    const delta = (time - origin) / timeScale;
    const row = [1, delta];
    for (const period of periods) {
      const omega = (2 * Math.PI * timeScale) / Math.max(period, 1e-6);
      row.push(Math.sin(omega * delta), Math.cos(omega * delta));
    }
    return row;
  });

  const coefficients = solveLeastSquares(design, values, 1e-2);
  if (coefficients.some((coefficient) => !Number.isFinite(coefficient))) return null;
  if (coefficients.some((coefficient) => Math.abs(coefficient) > 1e6)) return null;
  return { origin, timeScale, periods, coefficients };
}

function evaluateHarmonic(model: HarmonicModel, time: number): number {
  const delta = (time - model.origin) / model.timeScale;
  let value = model.coefficients[0]! + model.coefficients[1]! * delta;
  for (let k = 0; k < model.periods.length; k += 1) {
    const omega = (2 * Math.PI * model.timeScale) / Math.max(model.periods[k]!, 1e-6);
    value += model.coefficients[2 + 2 * k]! * Math.sin(omega * delta);
    value += model.coefficients[3 + 2 * k]! * Math.cos(omega * delta);
  }
  return value;
}

/** Chooses the periods to fit, falling back to one cycle over the window. */
function resolvePeriods(ctx: AlgorithmContext, times: number[]): number[] {
  if (ctx.periods.length > 0) return ctx.periods.slice(0, 3);
  const duration = times[times.length - 1]! - times[0]!;
  if (duration > 4 * ctx.meanDt) return [duration / 2];
  return [];
}

/** M15 — harmonic ordinary least squares (trend + detected periodicities). */
export class HarmonicOLS implements ForecastAlgorithm {
  readonly id = 'M15';
  private readonly models: (HarmonicModel | null)[] = [null, null, null];
  private tick = 0;
  private readonly window: number;
  private readonly refitEvery: number;

  constructor(
    window = 256,
    refitEvery = 4,
  ) {
    this.window = window;
    this.refitEvery = refitEvery;
  }

  update(ctx: AlgorithmContext): void {
    this.tick += 1;
    if (this.tick % this.refitEvery !== 0) return;

    const times = seriesTimes(ctx.medium, this.window);
    if (times.length < 8) return;
    const periods = resolvePeriods(ctx, times);

    for (let v = 0; v < 3; v += 1) {
      const values = series(ctx.medium, (frame) => frameValue(frame, v), this.window);
      const model = fitTrendHarmonics(values, times, periods);
      if (model) this.models[v] = model;
    }
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    const now = ctx.now;
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        const model = this.models[v];
        if (!model) continue;
        setTriple(triple, v, evaluateHarmonic(model, now + h));
      }
      return triple;
    });
  }

  reset(): void {
    this.models[0] = null;
    this.models[1] = null;
    this.models[2] = null;
    this.tick = 0;
  }
}

function hankelCovariance(values: number[], windowLength: number): { covariance: number[][]; rows: number } {
  const n = values.length;
  const rows = n - windowLength + 1;
  const covariance = zeros(windowLength, windowLength);
  for (let i = 0; i < rows; i += 1) {
    for (let a = 0; a < windowLength; a += 1) {
      const va = values[i + a]!;
      for (let b = 0; b < windowLength; b += 1) {
        covariance[a]![b] = covariance[a]![b]! + va * values[i + b]!;
      }
    }
  }
  for (let a = 0; a < windowLength; a += 1) {
    for (let b = 0; b < windowLength; b += 1) {
      covariance[a]![b] = covariance[a]![b]! / Math.max(rows, 1);
    }
  }
  return { covariance, rows };
}

/** Top eigenvectors of a symmetric matrix by power iteration with deflation. */
function leadingEigenvectors(covariance: number[][], count: number): number[][] {
  const size = covariance.length;
  const work = covariance.map((row) => row.slice());
  const vectors: number[][] = [];

  for (let k = 0; k < count; k += 1) {
    let vector = new Array<number>(size).fill(1 / Math.sqrt(size));
    for (let i = 0; i < size; i += 1) vector[i] = vector[i]! + 0.01 * Math.sin(i + 1);
    let norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    vector = vector.map((value) => value / norm);

    let eigenvalue = 0;
    for (let iteration = 0; iteration < 80; iteration += 1) {
      const next = matVec(work, vector);
      norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0));
      if (norm < 1e-12) break;
      const normalized = next.map((value) => value / norm);
      const delta = normalized.reduce((sum, value, i) => sum + Math.abs(value - vector[i]!), 0);
      vector = normalized;
      eigenvalue = norm;
      if (delta < 1e-10) break;
    }

    vectors.push(vector);
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        work[i]![j] = work[i]![j]! - eigenvalue * vector[i]! * vector[j]!;
      }
    }
  }

  return vectors;
}

/** Diagonal-averaged rank-r reconstruction of a Hankel embedding. */
function reconstruct(values: number[], windowLength: number, vectors: number[][]): number[] {
  const n = values.length;
  const rows = n - windowLength + 1;
  const totals = new Array<number>(n).fill(0);
  const counts = new Array<number>(n).fill(0);

  for (let i = 0; i < rows; i += 1) {
    const window = values.slice(i, i + windowLength);
    for (let a = 0; a < windowLength; a += 1) {
      let approximation = 0;
      for (const vector of vectors) {
        let projection = 0;
        for (let b = 0; b < windowLength; b += 1) projection += vector[b]! * window[b]!;
        approximation += vector[a]! * projection;
      }
      totals[i + a] = totals[i + a]! + approximation;
      counts[i + a] = counts[i + a]! + 1;
    }
  }

  return totals.map((total, i) => (counts[i]! > 0 ? total / counts[i]! : total));
}

/** M16 — singular spectrum analysis trend/seasonal extraction. */
export class SingularSpectrumAnalysis implements ForecastAlgorithm {
  readonly id = 'M16';
  private readonly models: (HarmonicModel | null)[] = [null, null, null];
  private tick = 0;
  private readonly window: number;
  private readonly embedding: number;
  private readonly components: number;
  private readonly refitEvery: number;

  constructor(
    window = 128,
    embedding = 20,
    components = 3,
    refitEvery = 8,
  ) {
    this.window = window;
    this.embedding = embedding;
    this.components = components;
    this.refitEvery = refitEvery;
  }

  update(ctx: AlgorithmContext): void {
    this.tick += 1;
    if (this.tick % this.refitEvery !== 0) return;

    const times = seriesTimes(ctx.medium, this.window);
    if (times.length < this.embedding * 3) return;
    const periods = resolvePeriods(ctx, times);

    for (let v = 0; v < 3; v += 1) {
      const values = series(ctx.medium, (frame) => frameValue(frame, v), this.window);
      const { covariance } = hankelCovariance(values, this.embedding);
      const vectors = leadingEigenvectors(covariance, this.components);
      const reconstructed = reconstruct(values, this.embedding, vectors);
      const model = fitTrendHarmonics(reconstructed, times, periods);
      if (model) this.models[v] = model;
    }
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        const model = this.models[v];
        if (!model) continue;
        setTriple(triple, v, evaluateHarmonic(model, ctx.now + h));
      }
      return triple;
    });
  }

  reset(): void {
    this.models[0] = null;
    this.models[1] = null;
    this.models[2] = null;
    this.tick = 0;
  }
}
