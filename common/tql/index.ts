export type {
  TelemetryPoint,
  RootClauseType,
  BinaryOp,
  StringMatchOp,
  FieldRef,
  StandardConditionAST,
  ToleranceConditionAST,
  InConditionAST,
  BetweenConditionAST,
  NullCheckConditionAST,
  PresenceConditionAST,
  StringPatternConditionAST,
  NotExprAST,
  LogicalExprAST,
  ASTNode,
  AggregationFunction,
  PipelineStepAST,
  QueryAST,
} from './ast';
export { compileQuery, parseQuery, evaluateQuery, validateQuery, estimateQueryComputeUnits } from './utils';
export {
  estimateComputeUnits,
  estimatePredicateUnits,
  estimatePipelineStepUnits,
  estimateExpressionUnits,
  type ComputeCostPart,
  type ComputeEstimate,
} from './cost';
export {
  Compiler,
  type PredicateFn,
  type QueryExecutor,
  type QueryResult,
  getNestedValue,
  setNestedValue,
  parseDurationMs,
  evaluateMath,
} from './compiler';
export { Lexer, type Token, type TokenType } from './lexer';
export { Parser } from './parser';
