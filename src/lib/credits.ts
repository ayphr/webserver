const creditFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

/** Formats a credit amount for display, keeping fractional credits readable. */
export function formatCredits(value: number): string {
  return creditFormatter.format(value);
}

/** Formats a credit date and time in the viewer's local timezone. */
export function formatCreditDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

