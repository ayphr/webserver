import { add, cholesky, inverse, multiply, outer, scale, subtract, transpose } from '../math';

export type UkfOptions = {
  alpha?: number;
  beta?: number;
  kappa?: number;
};

/**
 * Compact unscented Kalman filter used by the coupled psychrometric model. The
 * state and measurement functions are supplied per step so the filter stays
 * agnostic of the physical model.
 */
export class UnscentedKalmanFilter {
  private mean: number[];
  private covariance: number[][];
  private sigmaPoints: number[][] = [];
  private readonly weightsMean: number[];
  private readonly weightsCovariance: number[];
  private readonly lambda: number;
  private readonly dimension: number;

  constructor(
    dimension: number,
    options: UkfOptions = {},
  ) {
    this.dimension = dimension;
    const alpha = options.alpha ?? 1e-3;
    const beta = options.beta ?? 2;
    const kappa = options.kappa ?? 0;
    this.lambda = alpha * alpha * (dimension + kappa) - dimension;
    const denominator = dimension + this.lambda;

    this.weightsMean = new Array<number>(2 * dimension + 1).fill(1 / (2 * denominator));
    this.weightsCovariance = new Array<number>(2 * dimension + 1).fill(1 / (2 * denominator));
    this.weightsMean[0] = this.lambda / denominator;
    this.weightsCovariance[0] = this.lambda / denominator + (1 - alpha * alpha + beta);

    this.mean = new Array<number>(dimension).fill(0);
    this.covariance = Array.from({ length: dimension }, (_, i) =>
      Array.from({ length: dimension }, (_, j) => (i === j ? 1 : 0)),
    );
  }

  initialize(mean: number[], covariance: number[][]): void {
    this.mean = mean.slice();
    this.covariance = covariance.map((row) => row.slice());
    this.sigmaPoints = [];
  }

  getMean(): number[] {
    return this.mean;
  }

  getCovariance(): number[][] {
    return this.covariance;
  }

  private computeSigmaPoints(): void {
    const scaled = scale(this.covariance, this.dimension + this.lambda);
    const root = cholesky(scaled);
    const points: number[][] = [this.mean.slice()];
    for (let i = 0; i < this.dimension; i += 1) {
      const column = root.map((row) => row[i]!);
      points.push(this.mean.map((value, d) => value + column[d]!));
      points.push(this.mean.map((value, d) => value - column[d]!));
    }
    this.sigmaPoints = points;
  }

  predict(transition: (state: number[]) => number[], processNoise: number[][]): void {
    this.computeSigmaPoints();
    const propagated = this.sigmaPoints.map(transition);

    this.mean = new Array<number>(this.dimension).fill(0);
    for (let i = 0; i < propagated.length; i += 1) {
      const weight = this.weightsMean[i]!;
      const point = propagated[i]!;
      for (let d = 0; d < this.dimension; d += 1) {
        this.mean[d] = this.mean[d]! + weight * point[d]!;
      }
    }

    let covariance = processNoise;
    for (let i = 0; i < propagated.length; i += 1) {
      const diff = propagated[i]!.map((value, d) => value - this.mean[d]!);
      covariance = add(covariance, scale(outer(diff, diff), this.weightsCovariance[i]!));
    }
    this.covariance = covariance;
    this.sigmaPoints = [];
  }

  update(
    measurement: (state: number[]) => number[],
    observation: number[],
    measurementNoise: number[][],
  ): void {
    this.computeSigmaPoints();
    const transformed = this.sigmaPoints.map(measurement);
    const measurementDimension = observation.length;

    const predicted = new Array<number>(measurementDimension).fill(0);
    for (let i = 0; i < transformed.length; i += 1) {
      const weight = this.weightsMean[i]!;
      const point = transformed[i]!;
      for (let d = 0; d < measurementDimension; d += 1) {
        predicted[d] = predicted[d]! + weight * point[d]!;
      }
    }

    let innovationCovariance = measurementNoise;
    let crossCovariance: number[][] = Array.from({ length: this.dimension }, () =>
      new Array<number>(measurementDimension).fill(0),
    );

    for (let i = 0; i < transformed.length; i += 1) {
      const weight = this.weightsCovariance[i]!;
      const zDiff = transformed[i]!.map((value, d) => value - predicted[d]!);
      const xDiff = this.sigmaPoints[i]!.map((value, d) => value - this.mean[d]!);
      innovationCovariance = add(innovationCovariance, scale(outer(zDiff, zDiff), weight));
      crossCovariance = add(crossCovariance, scale(outer(xDiff, zDiff), weight));
    }

    const gain = multiply(crossCovariance, inverse(innovationCovariance));
    const residual = observation.map((value, d) => value - predicted[d]!);

    this.mean = this.mean.map(
      (value, d) => value + gain[d]!.reduce((sum, g, m) => sum + g * residual[m]!, 0),
    );

    // P <- P - K S K^T
    const correction = multiply(multiply(gain, innovationCovariance), transpose(gain));
    this.covariance = subtract(this.covariance, correction);
    this.sigmaPoints = [];
  }
}
