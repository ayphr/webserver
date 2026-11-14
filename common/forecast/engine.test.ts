import { describe, expect, it } from 'bun:test';
import type { DataPoint } from '../types';
import { FORECAST_HORIZON_SECONDS, FORECAST_STEP_SECONDS } from '../types';
import { ForecastEngine, forecastFromHistory, forecastHorizons } from './index';

type Generator = (index: number, seconds: number) => { temperature: number; humidity: number; airPressure: number };

function buildHistory(count: number, stepSeconds: number, generator: Generator): DataPoint[] {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const points: DataPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const seconds = i * stepSeconds;
    const values = generator(i, seconds);
    points.push({ timestamp: new Date(start + seconds * 1000), ...values });
  }
  return points;
}

function constant(value: { temperature: number; humidity: number; airPressure: number }): Generator {
  return () => value;
}

describe('forecast engine', () => {
  it('returns null when there is not enough history', async () => {
    expect(await forecastFromHistory([])).toBeNull();
    expect(
      await forecastFromHistory(buildHistory(2, 60, constant({ temperature: 20, humidity: 50, airPressure: 1013 }))),
    ).toBeNull();
  });

  it('produces one finite sample per horizon', async () => {
    const history = buildHistory(240, 60, constant({ temperature: 21, humidity: 55, airPressure: 1010 }));
    const output = await forecastFromHistory(history);
    expect(output).not.toBeNull();
    expect(output!.horizons).toHaveLength(forecastHorizons().length);
    expect(output!.horizons).toHaveLength(FORECAST_HORIZON_SECONDS / FORECAST_STEP_SECONDS);
    for (const horizon of output!.horizons) {
      expect(Number.isFinite(horizon.point.temperature)).toBe(true);
      expect(Number.isFinite(horizon.point.humidity)).toBe(true);
      expect(Number.isFinite(horizon.point.pressure)).toBe(true);
      expect(horizon.point.humidity).toBeGreaterThanOrEqual(0);
      expect(horizon.point.humidity).toBeLessThanOrEqual(100);
      expect(horizon.uncertainty.temperature).toBeGreaterThanOrEqual(0);
      expect(horizon.targetTimestamp).toBe(output!.anchorTimestamp + horizon.horizonSeconds * 1000);
    }
  });

  it('keeps a constant series near its value', async () => {
    const history = buildHistory(300, 60, constant({ temperature: 21, humidity: 55, airPressure: 1010 }));
    const output = (await forecastFromHistory(history))!;
    const last = output.horizons[output.horizons.length - 1]!;
    expect(Math.abs(last.point.temperature - 21)).toBeLessThan(3);
    expect(Math.abs(last.point.humidity - 55)).toBeLessThan(6);
    expect(Math.abs(last.point.pressure - 1010)).toBeLessThan(2);
  });

  it('extrapolates a warming trend upward', async () => {
    const history = buildHistory(240, 60, (_i, seconds) => ({
      temperature: 15 + (seconds / 3600) * 0.5,
      humidity: 60,
      airPressure: 1005,
    }));
    const output = (await forecastFromHistory(history))!;
    const first = output.horizons[0]!;
    const last = output.horizons[output.horizons.length - 1]!;
    expect(last.point.temperature).toBeGreaterThan(first.point.temperature);
    expect(last.point.temperature).toBeGreaterThan(15);
  });

  it('is deterministic for identical input', async () => {
    const history = buildHistory(200, 60, (i) => ({
      temperature: 20 + Math.sin(i / 12) * 3,
      humidity: 50 + Math.cos(i / 9) * 8,
      airPressure: 1013 + Math.sin(i / 20) * 2,
    }));
    const a = (await forecastFromHistory(history))!;
    const b = (await forecastFromHistory(history))!;
    expect(a.horizons.map((h) => h.point.temperature)).toEqual(b.horizons.map((h) => h.point.temperature));
  });

  it('rejects out-of-order and implausible observations', () => {
    const engine = new ForecastEngine({ horizons: [300] });
    expect(engine.ingest({ timestamp: 1000, temperature: 20, humidity: 50, pressure: 1010 })).toBe(true);
    expect(engine.ingest({ timestamp: 1000, temperature: 20, humidity: 50, pressure: 1010 })).toBe(false);
    expect(engine.ingest({ timestamp: 2000, temperature: 20, humidity: 50, pressure: 0 })).toBe(false);
  });
});
