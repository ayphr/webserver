import type { PlanFeatures } from '@common';
import { estimateQueryComputeUnits } from '@common';
import { calculateQueryCreditCost } from './deviceDataService';

export const MAX_DEVICE_QUERY_LENGTH = 10_000;

export type DeviceQueryPlan = {
  query: string;
  computeUnits: number;
  creditCost: number;
};

export function createDeviceQueryPlan(
  query: string,
  pointCount: number,
  features: Pick<PlanFeatures, 'queryComputeUnitLimit' | 'queryCostCredits'>,
): DeviceQueryPlan {
  const normalized = query.trim();
  if (!normalized) throw new Error('query is required');
  if (normalized.length > MAX_DEVICE_QUERY_LENGTH) {
    throw new Error(`query must be ${MAX_DEVICE_QUERY_LENGTH.toLocaleString()} characters or fewer`);
  }

  const estimate = estimateQueryComputeUnits(normalized, pointCount);
  if (estimate.units > features.queryComputeUnitLimit) {
    throw new Error(`query exceeds your plan's compute unit limit of ${features.queryComputeUnitLimit}`);
  }

  return {
    query: normalized,
    computeUnits: estimate.units,
    creditCost: calculateQueryCreditCost(estimate.units, features),
  };
}
