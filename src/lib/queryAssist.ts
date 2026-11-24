import { compileQuery, formatTql, validateQuery } from '@common';

export type PreparedAssistedQuery = {
  query: string;
  explanation: string;
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

/**
 * Client-side safety net for Iris query responses. The server validates before
 * responding, but editor-bound content is validated again here so malformed or
 * stale responses can never replace the user's query.
 */
export function prepareAssistedQuery(response: unknown): PreparedAssistedQuery {
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

  const explanation = typeof response.explanation === 'string'
    ? response.explanation.replace(/\s+/g, ' ').trim()
    : '';

  return {
    query,
    explanation: explanation || 'Iris wrote a query from your description.',
  };
}
