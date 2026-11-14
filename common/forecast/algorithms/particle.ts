import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { frameValue, recentVariance, setTriple } from './helpers';

type Particle = {
  value: number;
  velocity: number;
};

/** Deterministic mulberry32 PRNG so particle filtering stays reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Bootstrap particle filter for a 1-D constant-velocity state. */
class ParticleFilter1D {
  private particles: Particle[];
  private weights: number[];
  private initialized = false;
  private readonly random: () => number;
  private readonly count: number;
  private readonly velocityDecay: number;

  constructor(
    seed: number,
    count = 64,
    velocityDecay = 0.95,
  ) {
    this.random = createRandom(seed);
    this.count = count;
    this.velocityDecay = velocityDecay;
    this.particles = [];
    this.weights = new Array<number>(count).fill(1 / count);
  }

  initialize(measurement: number, scale: number): void {
    const spread = Math.max(Math.sqrt(Math.max(scale, 1e-8)), 1e-4);
    this.particles = Array.from({ length: this.count }, () => ({
      value: measurement + spread * gaussian(this.random),
      velocity: (spread / 60) * gaussian(this.random),
    }));
    this.weights = new Array<number>(this.count).fill(1 / this.count);
    this.initialized = true;
  }

  step(measurement: number, dt: number, processScale: number, measurementSigma: number): void {
    if (!this.initialized) {
      this.initialize(measurement, processScale);
      return;
    }

    const processStd = Math.sqrt(Math.max(processScale, 1e-10));
    const sigma = Math.max(measurementSigma, 1e-6);
    let weightSum = 0;

    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i]!;
      particle.velocity = this.velocityDecay * particle.velocity + processStd * 0.1 * gaussian(this.random);
      particle.value += particle.velocity * dt + processStd * Math.sqrt(dt) * gaussian(this.random);
      const residual = (measurement - particle.value) / sigma;
      const likelihood = Math.exp(-0.5 * residual * residual);
      this.weights[i] = (this.weights[i]! * likelihood) + 1e-300;
      weightSum += this.weights[i]!;
    }

    if (weightSum <= 0 || !Number.isFinite(weightSum)) {
      this.weights.fill(1 / this.count);
      return;
    }
    for (let i = 0; i < this.weights.length; i += 1) this.weights[i] = this.weights[i]! / weightSum;

    this.resampleIfNeeded();
  }

  private resampleIfNeeded(): void {
    let sumSquares = 0;
    for (const weight of this.weights) sumSquares += weight * weight;
    const effective = 1 / Math.max(sumSquares, 1e-300);
    if (effective >= this.count / 2) return;

    const cumulative = new Array<number>(this.count).fill(0);
    let running = 0;
    for (let i = 0; i < this.count; i += 1) {
      running += this.weights[i]!;
      cumulative[i] = running;
    }

    const resampled: Particle[] = [];
    let index = 0;
    const start = this.random() / this.count;
    for (let i = 0; i < this.count; i += 1) {
      const target = start + i / this.count;
      while (index < this.count - 1 && cumulative[index]! < target) index += 1;
      const source = this.particles[index]!;
      resampled.push({ value: source.value, velocity: source.velocity });
    }
    this.particles = resampled;
    this.weights = new Array<number>(this.count).fill(1 / this.count);
  }

  forecast(horizonSeconds: number): number {
    if (!this.initialized) return Number.NaN;
    let value = 0;
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i]!;
      value += this.weights[i]! * (particle.value + particle.velocity * horizonSeconds);
    }
    return value;
  }

  clear(): void {
    this.particles = [];
    this.weights = new Array<number>(this.count).fill(1 / this.count);
    this.initialized = false;
  }
}

/** M06 — bootstrap particle filter over the three prognostic variables. */
export class ParticleFilter implements ForecastAlgorithm {
  readonly id = 'M06';
  private readonly filters = [1, 2, 3].map((seed) => new ParticleFilter1D(seed));

  update(ctx: AlgorithmContext): void {
    const dt = Math.max(ctx.dt, 1e-3);
    for (let v = 0; v < 3; v += 1) {
      const measurement = frameValue(ctx.frame, v);
      if (!Number.isFinite(measurement)) continue;
      const variance = Math.max(recentVariance(ctx.short, v, 32), 1e-8);
      const sigma = Math.sqrt(variance);
      this.filters[v]!.step(measurement, dt, variance, sigma);
    }
  }

  predict(horizons: number[]): ForecastTriple[] {
    return horizons.map((h) => {
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) setTriple(triple, v, this.filters[v]!.forecast(h));
      return triple;
    });
  }

  reset(ctx: AlgorithmContext): void {
    for (const filter of this.filters) filter.clear();
    this.update(ctx);
  }
}
