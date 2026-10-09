import type { SessionDeviceType, SessionLocation } from '@common';
import { normalizeCountryCode } from './country';

const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

function getCountryName(code: string): string | undefined {
  try {
    const name = regionDisplayNames.of(code);
    return name && name.toUpperCase() !== code ? name : undefined;
  } catch {
    return undefined;
  }
}

function isValidTimezone(timezone: string): boolean {
  if (!TIMEZONE_PATTERN.test(timezone)) return false;
  if (timezone === 'UTC' || timezone === 'GMT') return true;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function extractRegionFromLocale(locale?: string): string | null {
  if (!locale) return null;

  try {
    const region = new Intl.Locale(locale).region;
    return region ? normalizeCountryCode(region) : null;
  } catch {
    return null;
  }
}

/**
 * Builds an approximate location from client-provided timezone and locale.
 * The timezone's trailing segment doubles as a city hint (e.g. `America/New_York`).
 */
export function resolveLocationFromClient(input: { timezone?: string; locale?: string }): SessionLocation {
  const location: SessionLocation = {};

  const timezone = input.timezone?.trim();
  if (timezone && isValidTimezone(timezone)) {
    location.timezone = timezone;

    const segments = timezone.split('/');
    const city = segments[segments.length - 1]?.replace(/_/g, ' ');
    if (city && !city.startsWith('GMT') && !/^[+-]?\d/.test(city)) {
      location.city = city;
    }

    if (segments.length > 2) {
      location.region = segments[segments.length - 2]?.replace(/_/g, ' ');
    }
  }

  const country = extractRegionFromLocale(input.locale);
  if (country) {
    location.country = country;
    location.countryName = getCountryName(country);
  }

  return location;
}

function detectBrowser(userAgent: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)|Opera\/(\d+)/, 'Opera'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/ CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).+Safari/, 'Safari'],
  ];

  for (const [pattern, name] of patterns) {
    const match = pattern.exec(userAgent);
    const version = match?.[1] ?? match?.[2];
    if (match) {
      return version ? `${name} ${version}` : name;
    }
  }

  return undefined;
}

function detectOs(userAgent: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/Windows NT ([\d.]+)/, 'Windows'],
    [/Android ([\d.]+)/, 'Android'],
    [/(?:iPhone|iPad|iPod).*?OS ([\d_]+)/, 'iOS'],
    [/Mac OS X ([\d_]+)/, 'macOS'],
    [/Linux/, 'Linux'],
  ];

  for (const [pattern, name] of patterns) {
    const match = pattern.exec(userAgent);
    if (match) {
      const version = match[1]?.replace(/_/g, '.');
      return version ? `${name} ${version}` : name;
    }
  }

  return undefined;
}

function detectDeviceType(userAgent: string): SessionDeviceType | undefined {
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(userAgent)) return 'mobile';
  if (userAgent) return 'desktop';
  return undefined;
}

export function parseUserAgent(userAgent?: string | null): {
  browser?: string;
  os?: string;
  deviceType?: SessionDeviceType;
} {
  if (!userAgent) return {};

  return {
    browser: detectBrowser(userAgent),
    os: detectOs(userAgent),
    deviceType: detectDeviceType(userAgent),
  };
}
