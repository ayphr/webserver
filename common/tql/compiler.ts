import type { ASTNode, QueryAST, TelemetryPoint } from '.';

export type PredicateFn<T> = (point: T) => boolean;
export type QueryExecutor<T> = (dataset: T[]) => T[];

export class Compiler {
  public static compilePredicate<T extends TelemetryPoint>(ast: ASTNode): PredicateFn<T> {
    switch (ast.type) {
      case 'standard': {
        const { field, op, value } = ast;
        return (point: T) => {
          const val = point[field];
          if (val === undefined) return false;
          switch (op) {
            case '<': return val < value;
            case '<=': return val <= value;
            case '>': return val > value;
            case '>=': return val >= value;
            case '==': return val === value;
            case '!=': return val !== value;
          }
        };
      }
      case 'tolerance': {
        const { field, delta, isPercent, center } = ast;
        const absDelta = isPercent ? Math.abs(center * (delta / 100)) : delta;
        const min = center - absDelta;
        const max = center + absDelta;

        return (point: T) => {
          const val = point[field];
          if (typeof val !== 'number') return false;
          return val >= min && val <= max;
        };
      }
      case 'logical': {
        const leftFn = Compiler.compilePredicate<T>(ast.left);
        const rightFn = Compiler.compilePredicate<T>(ast.right);
        return ast.op === '&'
          ? (point: T) => leftFn(point) && rightFn(point)
          : (point: T) => leftFn(point) || rightFn(point);
      }
    }
  }

  /**
   * Compiles an AST into an optimized pipeline execution closure.
   */
  public static compilePipeline<T extends TelemetryPoint>(ast: QueryAST): QueryExecutor<T> {
    const filterFn = Compiler.compilePredicate<T>(ast.filter);

    return (dataset: T[]): T[] => {
      // 1. Filter dataset
      let results = dataset.filter(filterFn);

      // 2. Execute pipeline sequence
      for (const step of ast.pipeline) {
        if (step.type === 'timeRange') {
          results = results.filter((pt) => {
            const t = typeof pt.timestamp === 'number'
              ? pt.timestamp
              : new Date(pt.timestamp).getTime();
            return t >= step.start && t <= step.end;
          });
        } else if (step.type === 'sortAscending' || step.type === 'sortDescending') {
          const field = step.field || 'timestamp';
          const isAsc = step.type === 'sortAscending';

          results.sort((a, b) => {
            const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
            const valB = b[field] instanceof Date ? b[field].getTime() : b[field];

            if (valA < valB) return isAsc ? -1 : 1;
            if (valA > valB) return isAsc ? 1 : -1;
            return 0;
          });
        } else if (step.type === 'limit') {
          results = results.slice(0, step.count);
        }
      }

      return results;
    };
  }
}
