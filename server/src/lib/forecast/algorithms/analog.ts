import type { AlgorithmContext, ForecastAlgorithm, ForecastTriple } from '../types';
import { emptyTriple } from '../types';
import { frameValue, horizonSteps, series, setTriple } from './helpers';

type Candidate = {
  distance: number;
  index: number;
};

/**
 * M20 — k-nearest-neighbour analog forecasting. The most recent window of each
 * variable is matched against every earlier window; the successors of the
 * closest analogs are averaged to produce the forecast.
 */
export class AnalogKnn implements ForecastAlgorithm {
  readonly id = 'M20';

  constructor(
    private readonly window = 8,
    private readonly neighbors = 6,
  ) {}

  update(): void {
    // Stateless: reads the shared medium history on demand.
  }

  private forecastVariable(values: number[], steps: number): number {
    const window = this.window;
    const length = values.length;
    if (length < window * 3) return values[length - 1] ?? Number.NaN;

    const query = values.slice(length - window);
    const candidates: Candidate[] = [];
    for (let i = 0; i + window + steps <= length; i += 1) {
      let distance = 0;
      for (let j = 0; j < window; j += 1) {
        const delta = values[i + j]! - query[j]!;
        distance += delta * delta;
      }
      candidates.push({ distance, index: i });
    }
    if (candidates.length === 0) return values[length - 1]!;

    candidates.sort((a, b) => a.distance - b.distance);
    let weighted = 0;
    let total = 0;
    for (let k = 0; k < Math.min(this.neighbors, candidates.length); k += 1) {
      const candidate = candidates[k]!;
      const weight = 1 / (Math.sqrt(candidate.distance) + 1e-6);
      weighted += weight * values[candidate.index + window + steps - 1]!;
      total += weight;
    }
    return total > 0 ? weighted / total : values[length - 1]!;
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    return horizons.map((h) => {
      const steps = horizonSteps(h, ctx.meanDt);
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        const values = series(ctx.medium, (frame) => frameValue(frame, v));
        setTriple(triple, v, this.forecastVariable(values, steps));
      }
      return triple;
    });
  }
}
