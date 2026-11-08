export interface TelemetryPoint {
  timestamp: number | string | Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type BinaryOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

export interface StandardConditionAST {
  type: 'standard';
  field: string;
  op: BinaryOp;
  value: number | string | boolean;
}

export interface ToleranceConditionAST {
  type: 'tolerance';
  field: string;
  delta: number;
  isPercent: boolean;
  center: number;
}

export interface LogicalExprAST {
  type: 'logical';
  op: '&' | '|';
  left: ASTNode;
  right: ASTNode;
}

export type ASTNode = StandardConditionAST | ToleranceConditionAST | LogicalExprAST;

export type PipelineStepAST =
  | { type: 'sortAscending'; field?: string }
  | { type: 'sortDescending'; field?: string }
  | { type: 'limit'; count: number }
  | { type: 'timeRange'; start: number; end: number };

export interface QueryAST {
  varName: string;
  filter: ASTNode;
  pipeline: PipelineStepAST[];
}
