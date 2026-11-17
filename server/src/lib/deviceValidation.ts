import type { DataPoint } from '@common';

const MAX_SERIAL = 0xFFFFFFFF;
const MAX_NAME_LENGTH = 64;
const MAX_POINTS_PER_UPLOAD = 2_000;

export function parseSerial(value: unknown): number | null {
  let serial: number;

  if (typeof value === 'number') {
    serial = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    serial = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(serial) || serial < 0 || serial > MAX_SERIAL) return null;
  return serial;
}

export function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export function parseTimestamp(value: unknown): Date | null {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.round(ms / 1000) * 1000);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseDataPoints(value: unknown): DataPoint[] | null {
  if (!Array.isArray(value) || value.length > MAX_POINTS_PER_UPLOAD) return null;

  const byTimestamp = new Map<number, DataPoint>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const timestamp = parseTimestamp(item.timestamp);

    if (
      !timestamp ||
      !isFiniteNumber(item.temperature) ||
      !isFiniteNumber(item.humidity) ||
      !isFiniteNumber(item.airPressure)
    ) {
      return null;
    }

    byTimestamp.set(timestamp.getTime(), {
      timestamp,
      temperature: item.temperature,
      humidity: item.humidity,
      airPressure: item.airPressure,
    });
  }

  return [...byTimestamp.values()];
}

export function getDeviceToken(body: Record<string, unknown> | null): string | null {
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();
  return null;
}
