import type { ForecastTriple, StateFrame } from './types';
import { emptyTriple } from './types';
import { robustScale } from './signal';
import { frameValue } from './algorithms/helpers';

type PendingRound = {
  targetTime: number;
  /** One triple per algorithm, aligned with the bank order. */
  predictions: ForecastTriple[];
};

export type Blend = {
  triple: ForecastTriple;
  /** Per-variable predictive variance (temperature, mixing ratio, pressure). */
  variance: number[];
};

const HUBER_DELTA = 1.5;
const MISSING_LOSS = 25;
/** Minimum robust scale per variable so normalisation never divides by ~zero. */
const SCALE_FLOOR = [0.02, 1e-5, 0.02];

function tripleValue(triple: ForecastTriple, index: number): number {
  if (index === 0) return triple.temperature;
  if (index === 1) return triple.mixingRatio;
  return triple.pressure;
}

function huber(residual: number): number {
  const magnitude = Math.abs(residual);
  return magnitude <= HUBER_DELTA
    ? 0.5 * residual * residual
    : HUBER_DELTA * (magnitude - 0.5 * HUBER_DELTA);
}

/**
 * Fixed-Share expert aggregation. Every algorithm is an expert; the arbitrator
 * keeps a per-variable, per-horizon weight vector and updates it with a
 * multiplicative-weights rule against a bounded ledger of deferred predictions,
 * mixing a small share back to uniform so a regime change cannot permanently
 * silence a previously weak expert.
 */
export class Arbitrator {
  /** weights[variable][horizon][algorithm] */
  private readonly weights: number[][][];
  private readonly queues: PendingRound[][];
  private readonly capacities: number[];
  private readonly history: number[][] = [[], [], []];
  private readonly scales = SCALE_FLOOR.slice();
  readonly algorithmIds: string[];
  readonly horizons: number[];
  private readonly eta: number;
  private readonly share: number;

  constructor(
    algorithmIds: string[],
    horizons: number[],
    eta = 1.0,
    share = 0.02,
    dtFloor = 30,
  ) {
    this.algorithmIds = algorithmIds;
    this.horizons = horizons;
    this.eta = eta;
    this.share = share;
    const algorithmCount = algorithmIds.length;
    const uniform = 1 / algorithmCount;
    this.weights = [0, 1, 2].map(() =>
      horizons.map(() => new Array<number>(algorithmCount).fill(uniform)),
    );
    this.queues = horizons.map(() => []);
    this.capacities = horizons.map((horizon) => Math.ceil(horizon / dtFloor) + 4);
  }

  private refreshScales(): void {
    for (let v = 0; v < 3; v += 1) {
      const values = this.history[v]!;
      const deltas: number[] = [];
      for (let i = 1; i < values.length; i += 1) deltas.push(values[i]! - values[i - 1]!);
      this.scales[v] = Math.max(robustScale(deltas), SCALE_FLOOR[v]!);
    }
  }

  private scoreRound(horizonIndex: number, round: PendingRound, frame: StateFrame): void {
    for (let v = 0; v < 3; v += 1) {
      const actual = frameValue(frame, v);
      if (!Number.isFinite(actual)) continue;
      const scale = this.scales[v]!;
      const weights = this.weights[v]![horizonIndex]!;
      let total = 0;

      for (let a = 0; a < weights.length; a += 1) {
        const prediction = round.predictions[a];
        const value = prediction ? tripleValue(prediction, v) : Number.NaN;
        const loss = Number.isFinite(value) ? huber((value - actual) / scale) : MISSING_LOSS;
        weights[a] = weights[a]! * Math.exp(-this.eta * loss) + 1e-12;
        total += weights[a]!;
      }

      if (total > 0) {
        for (let a = 0; a < weights.length; a += 1) weights[a] = weights[a]! / total;
      } else {
        weights.fill(1 / weights.length);
      }

      const uniformShare = this.share / weights.length;
      for (let a = 0; a < weights.length; a += 1) {
        weights[a] = (1 - this.share) * weights[a]! + uniformShare;
      }
    }
  }

  /** Resolve every deferred prediction whose target time has now passed. */
  observe(frame: StateFrame): void {
    for (let v = 0; v < 3; v += 1) {
      const value = frameValue(frame, v);
      if (!Number.isFinite(value)) continue;
      const values = this.history[v]!;
      values.push(value);
      if (values.length > 64) values.splice(0, values.length - 64);
    }
    this.refreshScales();

    for (let horizonIndex = 0; horizonIndex < this.queues.length; horizonIndex += 1) {
      const queue = this.queues[horizonIndex]!;
      while (queue.length > 0 && queue[0]!.targetTime <= frame.timestamp) {
        const round = queue.shift()!;
        this.scoreRound(horizonIndex, round, frame);
      }
    }
  }

  /** Defer the current predictions so they can be scored once their horizon lands. */
  pushPredictions(now: number, predictions: ForecastTriple[][]): void {
    for (let horizonIndex = 0; horizonIndex < this.horizons.length; horizonIndex += 1) {
      const queue = this.queues[horizonIndex]!;
      queue.push({
        targetTime: now + this.horizons[horizonIndex]!,
        predictions: predictions.map((perHorizon) => perHorizon[horizonIndex] ?? emptyTriple()),
      });
      if (queue.length > this.capacities[horizonIndex]!) queue.shift();
    }
  }

  /** Weighted ensemble mean and predictive variance for one horizon. */
  blend(horizonIndex: number, predictions: ForecastTriple[][]): Blend {
    const horizon = this.horizons[horizonIndex]!;
    const triple = emptyTriple();
    const variance = [0, 0, 0];

    for (let v = 0; v < 3; v += 1) {
      const weights = this.weights[v]![horizonIndex]!;
      let weightedSum = 0;
      let weightTotal = 0;
      for (let a = 0; a < weights.length; a += 1) {
        const value = tripleValue(predictions[a]?.[horizonIndex] ?? emptyTriple(), v);
        if (!Number.isFinite(value)) continue;
        weightedSum += weights[a]! * value;
        weightTotal += weights[a]!;
      }

      if (weightTotal <= 0) continue;
      const meanValue = weightedSum / weightTotal;
      let spread = 0;
      for (let a = 0; a < weights.length; a += 1) {
        const value = tripleValue(predictions[a]?.[horizonIndex] ?? emptyTriple(), v);
        if (!Number.isFinite(value)) continue;
        spread += (weights[a]! / weightTotal) * (value - meanValue) ** 2;
      }

      if (v === 0) triple.temperature = meanValue;
      else if (v === 1) triple.mixingRatio = Math.max(0, meanValue);
      else triple.pressure = meanValue;

      const baseStd = this.scales[v]! * (0.3 + 1.5 * Math.sqrt(horizon / 3600));
      variance[v] = spread + baseStd * baseStd;
    }

    return { triple, variance };
  }

  /** Algorithm ids ranked by mean weight across variables for a horizon. */
  topAlgorithms(horizonIndex: number, count: number): string[] {
    const scores = this.algorithmIds.map((_, a) => {
      let sum = 0;
      for (let v = 0; v < 3; v += 1) sum += this.weights[v]![horizonIndex]![a]!;
      return { id: this.algorithmIds[a]!, score: sum };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, count).map((entry) => entry.id);
  }
}
