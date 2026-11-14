import type { DataPoint } from '@common';
import * as P from '@common';

export type SeriesId =
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'vpd'
  | 'absoluteHumidity'
  | 'actualVapourPressure'
  | 'saturatedVapourPressure'
  | 'dewPoint'
  | 'wetBulb'
  | 'humidityRatio'
  | 'moistAirDensity'
  | 'enthalpy'
  | 'apparentTemp'
  | 'dewPointDeficit';

export type SeriesDefinition = {
  id: SeriesId;
  /** Display label used in dropdowns, legends and summaries. */
  label: string;
  /** Short label for summary columns. */
  shortLabel: string;
  unit: string;
  color: string;
  dash: number[];
  defaultEnabled: boolean;
  isCalculated: boolean;
  getValue: (point: DataPoint) => number;
};

export const SERIES_DEFINITIONS: SeriesDefinition[] = [
  {
    id: 'temperature',
    label: 'Temperature (°C)',
    shortLabel: 'Temperature',
    unit: '°C',
    color: 'var(--accent-green-solid)',
    dash: [],
    defaultEnabled: true,
    isCalculated: false,
    getValue: (p) => p.temperature,
  },
  {
    id: 'humidity',
    label: 'Relative Humidity (%)',
    shortLabel: 'Humidity',
    unit: '%',
    color: 'var(--accent-yellow-solid)',
    dash: [5, 4],
    defaultEnabled: true,
    isCalculated: false,
    getValue: (p) => p.humidity,
  },
  {
    id: 'pressure',
    label: 'Pressure (hPa)',
    shortLabel: 'Pressure',
    unit: 'hPa',
    color: 'var(--accent-red-solid)',
    dash: [2, 3],
    defaultEnabled: true,
    isCalculated: false,
    getValue: (p) => p.airPressure,
  },
  {
    id: 'vpd',
    label: 'Vapour Pressure Deficit (hPa)',
    shortLabel: 'VPD',
    unit: 'hPa',
    color: 'var(--accent-purple-solid)',
    dash: [6, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.vapourPressureDeficit(p.temperature, p.humidity),
  },
  {
    id: 'absoluteHumidity',
    label: 'Absolute Humidity (g/m³)',
    shortLabel: 'Abs. Humidity',
    unit: 'g/m³',
    color: 'var(--accent-orange-solid)',
    dash: [1, 3],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.absoluteHumidity(p.temperature, p.humidity),
  },
  {
    id: 'actualVapourPressure',
    label: 'Actual Vapour Pressure (hPa)',
    shortLabel: 'Actual VP',
    unit: 'hPa',
    color: 'var(--accent-pink-solid)',
    dash: [4, 4],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.actualVapourPressure(p.temperature, p.humidity),
  },
  {
    id: 'saturatedVapourPressure',
    label: 'Saturated Vapour Pressure (hPa)',
    shortLabel: 'Sat. VP',
    unit: 'hPa',
    color: 'var(--accent-aqua-solid)',
    dash: [8, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.saturationVapourPressure(p.temperature),
  },
  {
    id: 'dewPoint',
    label: 'Dew Point Temp (°C)',
    shortLabel: 'Dew Point',
    unit: '°C',
    color: 'var(--accent-blue-solid)',
    dash: [3, 3],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.dewPointTemperature(p.temperature, p.humidity),
  },
  {
    id: 'wetBulb',
    label: 'Wet Bulb Temp (°C)',
    shortLabel: 'Wet Bulb',
    unit: '°C',
    color: 'var(--accent-teal-solid)',
    dash: [2, 2, 6, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.wetBulbTemperature(p.temperature, p.humidity),
  },
  {
    id: 'humidityRatio',
    label: 'Humidity Ratio (g/kg)',
    shortLabel: 'Hum. Ratio',
    unit: 'g/kg',
    color: 'var(--accent-indigo-solid)',
    dash: [7, 3, 1, 3],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.humidityRatio(p.temperature, p.humidity, p.airPressure),
  },
  {
    id: 'moistAirDensity',
    label: 'Moist Air Density (kg/m³)',
    shortLabel: 'Moist Air Density',
    unit: 'kg/m³',
    color: 'var(--accent-lime-solid)',
    dash: [5, 2, 1, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.moistAirDensity(p.temperature, p.humidity, p.airPressure),
  },
  {
    id: 'enthalpy',
    label: 'Enthalpy (kJ/kg)',
    shortLabel: 'Enthalpy',
    unit: 'kJ/kg',
    color: 'var(--accent-amber-solid)',
    dash: [4, 2, 1, 2, 1, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.enthalpy(p.temperature, p.humidity, p.airPressure),
  },
  {
    id: 'apparentTemp',
    label: 'Apparent Temp (°C)',
    shortLabel: 'Apparent Temp',
    unit: '°C',
    color: 'var(--accent-rose-solid)',
    dash: [2, 4],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.apparentTemperature(p.temperature, p.humidity),
  },
  {
    id: 'dewPointDeficit',
    label: 'Dew Point Deficit (°C)',
    shortLabel: 'Dew Point Deficit',
    unit: '°C',
    color: 'var(--accent-violet-solid)',
    dash: [1, 2, 3, 2],
    defaultEnabled: false,
    isCalculated: true,
    getValue: (p) => P.dewPointDeficit(p.temperature, p.humidity),
  },
];

export function getSeriesDefinition(id: SeriesId): SeriesDefinition | undefined {
  return SERIES_DEFINITIONS.find((s) => s.id === id);
}

export function getSeriesValue(id: SeriesId, point: DataPoint): number {
  const def = getSeriesDefinition(id);
  if (!def) return NaN;
  return def.getValue(point);
}
