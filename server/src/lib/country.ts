export type CountryOption = {
  code: string;
  name: string;
};

const INVALID_REGION_CODES = new Set(['EZ', 'UN', 'XA', 'XB', 'ZZ', 'DY', 'HV', 'ZR', 'AN', 'EU', 'FX', 'DD', 'BU', 'QO', 'SU', 'CS', 'YU', 'TP', 'UK', 'NH', 'VD', 'YD', 'RH']);
const REGION_CODE_PATTERN = /^[A-Z]{2}$/;
const regionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });

function getRegionName(code: string): string | null {
  try {
    return regionDisplayNames.of(code) ?? null;
  } catch {
    return null;
  }
}

export function normalizeCountryCode(country: string): string | null {
  const normalized = country.trim().toUpperCase();
  if (!REGION_CODE_PATTERN.test(normalized)) return null;
  if (INVALID_REGION_CODES.has(normalized)) return null;

  const regionName = getRegionName(normalized);
  if (!regionName) return null;
  if (regionName.toUpperCase() === normalized) return null;

  return normalized;
}

function getRegionCandidates(): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;

  if (supportedValuesOf) {
    try {
      return supportedValuesOf('region');
    } catch {
      // ignore and fall back
    }
  }

  const candidates: string[] = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      candidates.push(String.fromCharCode(first, second));
    }
  }

  return candidates;
}

export function getSupportedCountries(): CountryOption[] {
  return getRegionCandidates()
    .map((candidate) => normalizeCountryCode(candidate))
    .filter((code): code is string => Boolean(code))
    .map((code) => ({ code, name: getRegionName(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
