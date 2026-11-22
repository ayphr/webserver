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

function calendarDiff(from: Date, to: Date): { years: number; months: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();

  if (days < 0) {
    months -= 1;
    const daysInPrevMonth = new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    days += daysInPrevMonth;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  // If we borrowed days but the month boundary hasn't fully passed, keep the month diff as-is.
  // `days` is only used to avoid over-counting when the day-of-month hasn't been reached.
  void days;

  return { years: Math.max(0, years), months: Math.max(0, months) };
}

/**
 * Describes how long ago a date was in human-readable form. By default dates
 * older than a month are shown absolutely; `detailed` keeps them relative.
 */
export function getRelativeTime(date: Date | string, options: RelativeTimeOptions = {}): string {
  const resolved = toDate(date);
  const now = new Date();
  const diffMs = now.getTime() - resolved.getTime();

  if (diffMs < 0) return 'just now';

  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (options.detailed) {
    const { years, months } = calendarDiff(resolved, now);
    if (years > 0) return pluralAgo(years, 'year');
    if (months > 0) return pluralAgo(months, 'month');
    if (diffDays >= 7) return pluralAgo(Math.floor(diffDays / 7), 'week');
  } else if (diffDays > 30) {
    return formatDisplayDate(resolved);
  }

  if (diffDays > 0) return pluralAgo(diffDays, 'day');
  if (diffHours > 0) return pluralAgo(diffHours, 'hour');
  if (diffMins > 0) return pluralAgo(diffMins, 'minute');
  return 'just now';
}
