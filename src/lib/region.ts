import type { SessionLocation } from '@common';

const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

/** Returns the English display name for a two-letter region code. */
export function getCountryName(code?: string | null): string | undefined {
  if (!code) return undefined;
  try {
    return REGION_DISPLAY_NAMES.of(code.toUpperCase()) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Human-readable "City, Country" label with a sensible fallback. */
export function formatLocation(location?: SessionLocation | null): string {
  const { city, country, countryName } = location ?? {};
  const resolvedCountry = countryName ?? getCountryName(country);
  if (city && resolvedCountry) return `${city}, ${resolvedCountry}`;
  return city ?? resolvedCountry ?? 'Unknown location';
}
