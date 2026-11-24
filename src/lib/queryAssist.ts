import {
  QUERY_TYPES,
  compileQuery,
  formatTql,
  validateQuery,
  type QueryType,
} from '@common';

export type PreparedAssistedQuery = {
  query: string;
  explanation: string;
  from: string;
  to: string;
  type: QueryType;
  creditCost: number;
};

export type AssistedQueryFallback = {
  from?: string;
  to?: string;
  type?: QueryType;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compiles = (query: string): boolean => {
  try {
    compileQuery(query);
    return true;
  } catch {
    return false;
  }
};

const normalizedTimestamp = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value !== 'string' || value.length > 40) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
};

/**
 * Client-side safety net for Iris query responses. The server validates before
 * responding, but editor-bound content and run settings are checked again here
 * so malformed or stale responses can never replace the user's query.
 */
export function prepareAssistedQuery(
  response: unknown,
  fallback: AssistedQueryFallback = {},
): PreparedAssistedQuery {
  if (!isRecord(response) || typeof response.query !== 'string') {
    throw new Error('Iris did not return a query. Try again.');
  }

  const rawQuery = response.query.trim();
  if (!rawQuery) throw new Error('Iris did not return a query. Try again.');

  const rawValidation = validateQuery(rawQuery);
  if (!rawValidation.valid || !compiles(rawQuery)) {
    throw new Error('Iris returned an invalid query. Try describing it differently.');
  }

  let query = rawQuery;
  try {
    query = formatTql(rawQuery);
  } catch {
    // The original query already parsed; keep it if formatting cannot run.
  }

  const formattedValidation = validateQuery(query);
  if (!formattedValidation.valid || !compiles(query)) {
    throw new Error('Iris returned an invalid query. Try describing it differently.');
  }

  // Older API deployments omit these fields. Prefer Iris's choice when valid,
  // otherwise keep the range and mode already shown in the editor.
  const from = normalizedTimestamp(response.from) ?? normalizedTimestamp(fallback.from);
  const to = normalizedTimestamp(response.to) ?? normalizedTimestamp(fallback.to);
  if (!from || !to || Date.parse(from) > Date.parse(to)) {
    throw new Error('Iris returned an invalid time range. Try again.');
  }

  const responseType = typeof response.type === 'string' && QUERY_TYPES.includes(response.type as QueryType)
    ? response.type as QueryType
    : null;
  const type = responseType ?? (fallback.type && QUERY_TYPES.includes(fallback.type) ? fallback.type : null);
  if (!type) throw new Error('Iris returned an invalid query mode. Try again.');

  const creditCost = typeof response.creditCost === 'number' && Number.isFinite(response.creditCost)
    ? Math.max(0, response.creditCost)
    : 0;

  const explanation = typeof response.explanation === 'string'
    ? response.explanation.replace(/\s+/g, ' ').trim()
    : '';

  return {
    query,
    explanation: explanation || 'Iris wrote a query from your description.',
    from,
    to,
    type,
    creditCost,
  };
}
