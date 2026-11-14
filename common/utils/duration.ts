export type DurationUnit = 's' | 'm' | 'h' | 'd' | 'w';

const UNIT_SECONDS: Record<DurationUnit, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
  w: 7 * 24 * 60 * 60,
};

/**
 * Parses a compact duration such as "5s", "3m", "1h30m" or "1w2d" into seconds.
 * A bare number is interpreted using `defaultUnit`. Returns undefined when the
 * input is empty or contains no recognisable quantity.
 */
export function parseDuration(input: string, defaultUnit: DurationUnit = 's'): number | undefined {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return undefined;

  const unitPattern = /(\d+(?:\.\d+)?)\s*(w|d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = unitPattern.exec(trimmed)) !== null) {
    matched = true;
    total += Number.parseFloat(match[1]!) * UNIT_SECONDS[match[2] as DurationUnit];
  }

  if (!matched) {
    const bare = Number.parseFloat(trimmed);
    if (!Number.isFinite(bare) || bare <= 0) return undefined;
    return bare * UNIT_SECONDS[defaultUnit];
  }

  return total > 0 ? total : undefined;
}

/** Human-readable duration, e.g. 5400 -> "1 hour 30 minutes". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Empty';

  if (seconds < 60) {
    const whole = Math.round(seconds);
    return `${whole} second${whole === 1 ? '' : 's'}`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins > 0) return `${hours} hour${hours === 1 ? '' : 's'} ${mins} minute${mins === 1 ? '' : 's'}`;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days < 7) {
    if (remainingHours > 0) return `${days} day${days === 1 ? '' : 's'} ${remainingHours} hour${remainingHours === 1 ? '' : 's'}`;
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  if (remainingDays > 0) return `${weeks} week${weeks === 1 ? '' : 's'} ${remainingDays} day${remainingDays === 1 ? '' : 's'}`;
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}
