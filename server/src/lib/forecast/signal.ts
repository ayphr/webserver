import { mad, mean, solveLeastSquares, variance } from './math';

export type SmoothedSample = {
  value: number;
  first: number;
  second: number;
  residualVariance: number;
};

/**
 * Fits a local quadratic over the supplied samples (oldest first) and evaluates
 * it at the newest sample. Works for both uniform and irregular timestamps.
 */
export function savitzkyGolay(samples: number[], times: number[]): SmoothedSample {
  const n = samples.length;
  const last = samples[n - 1] ?? 0;

  if (n < 3) {
    const first = n >= 2 ? (last - samples[0]!) / Math.max(1e-9, times[n - 1]! - times[0]!) : 0;
    return { value: last, first, second: 0, residualVariance: 0 };
  }

  const tLast = times[n - 1]!;
  const design: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const delta = times[i]! - tLast;
    design.push([1, delta, delta * delta]);
  }

  const coeffs = solveLeastSquares(design, samples, 1e-6);
  const fitted = design.map((row) => row[0]! * coeffs[0]! + row[1]! * coeffs[1]! + row[2]! * coeffs[2]!);
  const residuals = samples.map((value, i) => value - fitted[i]!);

  return {
    value: coeffs[0]!,
    first: coeffs[1]!,
    second: 2 * coeffs[2]!,
    residualVariance: variance(residuals),
  };
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of two. */
export function fft(re: number[], im: number[]): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = i + k + len / 2;
        const tRe = re[b]! * curRe - im[b]! * curIm;
        const tIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - tRe;
        im[b] = im[a]! - tIm;
        re[a] = re[a]! + tRe;
        im[a] = im[a]! + tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

type SpectrumPoint = { period: number; power: number };

function detrend(values: number[], times: number[]): number[] {
  const n = values.length;
  const t0 = times[0]!;
  const xs = times.map((t) => t - t0);
  const mt = mean(xs);
  const mv = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i]! - mt) * (values[i]! - mv);
    den += (xs[i]! - mt) ** 2;
  }
  const slope = den > 1e-12 ? num / den : 0;
  return values.map((value, i) => value - (mv + slope * (xs[i]! - mt)));
}

function nextPowerOfTwo(value: number): number {
  let p = 1;
  while (p < value) p <<= 1;
  return p;
}

function fftSpectrum(values: number[], times: number[]): SpectrumPoint[] {
  const n = values.length;
  const dt = (times[n - 1]! - times[0]!) / Math.max(1, n - 1);
  const detrended = detrend(values, times);

  const size = nextPowerOfTwo(n);
  const re = new Array<number>(size).fill(0);
  const im = new Array<number>(size).fill(0);
  for (let i = 0; i < n; i += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = detrended[i]! * window;
  }

  fft(re, im);

  const points: SpectrumPoint[] = [];
  for (let k = 1; k < size / 2; k += 1) {
    const frequency = k / (size * dt);
    if (frequency <= 0) continue;
    const power = re[k]! * re[k]! + im[k]! * im[k]!;
    points.push({ period: 1 / frequency, power });
  }
  return points;
}

function lombScargle(values: number[], times: number[]): SpectrumPoint[] {
  const n = values.length;
  const t0 = times[0]!;
  const xs = times.map((t) => t - t0);
  const detrended = detrend(values, times);
  const duration = xs[n - 1]!;
  const dt = duration / Math.max(1, n - 1);

  const minFrequency = 2 / duration;
  const maxFrequency = 1 / (4 * dt);
  const steps = 512;
  const points: SpectrumPoint[] = [];

  for (let s = 0; s < steps; s += 1) {
    const frequency = minFrequency + ((maxFrequency - minFrequency) * s) / (steps - 1);
    const omega = 2 * Math.PI * frequency;
    let sinSum = 0;
    let cosSum = 0;
    for (let i = 0; i < n; i += 1) {
      sinSum += Math.sin(2 * omega * xs[i]!);
      cosSum += Math.cos(2 * omega * xs[i]!);
    }
    const tau = Math.atan2(sinSum, cosSum) / (2 * omega);

    let c = 0;
    let sTerm = 0;
    let cc = 0;
    let ss = 0;
    for (let i = 0; i < n; i += 1) {
      const phase = omega * (xs[i]! - tau);
      const cos = Math.cos(phase);
      const sin = Math.sin(phase);
      c += detrended[i]! * cos;
      sTerm += detrended[i]! * sin;
      cc += cos * cos;
      ss += sin * sin;
    }
    const power = cc > 1e-12 && ss > 1e-12 ? (c * c) / cc + (sTerm * sTerm) / ss : 0;
    points.push({ period: 1 / frequency, power });
  }

  return points;
}

function isRegular(times: number[]): boolean {
  if (times.length < 3) return true;
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) deltas.push(times[i]! - times[i - 1]!);
  const mu = mean(deltas);
  if (mu <= 0) return false;
  return variance(deltas) / (mu * mu) < 0.05;
}

/**
 * Discovers dominant periodicities in a series. Uses an FFT for regularly
 * spaced samples and a Lomb-Scargle periodogram otherwise. Returns up to three
 * periods (seconds), strongest first.
 */
export function detectPeriods(values: number[], times: number[], maxPeriods = 3): number[] {
  const n = values.length;
  if (n < 128) return [];

  const dt = (times[n - 1]! - times[0]!) / Math.max(1, n - 1);
  const bufferDuration = times[n - 1]! - times[0]!;
  const minPeriod = 4 * dt;
  const maxPeriod = 0.5 * bufferDuration;

  const spectrum = isRegular(times) ? fftSpectrum(values, times) : lombScargle(values, times);
  const inBand = spectrum.filter((point) => point.period >= minPeriod && point.period <= maxPeriod);
  if (inBand.length === 0) return [];

  const noiseFloor = medianPower(spectrum);
  const threshold = 6 * noiseFloor;
  const peaks = inBand
    .filter((point) => point.power > threshold)
    .sort((a, b) => b.power - a.power);

  const selected: number[] = [];
  for (const peak of peaks) {
    if (selected.length >= maxPeriods) break;
    // Require at least a 20% separation so harmonics of one cycle do not fill all slots.
    if (selected.some((period) => Math.abs(period - peak.period) / peak.period < 0.2)) continue;
    selected.push(peak.period);
  }

  return selected;
}

function medianPower(points: SpectrumPoint[]): number {
  if (points.length === 0) return 0;
  const sorted = points.map((point) => point.power).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Two-sided CUSUM changepoint detector over a stream of first differences.
 * Standardises each step against an exponentially weighted mean/variance.
 */
export class CusumDetector {
  private mean = 0;
  private variance = 0;
  private initialized = false;
  private sumPositive = 0;
  private sumNegative = 0;

  constructor(
    private readonly alpha = 0.02,
    private readonly kappa = 0.5,
    private readonly threshold = 5.0,
  ) {}

  update(delta: number): boolean {
    if (!this.initialized) {
      this.mean = delta;
      this.variance = 1e-6;
      this.initialized = true;
      return false;
    }

    const sigma = Math.max(Math.sqrt(this.variance), 1e-6);
    const z = (delta - this.mean) / sigma;
    this.sumPositive = Math.max(0, this.sumPositive + z - this.kappa);
    this.sumNegative = Math.max(0, this.sumNegative - z - this.kappa);

    this.mean = (1 - this.alpha) * this.mean + this.alpha * delta;
    this.variance = (1 - this.alpha) * this.variance + this.alpha * (delta - this.mean) ** 2;

    if (this.sumPositive > this.threshold || this.sumNegative > this.threshold) {
      this.sumPositive = 0;
      this.sumNegative = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.initialized = false;
    this.sumPositive = 0;
    this.sumNegative = 0;
  }
}

/** Robust scale of a first-difference series, used to normalise forecast losses. */
export function robustScale(deltas: number[]): number {
  const scale = 1.4826 * mad(deltas);
  return Math.max(scale, 1e-4);
}
