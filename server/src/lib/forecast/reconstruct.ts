import {
  dewPointTemperature,
  relativeHumidityFromMixingRatio,
  saturationVapourPressure,
  vapourPressureFromMixingRatio,
  wetBulbTemperature,
} from '@common';
import type { ReconstructedForecast } from './types';

const DRY_AIR_GAS_CONSTANT = 287.058;
const WATER_VAPOUR_GAS_CONSTANT = 461.495;
const ABSOLUTE_HUMIDITY_FACTOR = 216.677;

/**
 * Inverse psychrometric reconstruction: given the three prognostic variables a
 * model extrapolates, recover every derived quantity the client may render.
 */
export function reconstructForecast(
  temperature: number,
  mixingRatio: number,
  pressure: number,
): ReconstructedForecast {
  const w = Math.max(0, mixingRatio);
  const actualVapourPressure = vapourPressureFromMixingRatio(w, pressure);
  const saturation = saturationVapourPressure(temperature);
  const humidity = relativeHumidityFromMixingRatio(temperature, w, pressure);
  const temperatureKelvin = temperature + 273.15;

  const pressurePa = pressure * 100;
  const vapourPa = actualVapourPressure * 100;
  const absoluteHumidity =
    temperatureKelvin > 0 ? (actualVapourPressure * ABSOLUTE_HUMIDITY_FACTOR) / temperatureKelvin : 0;
  const moistAirDensity =
    temperatureKelvin > 0
      ? (pressurePa - vapourPa) / (DRY_AIR_GAS_CONSTANT * temperatureKelvin) +
        vapourPa / (WATER_VAPOUR_GAS_CONSTANT * temperatureKelvin)
      : 0;

  return {
    temperature,
    humidity,
    pressure,
    saturationVapourPressure: saturation,
    actualVapourPressure,
    dewPoint: dewPointTemperature(temperature, humidity),
    vapourPressureDeficit: Math.max(0, saturation - actualVapourPressure),
    mixingRatio: w,
    absoluteHumidity,
    enthalpy: 1.006 * temperature + w * (2501 + 1.86 * temperature),
    wetBulb: wetBulbTemperature(temperature, humidity),
    moistAirDensity,
  };
}
