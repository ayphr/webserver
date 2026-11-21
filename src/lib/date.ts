export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Formats a date with the short en-GB convention used throughout the UI. */
export function formatDisplayDate(date: Date | string): string {
  return toDate(date).toLocaleDateString('en-GB');
}

export type RelativeTimeOptions = {
  /** Include year/month/week buckets instead of falling back to an absolute date. */
  detailed?: boolean;
};

function pluralAgo(count: number, unit: string): string {
  return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
}

/**
 * Describes how long ago a date was in human-readable form. By default dates
 * older than a month are shown absolutely; `detailed` keeps them relative.
 */
export function getRelativeTime(date: Date | string, options: RelativeTimeOptions = {}): string {
  const resolved = toDate(date);
  const diffMins = Math.floor((Date.now() - resolved.getTime()) / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (options.detailed) {
    const years = Math.floor(diffDays / 365);
    if (years > 0) return pluralAgo(years, 'year');
    const months = Math.floor(diffDays / 30);
    if (months > 0) return pluralAgo(months, 'month');
    if (diffDays >= 7) return pluralAgo(Math.round(diffDays / 7), 'week');
  } else if (diffDays > 30) {
    return formatDisplayDate(resolved);
  }

  if (diffDays > 0) return pluralAgo(diffDays, 'day');
  if (diffHours > 0) return pluralAgo(diffHours, 'hour');
  if (diffMins > 0) return pluralAgo(diffMins, 'minute');
  return 'just now';
}
