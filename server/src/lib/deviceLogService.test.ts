import { describe, expect, test } from 'bun:test';
import { buildDeviceLogQuery, parseDeviceLogFilter, type DeviceLogFilter } from './deviceLogService';

describe('device log filters', () => {
  test('treats all as no filter and parses valid values', () => {
    const all = parseDeviceLogFilter(new URLSearchParams('level=all&event=all'));
    expect(all.error).toBeNull();
    expect(all.filter.level).toBeUndefined();
    expect(all.filter.event).toBeUndefined();
    expect(all.filter.q).toBeUndefined();
    expect(all.filter.cutoff).toBeInstanceOf(Date);

    const cutoff = new Date('2026-01-01T00:00:00Z');
    const parsed = parseDeviceLogFilter(new URLSearchParams(
      'level=error&event=upload_error&q=%20disk%20full%20&from=2026-01-01T00%3A00%3A00Z&to=2026-01-02T00%3A00%3A00Z',
    ));
    parsed.filter.cutoff = cutoff;
    expect(parsed.error).toBeNull();
    expect(parsed.filter).toEqual({
      level: 'error',
      event: 'upload_error',
      q: 'disk full',
      from: new Date('2026-01-01T00:00:00Z'),
      to: new Date('2026-01-02T00:00:00Z'),
      cutoff,
    });
  });

  test('rejects invalid filters', () => {
    const cases = [
      'level=debug',
      'event=unknown',
      `q=${'x'.repeat(101)}`,
      'from=Jan%202%202026',
      'to=not-a-date',
      'from=2026-01-02T00%3A00%3A00Z&to=2026-01-01T00%3A00%3A00Z',
    ];

    for (const query of cases) {
      const result = parseDeviceLogFilter(new URLSearchParams(query));
      expect(result.error).toBeTruthy();
    }
  });

  test('builds one query shape for both list and count reads', () => {
    const filter: DeviceLogFilter = {
      level: 'warning',
      event: 'rate_limited',
      q: 'a.b',
      from: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      to: new Date(Date.now() - 24 * 60 * 60 * 1000),
    };
    const query = buildDeviceLogQuery(42, filter);
    const createdAt = query.createdAt as Record<string, Date>;

    expect(query.serial).toBe(42);
    expect(createdAt.$gte).toEqual(filter.from);
    expect(createdAt.$lte).toEqual(filter.to);
    expect(query.level).toBe('warning');
    expect(query.event).toBe('rate_limited');
    expect(query.$or).toEqual([
      { message: { $regex: 'a\\.b', $options: 'i' } },
      { event: { $regex: 'a\\.b', $options: 'i' } },
    ]);
    expect(buildDeviceLogQuery(42, filter)).toEqual(query);
  });

  test('never reads beyond the log retention window', () => {
    const query = buildDeviceLogQuery(7);
    const createdAt = query.createdAt as Record<string, Date>;
    expect(createdAt.$gte!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(createdAt.$gte!.getTime()).toBeGreaterThan(Date.now() - 31 * 24 * 60 * 60 * 1000);
  });
});
