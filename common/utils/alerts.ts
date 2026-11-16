import type { AlertCondition, AlertLogic, AlertMetric } from '../types/alert';
import type { DataPoint } from '../types/device';

export function getAlertMetricValue(
  reading: Pick<DataPoint, 'temperature' | 'humidity' | 'airPressure'>,
  metric: AlertMetric,
): number {
  switch (metric) {
    case 'temperature':
      return reading.temperature;
    case 'humidity':
      return reading.humidity;
    case 'airPressure':
      return reading.airPressure;
    default:
      return Number.NaN;
  }
}

function conditionMatches(
  condition: AlertCondition,
  reading: Pick<DataPoint, 'temperature' | 'humidity' | 'airPressure'>,
): boolean {
  const value = getAlertMetricValue(reading, condition.metric);
  if (!Number.isFinite(value)) return false;
  return condition.operator === 'lt' ? value < condition.value : value > condition.value;
}

export function evaluateAlertConditions(
  conditions: AlertCondition[],
  logic: AlertLogic,
  reading: Pick<DataPoint, 'temperature' | 'humidity' | 'airPressure'>,
): boolean {
  if (conditions.length === 0) return false;
  return logic === 'and'
    ? conditions.every((condition) => conditionMatches(condition, reading))
    : conditions.some((condition) => conditionMatches(condition, reading));
}
