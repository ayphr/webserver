import {
  add,
  identity,
  matVec,
  multiply,
  outer,
  scale as scaleMatrix,
  transpose,
} from '../math';
import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { frameValue, recentVariance, setTriple } from './helpers';

function buildTransition(dt: number, order: number): number[][] {
  const f = identity(order);
  if (order >= 2) f[0]![1] = dt;
  if (order >= 3) {
    f[0]![2] = 0.5 * dt * dt;
    f[1]![2] = dt;
  }
  return f;
}

function buildProcessNoise(dt: number, order: number): number[][] {
  if (order === 2) {
    return [
      [dt ** 3 / 3, dt ** 2 / 2],
      [dt ** 2 / 2, dt],
    ];
  }
  return [
    [dt ** 5 / 20, dt ** 4 / 8, dt ** 3 / 6],
    [dt ** 4 / 8, dt ** 3 / 3, dt ** 2 / 2],
    [dt ** 3 / 6, dt ** 2 / 2, dt],
  ];
}

function measurementNoise(ctx: AlgorithmContext, index: number, varScale: number): number {
  const frameNoise =
    index === 0
      ? ctx.frame.temperatureNoise
      : index === 1
        ? ctx.frame.mixingRatioNoise
        : ctx.frame.pressureNoise;
  return Math.max(frameNoise, 1e-3 * varScale, 1e-10);
}

/** Constant-velocity (order 2) or constant-acceleration (order 3) Kalman filter. */
export class KinematicKalman implements ForecastAlgorithm {
  private readonly states: number[][];
  private readonly covariances: number[][][];
  private readonly initialized = [false, false, false];

  constructor(
    readonly id: string,
    private readonly order: 2 | 3,
    private readonly processNoise: number,
  ) {
    this.states = [0, 1, 2].map(() => new Array<number>(order).fill(0));
    this.covariances = [0, 1, 2].map(() => identity(order));
  }

  update(ctx: AlgorithmContext): void {
    const dt = Math.max(ctx.dt, 1e-3);
    const transition = buildTransition(dt, this.order);
    const transitionT = transpose(transition);
    const baseQ = scaleMatrix(buildProcessNoise(dt, this.order), this.processNoise);

    for (let v = 0; v < 3; v += 1) {
      const measurement = frameValue(ctx.frame, v);
      if (!Number.isFinite(measurement)) continue;

      const varScale = Math.max(recentVariance(ctx.short, v, 32), 1e-8);
      const noise = measurementNoise(ctx, v, varScale);

      if (!this.initialized[v]) {
        const state = new Array<number>(this.order).fill(0);
        state[0] = measurement;
        this.states[v] = state;
        this.covariances[v] = scaleMatrix(identity(this.order), Math.max(varScale, noise));
        this.initialized[v] = true;
        continue;
      }

      const predictedState = matVec(transition, this.states[v]!);
      const predictedCov = add(
        multiply(multiply(transition, this.covariances[v]!), transitionT),
        scaleMatrix(baseQ, varScale),
      );

      const innovationVariance = predictedCov[0]![0]! + noise;
      const gain = predictedCov.map((row) => row[0]! / innovationVariance);
      const residual = measurement - predictedState[0]!;

      this.states[v] = predictedState.map((value, i) => value + gain[i]! * residual);

      const kh = identity(this.order).map((_, i) => {
        const row = new Array<number>(this.order).fill(0);
        row[0] = gain[i]!;
        return row;
      });
      const iMinusKh = identity(this.order).map((row, i) =>
        row.map((value, j) => value - kh[i]![j]!),
      );
      this.covariances[v] = add(
        multiply(multiply(iMinusKh, predictedCov), transpose(iMinusKh)),
        scaleMatrix(outer(gain, gain), noise),
      );
    }
  }

  predict(horizons: number[]): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        if (!this.initialized[v]) continue;
        const state = this.states[v]!;
        let acceleration = this.order === 3 ? state[2]! : 0;
        if (this.order === 3 && h > 900) acceleration *= Math.exp(-(h - 900) / 3600);
        const value = state[0]! + state[1]! * h + 0.5 * acceleration * h * h;
        setTriple(triple, v, value);
      }
      return triple;
    });
  }

  shock(): void {
    for (let v = 0; v < 3; v += 1) {
      const cov = this.covariances[v]!;
      for (let i = 0; i < cov.length; i += 1) cov[i]![i] = cov[i]![i]! * 10 + 1e-9;
    }
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) {
      this.initialized[v] = false;
    }
    this.update(ctx);
  }
}

/** Fixed-gain critically damped alpha-beta-gamma kinematic observer. */
export class AlphaBetaGamma implements ForecastAlgorithm {
  readonly id = 'M05';
  private readonly position = [0, 0, 0];
  private readonly velocity = [0, 0, 0];
  private readonly acceleration = [0, 0, 0];
  private readonly initialized = [false, false, false];

  constructor(
    private readonly alpha = 0.25,
    private readonly beta = 0.03,
    private readonly gamma = 0.001,
  ) {}

  update(ctx: AlgorithmContext): void {
    const dt = Math.max(ctx.dt, 1e-3);
    for (let v = 0; v < 3; v += 1) {
      const measurement = frameValue(ctx.frame, v);
      if (!Number.isFinite(measurement)) continue;

      if (!this.initialized[v]) {
        this.position[v] = measurement;
        this.velocity[v] = 0;
        this.acceleration[v] = 0;
        this.initialized[v] = true;
        continue;
      }

      const predictedPosition =
        this.position[v]! + this.velocity[v]! * dt + 0.5 * this.acceleration[v]! * dt * dt;
      const predictedVelocity = this.velocity[v]! + this.acceleration[v]! * dt;
      const residual = measurement - predictedPosition;

      this.position[v] = predictedPosition + this.alpha * residual;
      this.velocity[v] = predictedVelocity + (this.beta / dt) * residual;
      this.acceleration[v] = this.acceleration[v]! + ((2 * this.gamma) / (dt * dt)) * residual;
    }
  }

  predict(horizons: number[]): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        if (!this.initialized[v]) continue;
        const value =
          this.position[v]! + this.velocity[v]! * h + 0.5 * this.acceleration[v]! * h * h;
        setTriple(triple, v, value);
      }
      return triple;
    });
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) this.initialized[v] = false;
    this.update(ctx);
  }
}
