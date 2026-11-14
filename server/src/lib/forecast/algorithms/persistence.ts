import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { frameValue, tripleFrom } from './helpers';

/**
 * M00 — persistence. The last accepted observation is carried forward across
 * every horizon. It is the reference every other algorithm must beat.
 */
export class Persistence implements ForecastAlgorithm {
  readonly id = 'M00';
  private readonly values = [Number.NaN, Number.NaN, Number.NaN];

  update(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(ctx.frame, v);
      if (Number.isFinite(value)) this.values[v] = value;
    }
  }

  predict(horizons: number[]): ForecastTriple[] {
    return horizons.map(() => tripleFrom(this.values));
  }

  reset(ctx: AlgorithmContext): void {
    for (let v = 0; v < 3; v += 1) this.values[v] = Number.NaN;
    this.update(ctx);
  }
}
