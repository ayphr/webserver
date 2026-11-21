export const QUERY_TYPES = ['standard', 'boost'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export type QueryContext = {
  /** Device serials whose telemetry the query reads. */
  serials: number[];
};

export type QueryRange = {
  /** ISO timestamps. These are arbitrary user-selected bounds, not dashboard periods. */
  from: string;
  to: string;
};

export type QueryDraft = {
  type: QueryType;
  query: string;
  context: QueryContext;
  range: QueryRange;
};

export const DEFAULT_TQL_QUERY = `findAll(p -> { p.temperature > 20 })
  then sortDescending(timestamp)
  then limit(100)`;

export const MAX_STANDARD_QUERY_POINTS = 50_000;
export const MAX_BOOST_QUERY_POINTS = 500_000;

export const MAX_QUERY_POINTS_BY_TYPE: Record<QueryType, number> = {
  standard: MAX_STANDARD_QUERY_POINTS,
  boost: MAX_BOOST_QUERY_POINTS,
};

export function createDefaultQueryRange(now = new Date()): QueryRange {
  return {
    from: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
}
