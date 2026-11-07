import type { DataPoint } from '@common';
import * as P from './psychrometrics';

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
    color: '#f8fafc',
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
    color: '#cbd5e1',
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
    color: '#94a3b8',
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
    color: '#a855f7',
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
    color: '#f97316',
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
    color: '#ec4899',
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
    color: '#22d3ee',
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
    color: '#3b82f6',
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
    color: '#14b8a6',
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
    color: '#6366f1',
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
    color: '#84cc16',
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
    color: '#f59e0b',
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
    color: '#f43f5e',
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
    color: '#8b5cf6',
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
