import type { ForecastTriple, StateFrame } from './types';
import { emptyTriple } from './types';
import { robustScale } from './signal';
import { quantile } from './math';
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
/** Loss assigned to an expert that produced no finite prediction (the maximum). */
const MISSING_LOSS = 1;
/** Minimum robust scale per variable so normalisation never divides by ~zero. */
const SCALE_FLOOR = [0.02, 1e-5, 0.02];
/** Weight of the newest round in the adaptive per-horizon error scale. */
const ERROR_SCALE_ADAPT = 0.15;
/**
 * Quantile of the cross-expert absolute residuals used as the error scale. A
 * low quantile tracks the accuracy of the *good* experts rather than the median
 * (which the pathological experts inflate), so the loss measures how much worse
 * an expert is than a realistic best, not than the average of a broken field.
 */
const ERROR_SCALE_QUANTILE = 0.25;

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
 * Bounds the Huber loss to [0, 1). The multiplicative-weights update needs a
 * bounded loss: an unbounded one lets a single round with a large normalised
 * residual drive every rival weight to ~0, so the blend latches onto whichever
 * expert happened to win the most recent round and oscillates between adjacent
 * horizons. Saturating at 1 keeps every round's influence proportional to how
 * much worse an expert actually was.
 */
function normalisedLoss(residual: number): number {
  const h = huber(residual);
  return h / (1 + h);
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
  /**
   * Adaptive error scale per variable and horizon. Forecast error grows with
   * lead time, so normalising a residual by the per-step observation noise makes
   * every long-horizon loss saturate at ~1 and the update stops discriminating.
   * Tracking the typical absolute error at each horizon keeps the loss
   * proportional to how much worse an expert really is.
   */
  private readonly errorScales: number[][];
  readonly algorithmIds: string[];
  readonly horizons: number[];
  private readonly eta: number;
  private readonly share: number;

  constructor(
    algorithmIds: string[],
    horizons: number[],
    eta = 0.5,
    share = 0.003,
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
    this.errorScales = [0, 1, 2].map((v) => horizons.map(() => SCALE_FLOOR[v]!));
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
      const weights = this.weights[v]![horizonIndex]!;
      const residual = new Array<number>(weights.length);

      for (let a = 0; a < weights.length; a += 1) {
        const prediction = round.predictions[a];
        const value = prediction ? tripleValue(prediction, v) : Number.NaN;
        residual[a] = Number.isFinite(value) ? value - actual : Number.NaN;
      }

      // Scale each round by the robust typical error across experts, bounded
      // below by the sensor noise, so the loss reflects relative accuracy
      // rather than saturating for every expert at long horizons.
      const magnitudes: number[] = [];
      for (const r of residual) {
        if (Number.isFinite(r)) magnitudes.push(Math.abs(r));
      }
      const floor = this.scales[v]!;
      const target = magnitudes.length > 0 ? Math.max(quantile(magnitudes, ERROR_SCALE_QUANTILE), floor) : floor;
      const previous = this.errorScales[v]![horizonIndex]!;
      const scale = previous + ERROR_SCALE_ADAPT * (target - previous);
      this.errorScales[v]![horizonIndex] = scale;

      let total = 0;
      for (let a = 0; a < weights.length; a += 1) {
        const r = residual[a]!;
        const loss = Number.isFinite(r) ? normalisedLoss(r / scale) : MISSING_LOSS;
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

  /**
   * Trust in an expert should vary smoothly with the forecast horizon, but each
   * horizon learns its weights independently and the longest horizons see the
   * fewest scoring rounds. Averaging each weight vector with its immediate
   * horizon neighbours (the horizons are geometrically spaced, so neighbours are
   * adjacent in log-time) removes single-horizon glitches where an under-trained
   * horizon latches onto a different expert than the horizons around it.
   */
  private smoothedWeights(v: number, horizonIndex: number): number[] {
    const row = this.weights[v]!;
    const current = row[horizonIndex]!;
    const prev = horizonIndex > 0 ? row[horizonIndex - 1]! : null;
    const next = horizonIndex < row.length - 1 ? row[horizonIndex + 1]! : null;
    const norm = 2 + (prev ? 1 : 0) + (next ? 1 : 0);
    const smoothed = new Array<number>(current.length);
    for (let a = 0; a < current.length; a += 1) {
      let sum = 2 * current[a]!;
      if (prev) sum += prev[a]!;
      if (next) sum += next[a]!;
      smoothed[a] = sum / norm;
    }
    return smoothed;
  }

  /** Weighted ensemble mean and predictive variance for one horizon. */
  blend(horizonIndex: number, predictions: ForecastTriple[][]): Blend {
    const horizon = this.horizons[horizonIndex]!;
    const triple = emptyTriple();
    const variance = [0, 0, 0];

    for (let v = 0; v < 3; v += 1) {
      const weights = this.smoothedWeights(v, horizonIndex);
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
    // Rank against the same horizon-smoothed weights `blend` uses so the
    // reported experts match the ones actually driving the forecast.
    const smoothed = [0, 1, 2].map((v) => this.smoothedWeights(v, horizonIndex));
    const scores = this.algorithmIds.map((_, a) => {
      let sum = 0;
      for (let v = 0; v < 3; v += 1) sum += smoothed[v]![a]!;
      return { id: this.algorithmIds[a]!, score: sum };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, count).map((entry) => entry.id);
  }
}
