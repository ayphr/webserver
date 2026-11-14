import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { mean } from '../math';
import { frameValue, horizonSteps, setTriple } from './helpers';

/** Extrapolates `steps` samples from an AR(p) model using `history` (oldest first). */
function forecastAR(coefficients: number[], history: number[], steps: number): number {
  const p = coefficients.length;
  if (p === 0 || history.length === 0) return history[history.length - 1] ?? Number.NaN;

  const fallback = mean(history);
  const window = history.slice(-p);
  while (window.length < p) window.unshift(fallback);
  const buffer = window.slice();

  for (let s = 0; s < steps; s += 1) {
    let next = 0;
    for (let j = 0; j < p; j += 1) next += coefficients[j]! * buffer[buffer.length - 1 - j]!;
    buffer.push(next);
  }
  return buffer[buffer.length - 1]!;
}

/** Sample autocorrelations r[0..order] of a mean-removed series. */
function autocorrelations(values: number[], order: number): number[] {
  const n = values.length;
  const mu = mean(values);
  const r = new Array<number>(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag += 1) {
    let sum = 0;
    for (let i = lag; i < n; i += 1) sum += (values[i]! - mu) * (values[i - lag]! - mu);
    r[lag] = sum / n;
  }
  return r;
}

/** Levinson-Durbin recursion returning AR coefficients phi_1..phi_order. */
function levinsonDurbin(r: number[], order: number): number[] {
  const a = new Array<number>(order + 1).fill(0);
  const tmp = new Array<number>(order + 1).fill(0);
  a[0] = 1;
  let error = r[0] ?? 0;
  if (!(error > 1e-12)) return new Array<number>(order).fill(0);

  for (let i = 1; i <= order; i += 1) {
    let acc = r[i] ?? 0;
    for (let j = 1; j < i; j += 1) acc += a[j]! * (r[i - j] ?? 0);
    const reflection = -acc / error;
    for (let j = 1; j < i; j += 1) tmp[j] = a[j]! + reflection * a[i - j]!;
    tmp[i] = reflection;
    for (let j = 1; j <= i; j += 1) a[j] = tmp[j]!;
    error *= 1 - reflection * reflection;
    if (!(error > 1e-12)) break;
  }

  const coefficients = new Array<number>(order).fill(0);
  for (let j = 1; j <= order; j += 1) coefficients[j - 1] = -a[j]!;
  return coefficients;
}

/** M17 — batch AR(p) fitted with the Levinson-Durbin recursion. */
export class LevinsonAR implements ForecastAlgorithm {
  readonly id = 'M17';
  private readonly history: number[][] = [[], [], []];
  private readonly coefficients: number[][] = [[], [], []];
  private tick = 0;

  constructor(
    private readonly order = 8,
    private readonly window = 160,
    private readonly refitEvery = 4,
  ) {}

  update(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(ctx.frame, v);
      if (!Number.isFinite(value)) continue;
      const series = this.history[v]!;
      series.push(value);
      if (series.length > this.window) series.splice(0, series.length - this.window);
    }

    this.tick += 1;
    if (this.tick % this.refitEvery !== 0) return;

    for (let v = 0; v < 3; v += 1) {
      const series = this.history[v]!;
      if (series.length < this.order * 2) continue;
      const coefficients = levinsonDurbin(autocorrelations(series, this.order), this.order);
      if (coefficients.every((c) => Number.isFinite(c))) this.coefficients[v] = coefficients;
    }
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    return horizons.map((h) => {
      const steps = horizonSteps(h, ctx.meanDt);
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        const coefficients = this.coefficients[v]!;
        if (coefficients.length === 0) continue;
        setTriple(triple, v, forecastAR(coefficients, this.history[v]!, steps));
      }
      return triple;
    });
  }

  reset(): void {
    for (let v = 0; v < 3; v += 1) {
      this.history[v] = [];
      this.coefficients[v] = [];
    }
    this.tick = 0;
  }
}

type RlsState = {
  theta: number[];
  covariance: number[][];
  history: number[];
  initialized: boolean;
};

/**
 * M18 / M19 — recursive least squares AR(p) with a forgetting factor. The fast
 * variant tracks regime changes, the slow variant favours long-run stability.
 */
export class RecursiveLeastSquaresAR implements ForecastAlgorithm {
  readonly id: string;
  private readonly states: RlsState[];
  private readonly size: number;

  constructor(
    id: string,
    private readonly order = 8,
    private readonly forgetting = 0.99,
    private readonly initialCovariance = 1e3,
  ) {
    this.id = id;
    this.size = order + 1;
    this.states = [0, 1, 2].map(() => ({
      theta: new Array<number>(this.size).fill(0),
      covariance: Array.from({ length: this.size }, (_, i) =>
        Array.from({ length: this.size }, (_, j) => (i === j ? this.initialCovariance : 0)),
      ),
      history: [],
      initialized: false,
    }));
  }

  private step(state: RlsState, value: number): void {
    const p = this.order;
    const history = state.history;

    if (history.length >= p) {
      const phi = new Array<number>(this.size).fill(1);
      for (let j = 0; j < p; j += 1) phi[j] = history[history.length - 1 - j]!;

      const covariance = state.covariance;
      // pPhi = P * phi. P is kept symmetric, so phi^T P equals pPhi.
      const pPhi = phi.map((_, i) =>
        phi.reduce((sum, phij, j) => sum + phij * covariance[i]![j]!, 0),
      );
      let denominator = this.forgetting;
      for (let i = 0; i < this.size; i += 1) denominator += phi[i]! * pPhi[i]!;
      if (!(Math.abs(denominator) > 1e-12)) return;

      const gain = pPhi.map((entry) => entry / denominator);
      let prediction = 0;
      for (let i = 0; i < this.size; i += 1) prediction += state.theta[i]! * phi[i]!;
      const residual = value - prediction;
      for (let i = 0; i < this.size; i += 1) state.theta[i] = state.theta[i]! + gain[i]! * residual;

      // P <- (P - gain * phi^T * P) / lambda.
      state.covariance = covariance.map((row, i) =>
        row.map((entry, j) => (entry - gain[i]! * pPhi[j]!) / this.forgetting),
      );
    }

    history.push(value);
    if (history.length > this.order * 8) history.splice(0, history.length - this.order * 8);
    state.initialized = true;
  }

  update(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(ctx.frame, v);
      if (!Number.isFinite(value)) continue;
      this.step(this.states[v]!, value);
    }
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    return horizons.map((h) => {
      const steps = horizonSteps(h, ctx.meanDt);
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        const state = this.states[v]!;
        if (!state.initialized) continue;
        const coefficients = state.theta.slice(0, this.order);
        setTriple(triple, v, forecastAR(coefficients, state.history, steps));
      }
      return triple;
    });
  }

  reset(): void {
    for (const state of this.states) {
      state.theta = new Array<number>(this.size).fill(0);
      state.covariance = Array.from({ length: this.size }, (_, i) =>
        Array.from({ length: this.size }, (_, j) => (i === j ? this.initialCovariance : 0)),
      );
      state.history = [];
      state.initialized = false;
    }
  }
}
