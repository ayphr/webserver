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
  then sortDescending(p -> { p.timestamp })
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

/** Maximum length of a plain-language query request sent to Iris. */
export const QUERY_ASSIST_PROMPT_MAX_LENGTH = 1000;

export type QueryAssistRequest = {
  /** The user's request in plain language. */
  prompt: string;
  /** Device serials already selected in the Queries tab. */
  serials: number[];
  /** ISO timestamps for the selected range. */
  from: string;
  to: string;
  /** Current query mode. Iris may choose a different mode in the response. */
  type: QueryType;
  /** Current editor contents, used as context for follow-up requests. */
  existingQuery?: string;
};

export type QueryAssistResponse = {
  /** Validated, formatted TQL ready for the editor. */
  query: string;
  /** One short sentence explaining what the query does. */
  explanation: string;
  /** ISO start time chosen by Iris to include readings from the selected devices. */
  from: string;
  /** ISO end time chosen by Iris to include readings from the selected devices. */
  to: string;
  /** Query mode chosen by Iris for the query run. */
  type: QueryType;
  /** Credits settled from the model's actual token usage. */
  creditCost: number;
};
