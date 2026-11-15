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

  private readonly window: number;
  private readonly neighbors: number;

  constructor(
    window = 8,
    neighbors = 6,
  ) {
    this.window = window;
    this.neighbors = neighbors;
  }

  update(): void {
    // Stateless: reads the shared medium history on demand.
  }

  /** Every window position ranked by squared distance from the latest window. */
  private match(values: number[]): Candidate[] {
    const window = this.window;
    const length = values.length;
    if (length < window * 3) return [];

    const query = values.slice(length - window);
    const candidates: Candidate[] = [];
    for (let i = 0; i + window <= length; i += 1) {
      let distance = 0;
      for (let j = 0; j < window; j += 1) {
        const delta = values[i + j]! - query[j]!;
        distance += delta * delta;
      }
      candidates.push({ distance, index: i });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates;
  }

  private forecastVariable(values: number[], candidates: Candidate[], steps: number): number {
    const window = this.window;
    const length = values.length;
    const last = values[length - 1] ?? Number.NaN;
    if (candidates.length === 0) return last;

    // Bandwidth equals the distance of the k-th nearest analog, so the kernel
    // stays bounded and a single near-exact match cannot dominate the average.
    const bandwidth = Math.max(candidates[Math.min(this.neighbors, candidates.length) - 1]!.distance, 1e-9);
    let weighted = 0;
    let total = 0;
    let used = 0;
    for (const candidate of candidates) {
      if (candidate.index + window + steps > length) continue;
      const weight = 1 / (candidate.distance + bandwidth);
      weighted += weight * values[candidate.index + window + steps - 1]!;
      total += weight;
      used += 1;
      if (used >= this.neighbors) break;
    }
    return total > 0 ? weighted / total : last;
  }

  predict(horizons: number[], ctx: AlgorithmContext): ForecastTriple[] {
    // The history and analog ranking are shared across horizons and variables.
    const seriesByVariable = [0, 1, 2].map((v) =>
      series(ctx.medium, (frame) => frameValue(frame, v)),
    );
    const matches = seriesByVariable.map((values) => this.match(values));

    return horizons.map((h) => {
      const steps = horizonSteps(h, ctx.meanDt);
      const triple = emptyTriple();
      for (let v = 0; v < 3; v += 1) {
        setTriple(triple, v, this.forecastVariable(seriesByVariable[v]!, matches[v]!, steps));
      }
      return triple;
    });
  }
}
