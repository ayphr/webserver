import type { QueryAST, TelemetryPoint } from './ast';
import { Compiler, type QueryExecutor, type QueryResult } from './compiler';
import { Lexer } from './lexer';
import { Parser } from './parser';
import { estimateComputeUnits, type ComputeEstimate } from './cost';

export function parseQuery(queryString: string): QueryAST {
  const lexer = new Lexer(queryString);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

export function compileQuery<T extends TelemetryPoint = TelemetryPoint>(queryString: string): QueryExecutor<T> {
  const ast = parseQuery(queryString);
  return Compiler.compilePipeline<T>(ast);
}

export function evaluateQuery<T extends TelemetryPoint = TelemetryPoint>(
  queryString: string,
  dataset: T[],
): QueryResult<T> {
  const executor = compileQuery<T>(queryString);
  return executor(dataset);
}

export function validateQuery(queryString: string): { valid: boolean; error?: string } {
  try {
    parseQuery(queryString);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Estimates the compute units a query will use. Throws when the query cannot
 * be parsed; callers that need a soft failure should check `validateQuery`
 * first.
 */
export function estimateQueryComputeUnits(queryString: string, dataPointCount?: number): ComputeEstimate {
  return estimateComputeUnits(parseQuery(queryString), dataPointCount);
}
