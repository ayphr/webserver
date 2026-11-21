import { describe, expect, it } from 'bun:test';
import { computeCurrentUptime } from './deviceUptime';

const now = new Date('2026-01-01T12:00:00Z').getTime();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);

describe('computeCurrentUptime', () => {
  it('is offline without any readings', () => {
    expect(computeCurrentUptime([], now)).toEqual({ online: false, since: null, durationMs: 0 });
  });

  it('is offline when the latest reading is stale', () => {
    expect(computeCurrentUptime([at(10), at(6)], now)).toEqual({
      online: false,
      since: null,
      durationMs: 0,
    });
  });

  it('uses the earliest reading when there is no gap', () => {
    const result = computeCurrentUptime([at(4), at(3), at(2), at(1), at(0)], now);
    expect(result.online).toBe(true);
    expect(result.since?.getTime()).toBe(at(4).getTime());
    expect(result.durationMs).toBe(4 * 60_000);
  });

  it('starts the streak after the most recent outage gap', () => {
    const readings = [
      at(120), at(119), at(118), at(117), at(116),
      ...Array.from({ length: 31 }, (_, index) => at(30 - index)),
    ];
    const result = computeCurrentUptime(readings, now);
    expect(result.online).toBe(true);
    expect(result.since?.getTime()).toBe(at(30).getTime());
    expect(result.durationMs).toBe(30 * 60_000);
  });

  it('scales the gap threshold with the sampling interval', () => {
    // Hourly samples: a 30-minute dip is normal jitter, not an outage.
    const readings = [at(180), at(120), at(60), at(30), at(0)];
    const result = computeCurrentUptime(readings, now);
    expect(result.online).toBe(true);
    expect(result.since?.getTime()).toBe(at(180).getTime());
  });
});
