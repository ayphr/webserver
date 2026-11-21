import type { DeviceUptime } from '../types/device';

/** A reading older than this means the device is no longer reporting. */
export const DEVICE_ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

/** Shortest gap that is treated as an outage, regardless of sampling rate. */
const MIN_OUTAGE_GAP_MS = 5 * 60 * 1000;

const OFFLINE: DeviceUptime = { online: false, since: null, durationMs: 0 };

/**
 * Derives the current uninterrupted reporting streak from a device's recent
 * telemetry timestamps. A gap longer than 10x the median sample interval (with
 * a five-minute floor) marks the start of the current streak.
 */
export function computeCurrentUptime(timestamps: Date[], now = Date.now()): DeviceUptime {
  const times = timestamps
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (times.length === 0) return OFFLINE;

  const latest = times[times.length - 1]!;
  if (now - latest > DEVICE_ONLINE_THRESHOLD_MS) return OFFLINE;

  let gapThreshold = MIN_OUTAGE_GAP_MS;
  if (times.length >= 3) {
    const deltas: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const delta = times[i]! - times[i - 1]!;
      if (delta > 0) deltas.push(delta);
    }
    if (deltas.length > 0) {
      deltas.sort((a, b) => a - b);
      gapThreshold = Math.max(MIN_OUTAGE_GAP_MS, deltas[Math.floor(deltas.length / 2)]! * 10);
    }
  }

  let streakStartIndex = 0;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i]! - times[i - 1]! > gapThreshold) streakStartIndex = i;
  }

  const streakStart = times[streakStartIndex]!;
  return { online: true, since: new Date(streakStart), durationMs: Math.max(0, now - streakStart) };
}
