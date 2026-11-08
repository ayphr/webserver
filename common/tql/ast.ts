export interface TelemetryPoint {
  timestamp: number | string | Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type RootClauseType = 'findAll' | 'findFirst' | 'findLast' | 'count' | 'exists' | 'select';

export type BinaryOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type StringMatchOp = 'contains' | 'not contains' | 'startsWith' | 'endsWith' | '=~' | '!~';

export interface FieldRef {
  field: string;
}

export interface StandardConditionAST {
  type: 'standard';
  field: string;
  op: BinaryOp;
  value: number | string | boolean | FieldRef;
}

export interface ToleranceConditionAST {
  type: 'tolerance';
  field: string;
  delta: number;
  isPercent: boolean;
  center: number | FieldRef;
}

export interface InConditionAST {
  type: 'in';
  field: string;
  negated: boolean;
  values: Array<number | string | boolean>;
}

export interface BetweenConditionAST {
  type: 'between';
  field: string;
  min: number | string;
  max: number | string;
}

export interface NullCheckConditionAST {
  type: 'nullCheck';
  field: string;
  check: 'isNull' | 'isNotNull';
}

export interface PresenceConditionAST {
  type: 'presence';
  field: string;
  check: 'exists' | 'missing';
}

export interface StringPatternConditionAST {
  type: 'stringPattern';
  field: string;
  op: StringMatchOp;
  pattern: string;
}

export interface NotExprAST {
  type: 'not';
  expr: ASTNode;
}

export interface LogicalExprAST {
  type: 'logical';
  op: '&' | '|';
  left: ASTNode;
  right: ASTNode;
}

export type ASTNode =
  | StandardConditionAST
  | ToleranceConditionAST
  | InConditionAST
  | BetweenConditionAST
  | NullCheckConditionAST
  | PresenceConditionAST
  | StringPatternConditionAST
  | NotExprAST
  | LogicalExprAST;

export type AggregationFunction = 'avg' | 'min' | 'max' | 'sum' | 'count' | 'median' | 'stddev' | 'first' | 'last';

export type PipelineStepAST =
  | { type: 'sortAscending'; field?: string }
  | { type: 'sortDescending'; field?: string }
  | { type: 'limit'; count: number }
  | { type: 'offset'; count: number }
  | { type: 'slice'; start: number; end?: number }
  | { type: 'head'; count: number }
  | { type: 'tail'; count: number }
  | { type: 'timeRange'; start: number; end: number }
  | { type: 'select' | 'project'; fields: string[] }
  | { type: 'omit'; fields: string[] }
  | { type: 'rename'; from: string; to: string }
  | { type: 'distinct' | 'dedup'; field?: string }
  | { type: 'dropNulls'; fields: string[] }
  | { type: 'fill'; field: string; value: number | string | boolean }
  | { type: 'fillPrevious'; field: string }
  | { type: 'clamp'; field: string; min: number; max: number }
  | { type: 'movingAverage'; field: string; windowSize: number; targetField?: string }
  | { type: 'rate' | 'diff'; field: string; targetField?: string }
  | { type: 'window' | 'resample'; duration: string; aggregation: AggregationFunction; field: string }
  | { type: 'aggregate'; function: AggregationFunction; field?: string }
  | { type: 'summary'; fields?: string[] }
  | { type: 'filter'; varName: string; filter: ASTNode }
  | { type: 'compute'; field: string; expression: string }
  | { type: 'groupBy'; field: string };

export interface QueryAST {
  action: RootClauseType;
  varName: string;
  filter: ASTNode;
  pipeline: PipelineStepAST[];
}
