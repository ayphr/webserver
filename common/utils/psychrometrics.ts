/**
 * Shared psychrometric equations used by both the client (derived telemetry
 * series) and the server (forecast state estimation). Keeping a single
 * implementation avoids the two sides drifting apart.
 */

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function toKelvin(tempC: number): number {
  return tempC + 273.15;
}

export function saturationVapourPressure(tempC: number): number {
  return 6.1078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

export function actualVapourPressure(tempC: number, relativeHumidity: number): number {
  return saturationVapourPressure(tempC) * (relativeHumidity / 100);
}

export function vapourPressureDeficit(tempC: number, relativeHumidity: number): number {
  return saturationVapourPressure(tempC) - actualVapourPressure(tempC, relativeHumidity);
}

export function dewPointTemperature(tempC: number, relativeHumidity: number): number {
  const a = 17.27;
  const b = 237.7;
  const rh = clamp(relativeHumidity, 0.01, 100);
  const gamma = (a * tempC) / (b + tempC) + Math.log(rh / 100);
  return (b * gamma) / (a - gamma);
}

export function wetBulbTemperature(tempC: number, relativeHumidity: number): number {
  const rh = clamp(relativeHumidity, 0, 100);
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/**
 * Humidity mixing ratio in kg of water vapour per kg of dry air, the
 * mass-conserved prognostic variable the forecast engine extrapolates.
 */
export function mixingRatio(tempC: number, relativeHumidity: number, pressureHpa: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  return 0.62198 * (e / Math.max(1, pressureHpa - e));
}

/** Inverse of {@link mixingRatio}: actual vapour pressure (hPa) from mixing ratio (kg/kg). */
export function vapourPressureFromMixingRatio(mixingRatioKgKg: number, pressureHpa: number): number {
  const w = Math.max(0, mixingRatioKgKg);
  return (w * pressureHpa) / (0.62198 + w);
}

/** Reconstructs relative humidity (%) from temperature, mixing ratio and pressure. */
export function relativeHumidityFromMixingRatio(
  tempC: number,
  mixingRatioKgKg: number,
  pressureHpa: number,
): number {
  const ea = vapourPressureFromMixingRatio(mixingRatioKgKg, pressureHpa);
  const es = saturationVapourPressure(tempC);
  if (es <= 0) return 0;
  return clamp((100 * ea) / es, 0, 100);
}

/** Humidity ratio in grams of water vapour per kg of dry air. */
export function humidityRatio(tempC: number, relativeHumidity: number, pressureHpa: number): number {
  return mixingRatio(tempC, relativeHumidity, pressureHpa) * 1000;
}

export function absoluteHumidity(tempC: number, relativeHumidity: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  const tK = toKelvin(tempC);
  return (e * 216.677) / tK;
}

export function moistAirDensity(tempC: number, relativeHumidity: number, pressureHpa: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  const tK = toKelvin(tempC);
  const pPa = pressureHpa * 100;
  const ePa = e * 100;
  const rd = 287.058;
  const rv = 461.495;
  return (pPa - ePa) / (rd * tK) + ePa / (rv * tK);
}

export function enthalpy(tempC: number, relativeHumidity: number, pressureHpa: number): number {
  const w = mixingRatio(tempC, relativeHumidity, pressureHpa);
  return 1.006 * tempC + w * (2501 + 1.86 * tempC);
}

export function apparentTemperature(tempC: number, relativeHumidity: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  return tempC + 0.348 * e - 4.25;
}

export function dewPointDeficit(tempC: number, relativeHumidity: number): number {
  return tempC - dewPointTemperature(tempC, relativeHumidity);
}

export const psychrometrics = {
  clamp,
  toKelvin,
  saturationVapourPressure,
  actualVapourPressure,
  vapourPressureDeficit,
  dewPointTemperature,
  wetBulbTemperature,
  mixingRatio,
  vapourPressureFromMixingRatio,
  relativeHumidityFromMixingRatio,
  humidityRatio,
  moistAirDensity,
  enthalpy,
  apparentTemperature,
  dewPointDeficit,
};
