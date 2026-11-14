/**
 * Minimal dense linear-algebra helpers for the forecast engine. Sizes are small
 * (<= 8x8) so clarity beats raw throughput.
 */

export type Matrix = number[][];

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) m[i]![i] = 1;
  return m;
}

export function diagonal(values: number[]): Matrix {
  const n = values.length;
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) m[i]![i] = values[i]!;
  return m;
}

export function transpose(a: Matrix): Matrix {
  const rows = a.length;
  const cols = rows > 0 ? a[0]!.length : 0;
  const out = zeros(cols, rows);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[j]![i] = a[i]![j]!;
  }
  return out;
}

export function add(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((value, j) => value + b[i]![j]!));
}

export function subtract(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((value, j) => value - b[i]![j]!));
}

export function scale(a: Matrix, factor: number): Matrix {
  return a.map((row) => row.map((value) => value * factor));
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const inner = b.length;
  const out = zeros(n, m);
  for (let i = 0; i < n; i += 1) {
    const outRow = out[i]!;
    const aRow = a[i]!;
    for (let k = 0; k < inner; k += 1) {
      const aik = aRow[k]!;
      if (aik === 0) continue;
      const bRow = b[k]!;
      for (let j = 0; j < m; j += 1) outRow[j] = (outRow[j] ?? 0) + aik * bRow[j]!;
    }
  }
  return out;
}

export function matVec(a: Matrix, v: number[]): number[] {
  return a.map((row) => row.reduce((sum, value, j) => sum + value * v[j]!, 0));
}

export function outer(a: number[], b: number[]): Matrix {
  return a.map((ai) => b.map((bj) => ai * bj));
}

/** Inverts a square matrix with Gauss-Jordan elimination and partial pivoting. */
export function inverse(input: Matrix): Matrix {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const inv = identity(n);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let best = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(a[row]![col]!);
      if (value > best) {
        best = value;
        pivot = row;
      }
    }

    if (best < 1e-12) {
      a[col]![col] = (a[col]![col] ?? 0) + 1e-9;
    }

    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [inv[col], inv[pivot]] = [inv[pivot]!, inv[col]!];
    }

    const diag = a[col]![col]!;
    for (let j = 0; j < n; j += 1) {
      a[col]![j] = a[col]![j]! / diag;
      inv[col]![j] = inv[col]![j]! / diag;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < n; j += 1) {
        a[row]![j] = a[row]![j]! - factor * a[col]![j]!;
        inv[row]![j] = inv[row]![j]! - factor * inv[col]![j]!;
      }
    }
  }

  return inv;
}

/** Solves `(A^T A + lambda I) x = A^T b` via normal equations. */
export function solveLeastSquares(a: Matrix, b: number[], lambda = 1e-6): number[] {
  const at = transpose(a);
  const ata = multiply(at, a);
  for (let i = 0; i < ata.length; i += 1) ata[i]![i] = ata[i]![i]! + lambda;
  const atb = matVec(at, b);
  return matVec(inverse(ata), atb);
}

/** Lower-triangular Cholesky factor of a symmetric positive-definite matrix. */
export function cholesky(input: Matrix): Matrix {
  const n = input.length;
  const l = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = input[i]![j]!;
      for (let k = 0; k < j; k += 1) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        l[i]![j] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        l[i]![j] = sum / l[j]![j]!;
      }
    }
  }
  return l;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - mu) ** 2;
  return sum / (values.length - 1);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Ordinary least-squares slope of `values` against `times`. */
export function linearSlope(values: number[], times: number[]): number {
  const n = Math.min(values.length, times.length);
  if (n < 2) return 0;
  const mt = mean(times.slice(0, n));
  const mv = mean(values.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (times[i]! - mt) * (values[i]! - mv);
    den += (times[i]! - mt) ** 2;
  }
  return den > 1e-12 ? num / den : 0;
}

/** Median absolute deviation, a robust scale estimate. */
export function mad(values: number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  return median(values.map((value) => Math.abs(value - med)));
}
