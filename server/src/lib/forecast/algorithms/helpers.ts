import type { RingBuffer } from '../ringBuffer';
import type { ForecastTriple, StateFrame } from '../types';
import { emptyTriple } from '../types';
import { variance } from '../math';

export const PROGNOSTIC_VARIABLES = ['temperature', 'mixingRatio', 'pressure'] as const;

export type PrognosticVariable = (typeof PROGNOSTIC_VARIABLES)[number];

export function frameValue(frame: StateFrame, index: number): number {
  if (index === 0) return frame.temperature;
  if (index === 1) return frame.mixingRatio;
  return frame.pressure;
}

export function setTriple(triple: ForecastTriple, index: number, value: number): void {
  if (index === 0) triple.temperature = value;
  else if (index === 1) triple.mixingRatio = Math.max(0, value);
  else triple.pressure = value;
}

export function tripleFrom(values: number[]): ForecastTriple {
  const triple = emptyTriple();
  for (let v = 0; v < PROGNOSTIC_VARIABLES.length; v += 1) {
    setTriple(triple, v, values[v] ?? Number.NaN);
  }
  return triple;
}

/** Converts a horizon in seconds to a whole number of sample steps. */
export function horizonSteps(horizonSeconds: number, meanDt: number): number {
  return Math.max(1, Math.round(horizonSeconds / Math.max(meanDt, 1e-3)));
}

/** Rate-limited exponential decay used by damped-trend forecasts. */
export function dampedTrendSum(phi: number, steps: number): number {
  if (steps <= 0) return 0;
  if (Math.abs(phi - 1) < 1e-9) return steps;
  return (phi * (1 - phi ** steps)) / (1 - phi);
}

export function series(
  buffer: RingBuffer<StateFrame>,
  selector: (frame: StateFrame) => number,
  limit?: number,
): number[] {
  const frames = limit !== undefined ? buffer.recent(limit) : buffer.toArray();
  return frames.map(selector);
}

export function seriesTimes(buffer: RingBuffer<StateFrame>, limit?: number): number[] {
  const frames = limit !== undefined ? buffer.recent(limit) : buffer.toArray();
  return frames.map((frame) => frame.timestamp);
}

/** Variance of the most recent `limit` values of a variable, used to scale noise. */
export function recentVariance(
  buffer: RingBuffer<StateFrame>,
  index: number,
  limit = 32,
): number {
  const values = buffer.recent(limit).map((frame) => frameValue(frame, index));
  return variance(values);
}
