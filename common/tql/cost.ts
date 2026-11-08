import type { AggregationFunction, ASTNode, PipelineStepAST, QueryAST } from './ast';

/**
 * One line item in a query's compute-unit estimate.
 */
export interface ComputeCostPart {
  label: string;
  units: number;
}

/**
 * A static, relative estimate of how computationally expensive a query is.
 * The numbers are intentionally dataset-independent: they describe the work
 * implied by the query shape, not the number of points it will scan.
 */
export interface ComputeEstimate {
  units: number;
  parts: ComputeCostPart[];
}

/** Fixed cost of walking the candidate dataset once. */
const SCAN_BASELINE = 0.5;

const ROOT_ACTION_UNITS: Record<QueryAST['action'], number> = {
  findAll: 0.1,
  select: 0.1,
  findFirst: 0.05,
  findLast: 0.05,
  count: 0.2,
  exists: 0.2,
};

const AGGREGATION_UNITS: Record<AggregationFunction, number> = {
  count: 0.05,
  first: 0.05,
  last: 0.05,
  avg: 0.1,
  min: 0.1,
  max: 0.1,
  sum: 0.1,
  median: 0.2,
  stddev: 0.2,
};

const PIPELINE_LABELS: Record<PipelineStepAST['type'], string> = {
  sortAscending: 'sortAscending',
  sortDescending: 'sortDescending',
  limit: 'limit',
  offset: 'offset',
  slice: 'slice',
  head: 'head',
  tail: 'tail',
  timeRange: 'timeRange',
  select: 'select',
  project: 'project',
  omit: 'omit',
  rename: 'rename',
  distinct: 'distinct',
  dedup: 'dedup',
  dropNulls: 'dropNulls',
  fill: 'fill',
  fillPrevious: 'fillPrevious',
  clamp: 'clamp',
  movingAverage: 'movingAverage',
  rate: 'rate',
  diff: 'diff',
  window: 'window',
  resample: 'resample',
  aggregate: 'aggregate',
  summary: 'summary',
  filter: 'filter',
  compute: 'compute',
  groupBy: 'groupBy',
};

function roundUnits(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Estimates the cost of evaluating a predicate for a single point. Different
 * condition kinds do different amounts of work (regexes and range checks are
 * heavier than a simple presence test).
 */
export function estimatePredicateUnits(node: ASTNode): number {
  switch (node.type) {
    case 'standard':
      // Comparing two fields requires a second property lookup.
      return typeof node.value === 'object' ? 0.15 : 0.1;
    case 'tolerance':
      return 0.2;
    case 'in':
      return 0.1 + node.values.length * 0.02;
    case 'between':
      return 0.2;
    case 'nullCheck':
    case 'presence':
      return 0.05;
    case 'stringPattern':
      return node.op === '=~' || node.op === '!~' ? 0.25 : 0.15;
    case 'not':
      return 0.05 + estimatePredicateUnits(node.expr);
    case 'logical':
      return 0.05 + estimatePredicateUnits(node.left) + estimatePredicateUnits(node.right);
  }
}

/**
 * Estimates the cost of a single `compute(...)` math expression, based on how
 * many tokens the evaluator has to walk.
 */
export function estimateExpressionUnits(expression: string): number {
  const tokens = expression.match(/[a-zA-Z_][\w.]*|\d+(?:\.\d+)?|[+\-*/%()]/g) ?? [];
  return 0.1 + tokens.length * 0.025;
}

/**
 * Estimates the cost of a pipeline step. Sorting, windowing and grouping are
 * the expensive operations; projections and pagination are nearly free.
 */
export function estimatePipelineStepUnits(step: PipelineStepAST): number {
  switch (step.type) {
    case 'sortAscending':
    case 'sortDescending':
      return 0.8;
    case 'limit':
    case 'offset':
    case 'head':
    case 'tail':
    case 'slice':
      return 0.05;
    case 'timeRange':
      return 0.1;
    case 'select':
    case 'project':
    case 'omit':
      return 0.05 + step.fields.length * 0.01;
    case 'rename':
    case 'fill':
    case 'fillPrevious':
    case 'clamp':
      return 0.1;
    case 'distinct':
    case 'dedup':
      return 0.5;
    case 'dropNulls':
      return 0.1 + step.fields.length * 0.02;
    case 'movingAverage':
      return 0.6;
    case 'rate':
    case 'diff':
      return 0.2;
    case 'window':
    case 'resample':
      return 1 + AGGREGATION_UNITS[step.aggregation];
    case 'aggregate':
      return 0.3 + AGGREGATION_UNITS[step.function];
    case 'summary':
      return 0.4 + (step.fields ? step.fields.length * 0.2 : 0.6);
    case 'filter':
      return 0.2 + estimatePredicateUnits(step.filter);
    case 'compute':
      return 0.2 + estimateExpressionUnits(step.expression);
    case 'groupBy':
      return 0.5;
  }
}

/**
 * Produces a static compute-unit estimate plus a per-part breakdown for a
 * parsed query.
 */
export function estimateComputeUnits(ast: QueryAST): ComputeEstimate {
  const parts: ComputeCostPart[] = [
    { label: 'Scan dataset', units: SCAN_BASELINE },
    { label: 'Root action', units: ROOT_ACTION_UNITS[ast.action] },
  ];

  parts.push({ label: 'Filter conditions', units: estimatePredicateUnits(ast.filter) });

  for (const step of ast.pipeline) {
    parts.push({ label: PIPELINE_LABELS[step.type], units: estimatePipelineStepUnits(step) });
  }

  const rounded = parts.map((part) => ({ ...part, units: roundUnits(part.units) }));
  const total = rounded.reduce((sum, part) => sum + part.units, 0);
  return {
    units: roundUnits(total),
    parts: rounded,
  };
}
