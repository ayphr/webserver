const creditFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

/** Formats a credit amount for display, keeping fractional credits readable. */
export function formatCredits(value: number): string {
  return creditFormatter.format(value);
}

/** Formats a credit reset date in the server's timezone, matching the reset boundary. */
export function formatCreditDate(date: Date, timeZone?: string): string {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  });
}
