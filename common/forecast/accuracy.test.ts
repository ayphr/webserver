import { describe, expect, it } from 'bun:test';
import type { DataPoint } from '../types';
import { ForecastEngine } from './index';

/**
 * Accuracy regression tests. They replay the production regime exactly: a fresh
 * engine consumes a 24h warm-up window and emits one forecast. Errors are pooled
 * over several seeds and many origins across the day, because a single origin
 * can make the persistence baseline accidentally good (e.g. a midnight anchor
 * where a 6h-ahead diurnal value lands back near its start). The thresholds are
 * generous — well below the measured skill — so they only fail on a real
 * regression, such as a broken expert dragging the ensemble below persistence.
 */

const STEP_SECONDS = 300;
const STEPS_PER_DAY = (24 * 3600) / STEP_SECONDS;
const WARMUP_POINTS = STEPS_PER_DAY;
const DAYS = 4;
const ORIGIN_STRIDE = 36; // 3h between origins
const HORIZONS = [1800, 3600, 10800, 21600, 43200];
const SEEDS = [1, 7, 42];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Diurnal cycle plus mean-reverting synoptic noise, with an occasional front. */
function syntheticWeather(seed: number, days: number): DataPoint[] {
  const rnd = mulberry32(seed);
  const dtHours = STEP_SECONDS / 3600;
  const steps = days * STEPS_PER_DAY;
  const gauss = (): number => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const ou = (value: number, tau: number, sigma: number): number => {
    const decay = Math.exp(-dtHours / tau);
    return value * decay + sigma * Math.sqrt(1 - decay * decay) * gauss();
  };

  const startMs = Date.UTC(2026, 2, 10, 0, 0, 0);
  const points: DataPoint[] = [];
  let ta = 0;
  let pa = 0;
  let ha = 0;
  let ft = 0;
  let fh = 0;
  let fp = 0;
  for (let i = 0; i < steps; i += 1) {
    const tMs = startMs + i * STEP_SECONDS * 1000;
    const sod = (((tMs / 1000) % 86400) + 86400) % 86400;
    const diurnal = 4.5 * Math.cos((2 * Math.PI * (sod - 15 * 3600)) / 86400);
    ta = ou(ta, 30, 0.36);
    pa = ou(pa, 40, 0.05);
    ha = ou(ha, 24, 0.8);
    if (rnd() < 0.02 * dtHours) {
      ft += (rnd() - 0.5) * 8;
      fh += (rnd() - 0.5) * 25;
      fp += (rnd() - 0.5) * 6;
    }
    ft *= Math.exp(-dtHours / 8);
    fh *= Math.exp(-dtHours / 8);
    fp *= Math.exp(-dtHours / 8);
    const temperature = 18 + diurnal + ta + ft + 0.9 * pa + 0.15 * gauss();
    const humidity = 62 - 1.8 * (temperature - 18) + ha + fh + 0.225 * gauss();
    const pressure =
      1013 + pa + fp + 0.4 * Math.cos((2 * Math.PI * (sod - 10 * 3600)) / 43200) + 0.15 * gauss();
    points.push({
      timestamp: new Date(tMs),
      temperature,
      humidity: Math.max(5, Math.min(100, humidity)),
      airPressure: pressure,
    });
  }
  return points;
}

type Variable = 'temperature' | 'humidity' | 'airPressure';
const VARIABLES: Variable[] = ['temperature', 'humidity', 'airPressure'];

/** Maps each source variable to its name on the reconstructed forecast point. */
const POINT_KEY: Record<Variable, 'temperature' | 'humidity' | 'pressure'> = {
  temperature: 'temperature',
  humidity: 'humidity',
  airPressure: 'pressure',
};

type Accumulator = {
  /** Summed absolute forecast error per horizon and variable. */
  abs: number[][];
  /** Summed absolute persistence error per horizon and variable. */
  persistence: number[][];
  count: number[];
};

function emptyAccumulator(): Accumulator {
  return {
    abs: HORIZONS.map(() => [0, 0, 0]),
    persistence: HORIZONS.map(() => [0, 0, 0]),
    count: HORIZONS.map(() => 0),
  };
}

/** One fresh engine per origin, exactly as production requests a forecast. */
function accumulate(seed: number, acc: Accumulator): void {
  const points = syntheticWeather(seed, DAYS);
  const base = points[0]!.timestamp.getTime();
  const lastOrigin = points.length - 1 - (HORIZONS[HORIZONS.length - 1]! / STEP_SECONDS);
  for (let origin = WARMUP_POINTS; origin <= lastOrigin; origin += ORIGIN_STRIDE) {
    const engine = new ForecastEngine({ horizons: HORIZONS });
    for (let i = origin - WARMUP_POINTS + 1; i <= origin; i += 1) {
      const p = points[i]!;
      engine.ingest({
        timestamp: p.timestamp.getTime(),
        temperature: p.temperature,
        humidity: p.humidity,
        pressure: p.airPressure,
      });
    }
    const output = engine.forecast();
    if (!output) continue;
    const anchor = points[origin]!;
    for (let k = 0; k < HORIZONS.length; k += 1) {
      const target = output.horizons[k]!;
      const index = Math.round((target.targetTimestamp - base) / (STEP_SECONDS * 1000));
      if (index <= origin || index >= points.length) continue;
      const actual = points[index]!;
      for (let v = 0; v < VARIABLES.length; v += 1) {
        const variable = VARIABLES[v]!;
        acc.abs[k]![v] = acc.abs[k]![v]! + Math.abs(target.point[POINT_KEY[variable]] - actual[variable]);
        acc.persistence[k]![v] = acc.persistence[k]![v]! + Math.abs(anchor[variable] - actual[variable]);
      }
      acc.count[k] = acc.count[k]! + 1;
    }
  }
}

/** Mean skill of the ensemble against persistence, pooled over all seeds. */
function pooledSkill(): number[][] {
  const acc = emptyAccumulator();
  for (const seed of SEEDS) accumulate(seed, acc);
  return HORIZONS.map((_, k) => {
    const n = Math.max(acc.count[k]!, 1);
    return VARIABLES.map((_, v) => {
      const mae = acc.abs[k]![v]! / n;
      const persistence = acc.persistence[k]![v]! / n;
      return persistence > 1e-9 ? 1 - mae / persistence : 0;
    });
  });
}

describe('forecast accuracy', () => {
  const skill = pooledSkill();

  it('never does clearly worse than persistence', () => {
    // Temperature and humidity must clearly beat persistence at every horizon.
    // Pressure is close to persistence at the short and half-day horizons (its
    // skill hovers around zero), so it only has to avoid a real regression.
    for (let k = 0; k < HORIZONS.length; k += 1) {
      expect(skill[k]![0]!).toBeGreaterThan(0.05);
      expect(skill[k]![1]!).toBeGreaterThan(0.05);
      expect(skill[k]![2]!).toBeGreaterThan(-0.05);
    }
  });

  it('beats persistence on average for every variable', () => {
    for (let v = 0; v < VARIABLES.length; v += 1) {
      const mean = skill.reduce((sum, row) => sum + row[v]!, 0) / skill.length;
      expect(mean).toBeGreaterThan(0.05);
    }
  });

  it('keeps harmonic experts stable on a large offset with a strong cycle', () => {
    // Pressure near 1013 with a semi-diurnal cycle used to make the harmonic fit
    // ill-conditioned and extrapolate hundreds of hPa away. The forecast must
    // stay physically plausible at the far horizon.
    const engine = new ForecastEngine({ horizons: [43200] });
    const start = Date.UTC(2026, 2, 10, 0, 0, 0);
    for (let i = 0; i < WARMUP_POINTS; i += 1) {
      const seconds = i * STEP_SECONDS;
      const sod = ((seconds % 86400) + 86400) % 86400;
      engine.ingest({
        timestamp: start + seconds * 1000,
        temperature: 18 + 4.5 * Math.cos((2 * Math.PI * (sod - 15 * 3600)) / 86400),
        humidity: 60,
        pressure: 1013 + 0.6 * Math.cos((2 * Math.PI * (sod - 10 * 3600)) / 43200),
      });
    }
    const output = engine.forecast();
    expect(output).not.toBeNull();
    const point = output!.horizons[0]!.point;
    expect(Number.isFinite(point.pressure)).toBe(true);
    expect(Math.abs(point.pressure - 1013)).toBeLessThan(20);
    expect(Number.isFinite(point.temperature)).toBe(true);
    expect(Math.abs(point.temperature - 18)).toBeLessThan(20);
  });
});
