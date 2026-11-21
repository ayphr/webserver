import type { PlanFeatures, QueryType } from '@common';
import { estimateQueryComputeUnits } from '@common';
import { calculateQueryCreditCost, getQueryCreditRate } from './deviceDataService';

export const MAX_DEVICE_QUERY_LENGTH = 10_000;

export type DeviceQueryPlan = {
  query: string;
  type: QueryType;
  computeUnits: number;
  creditCost: number;
  creditRate: number;
};

export function createDeviceQueryPlan(
  query: string,
  pointCount: number,
  features: Pick<PlanFeatures, 'queryComputeUnitLimit' | 'queryCostCredits' | 'boostedQueryCostCredits'>,
  type: QueryType = 'standard',
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
    type,
    computeUnits: estimate.units,
    creditCost: calculateQueryCreditCost(estimate.units, features, type),
    creditRate: getQueryCreditRate(features, type),
  };
}
