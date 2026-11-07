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
  const rh = Math.max(0.01, Math.min(100, relativeHumidity));
  const gamma = (a * tempC) / (b + tempC) + Math.log(rh / 100);
  return (b * gamma) / (a - gamma);
}

export function wetBulbTemperature(tempC: number, relativeHumidity: number): number {
  const rh = Math.max(0, Math.min(100, relativeHumidity));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

export function absoluteHumidity(tempC: number, relativeHumidity: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  const tK = toKelvin(tempC);
  return (e * 216.677) / tK;
}

export function humidityRatio(tempC: number, relativeHumidity: number, pressureHpa: number): number {
  const e = actualVapourPressure(tempC, relativeHumidity);
  const p = pressureHpa;
  const w = 0.622 * (e / Math.max(0.001, p - e));
  return w * 1000;
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
  const w = humidityRatio(tempC, relativeHumidity, pressureHpa) / 1000;
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
  toKelvin,
  saturationVapourPressure,
  actualVapourPressure,
  vapourPressureDeficit,
  dewPointTemperature,
  wetBulbTemperature,
  absoluteHumidity,
  humidityRatio,
  moistAirDensity,
  enthalpy,
  apparentTemperature,
  dewPointDeficit,
};
