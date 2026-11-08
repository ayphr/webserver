import type {
  ASTNode,
  QueryAST,
  TelemetryPoint,
} from './ast';

export type PredicateFn<T> = (point: T) => boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryExecutor<T> = (dataset: T[]) => any;

/**
 * Resolves a property from an object, supporting nested dot-notation paths
 * like "sensor.temperature" or direct property names.
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (path in record) return record[path];

  const parts = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Sets a property on an object, supporting nested dot-notation paths.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (current[part] === undefined || current[part] === null || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }
}

/**
 * Parses time strings like "10s", "1m", "5m", "1h", "24h", "7d" into milliseconds.
 */
export function parseDurationMs(duration: string): number {
  const trimmed = duration.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)?$/);
  if (!match) {
    const asNum = Number(trimmed);
    if (!Number.isNaN(asNum)) return asNum;
    throw new Error(`Invalid duration format '${duration}'`);
  }
  const rawNum = match[1];
  if (!rawNum) return 0;
  const val = Number.parseFloat(rawNum);
  const unit = match[2] || 'ms';
  switch (unit) {
    case 'ms': return val;
    case 's': return val * 1_000;
    case 'm': return val * 60_000;
    case 'h': return val * 3_600_000;
    case 'd': return val * 86_400_000;
    case 'w': return val * 604_800_000;
    default: return val;
  }
}

/**
 * Simple recursive descent evaluator for math expressions in `compute(...)`.
 * Supports +, -, *, /, %, parentheses, numeric literals, and field identifiers.
 */
export function evaluateMath(expression: string, point: TelemetryPoint): number | null {
  const tokens = expression.match(/\(|\)|\+|-|\*|\/|%|[a-zA-Z_][a-zA-Z0-9_.]*|\d+(?:\.\d+)?/g) || [];
  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    const tok = tokens[pos];
    pos++;
    return tok ?? '';
  }

  function parseExpr(): number {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const rhs = parseTerm();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const rhs = parseFactor();
      if (op === '*') val = val * rhs;
      else if (op === '/') val = rhs !== 0 ? val / rhs : Number.NaN;
      else if (op === '%') val = val % rhs;
    }
    return val;
  }

  function parseFactor(): number {
    const token = peek();
    if (!token) return Number.NaN;

    if (token === '-') {
      consume();
      return -parseFactor();
    }
    if (token === '+') {
      consume();
      return parseFactor();
    }
    if (token === '(') {
      consume();
      const val = parseExpr();
      if (peek() === ')') consume();
      return val;
    }

    consume();
    // Number literal
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      return Number.parseFloat(token);
    }

    // Field reference
    const rawVal = getNestedValue(point, token);
    if (typeof rawVal === 'number' && !Number.isNaN(rawVal)) {
      return rawVal;
    }
    return Number.NaN;
  }

  try {
    const res = parseExpr();
    return Number.isFinite(res) ? res : null;
  } catch {
    return null;
  }
}

export class Compiler {
  public static compilePredicate<T extends TelemetryPoint>(ast: ASTNode): PredicateFn<T> {
    switch (ast.type) {
      case 'standard': {
        const { field, op, value } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          if (val === undefined) return false;

          const targetValue =
            typeof value === 'object' && value !== null && 'field' in value
              ? getNestedValue(point, value.field)
              : value;

          if (targetValue === undefined) return false;

          switch (op) {
            case '<': return (val as any) < (targetValue as any);
            case '<=': return (val as any) <= (targetValue as any);
            case '>': return (val as any) > (targetValue as any);
            case '>=': return (val as any) >= (targetValue as any);
            case '==': return (val as any) === (targetValue as any);
            case '!=': return (val as any) !== (targetValue as any);
          }
        };
      }

      case 'tolerance': {
        const { field, delta, isPercent, center } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          if (typeof val !== 'number') return false;

          const centerVal =
            typeof center === 'object' && center !== null && 'field' in center
              ? getNestedValue(point, center.field)
              : center;

          if (typeof centerVal !== 'number') return false;

          const absDelta = isPercent ? Math.abs(centerVal * (delta / 100)) : delta;
          const min = centerVal - absDelta;
          const max = centerVal + absDelta;

          return val >= min && val <= max;
        };
      }

      case 'in': {
        const { field, negated, values } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          const has = values.includes(val as any);
          return negated ? !has : has;
        };
      }

      case 'between': {
        const { field, min, max } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          if (val === undefined || val === null) return false;
          return (val as any) >= (min as any) && (val as any) <= (max as any);
        };
      }

      case 'nullCheck': {
        const { field, check } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          const isNull = val === null || val === undefined;
          return check === 'isNull' ? isNull : !isNull;
        };
      }

      case 'presence': {
        const { field, check } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          const exists = val !== undefined;
          return check === 'exists' ? exists : !exists;
        };
      }

      case 'stringPattern': {
        const { field, op, pattern } = ast;
        let regex: RegExp | null = null;
        if (op === '=~' || op === '!~') {
          try {
            regex = new RegExp(pattern);
          } catch {
            regex = null;
          }
        }

        return (point: T) => {
          const raw = getNestedValue(point, field);
          if (raw === undefined || raw === null) return false;
          const str = String(raw);

          switch (op) {
            case 'contains': return str.includes(pattern);
            case 'not contains': return !str.includes(pattern);
            case 'startsWith': return str.startsWith(pattern);
            case 'endsWith': return str.endsWith(pattern);
            case '=~': return regex ? regex.test(str) : false;
            case '!~': return regex ? !regex.test(str) : false;
          }
        };
      }

      case 'not': {
        const innerFn = Compiler.compilePredicate<T>(ast.expr);
        return (point: T) => !innerFn(point);
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

    return (dataset: T[]): any => {
      // 1. Initial filter phase
      let results: any = dataset.filter(filterFn);

      // 2. Sequential pipeline operations
      for (const step of ast.pipeline) {
        if (!Array.isArray(results)) {
          break; // Terminal operation already executed
        }

        switch (step.type) {
          case 'timeRange': {
            results = results.filter((pt) => {
              const t = typeof pt.timestamp === 'number'
                ? pt.timestamp
                : new Date(pt.timestamp).getTime();
              return t >= step.start && t <= step.end;
            });
            break;
          }

          case 'sortAscending':
          case 'sortDescending': {
            const field = step.field || 'timestamp';
            const isAsc = step.type === 'sortAscending';

            results.sort((a, b) => {
              const rawA = getNestedValue(a, field);
              const rawB = getNestedValue(b, field);
              const valA = rawA instanceof Date ? rawA.getTime() : rawA;
              const valB = rawB instanceof Date ? rawB.getTime() : rawB;

              if (valA === undefined || valA === null) return isAsc ? 1 : -1;
              if (valB === undefined || valB === null) return isAsc ? -1 : 1;

              if ((valA as any) < (valB as any)) return isAsc ? -1 : 1;
              if ((valA as any) > (valB as any)) return isAsc ? 1 : -1;
              return 0;
            });
            break;
          }

          case 'limit': {
            results = results.slice(0, step.count);
            break;
          }

          case 'offset': {
            results = results.slice(step.count);
            break;
          }

          case 'head': {
            results = results.slice(0, step.count);
            break;
          }

          case 'tail': {
            results = results.slice(Math.max(0, results.length - step.count));
            break;
          }

          case 'slice': {
            results = step.end !== undefined
              ? results.slice(step.start, step.end)
              : results.slice(step.start);
            break;
          }

          case 'select':
          case 'project': {
            const keep = new Set(['timestamp', ...step.fields]);
            results = results.map((pt) => {
              const projected: Record<string, unknown> = {};
              for (const key of keep) {
                const val = getNestedValue(pt, key);
                if (val !== undefined) setNestedValue(projected, key, val);
              }
              return projected as T;
            });
            break;
          }

          case 'omit': {
            const remove = new Set(step.fields);
            results = results.map((pt) => {
              const clone = { ...pt };
              for (const key of remove) {
                delete clone[key];
              }
              return clone;
            });
            break;
          }

          case 'rename': {
            results = results.map((pt) => {
              const clone = { ...pt };
              const val = getNestedValue(clone, step.from);
              if (val !== undefined) {
                delete clone[step.from];
                setNestedValue(clone, step.to, val);
              }
              return clone;
            });
            break;
          }

          case 'distinct':
          case 'dedup': {
            const seen = new Set<string>();
            results = results.filter((pt) => {
              const key = step.field ? String(getNestedValue(pt, step.field)) : JSON.stringify(pt);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            break;
          }

          case 'dropNulls': {
            const fields = step.fields;
            results = results.filter((pt) => {
              for (const f of fields) {
                const v = getNestedValue(pt, f);
                if (v === null || v === undefined) return false;
              }
              return true;
            });
            break;
          }

          case 'fill': {
            results = results.map((pt) => {
              const clone = { ...pt };
              const v = getNestedValue(clone, step.field);
              if (v === null || v === undefined) {
                setNestedValue(clone, step.field, step.value);
              }
              return clone;
            });
            break;
          }

          case 'fillPrevious': {
            let lastVal: unknown = undefined;
            results = results.map((pt) => {
              const clone = { ...pt };
              const v = getNestedValue(clone, step.field);
              if (v !== null && v !== undefined) {
                lastVal = v;
              } else if (lastVal !== undefined) {
                setNestedValue(clone, step.field, lastVal);
              }
              return clone;
            });
            break;
          }

          case 'clamp': {
            results = results.map((pt) => {
              const clone = { ...pt };
              const v = getNestedValue(clone, step.field);
              if (typeof v === 'number') {
                const clamped = Math.max(step.min, Math.min(step.max, v));
                setNestedValue(clone, step.field, clamped);
              }
              return clone;
            });
            break;
          }

          case 'compute': {
            results = results.map((pt) => {
              const clone = { ...pt };
              const evaluated = evaluateMath(step.expression, clone);
              if (evaluated !== null) {
                setNestedValue(clone, step.field, evaluated);
              }
              return clone;
            });
            break;
          }

          case 'movingAverage': {
            const win = Math.max(1, step.windowSize);
            const target = step.targetField || step.field;
            results = results.map((pt, idx, arr) => {
              const clone = { ...pt };
              const startIdx = Math.max(0, idx - win + 1);
              let sum = 0;
              let count = 0;
              for (let i = startIdx; i <= idx; i++) {
                const currentPoint = arr[i];
                if (!currentPoint) continue;
                const v = getNestedValue(currentPoint, step.field);
                if (typeof v === 'number' && !Number.isNaN(v)) {
                  sum += v;
                  count++;
                }
              }
              const avg = count > 0 ? sum / count : null;
              setNestedValue(clone, target, avg);
              return clone;
            });
            break;
          }

          case 'rate':
          case 'diff': {
            const target = step.targetField || (step.type === 'rate' ? `${step.field}_rate` : `${step.field}_diff`);
            const isRate = step.type === 'rate';

            results = results.map((pt, idx, arr) => {
              const clone = { ...pt };
              if (idx === 0) {
                setNestedValue(clone, target, 0);
                return clone;
              }
              const prev = arr[idx - 1];
              if (!prev) {
                setNestedValue(clone, target, 0);
                return clone;
              }
              const curVal = getNestedValue(pt, step.field);
              const prevVal = getNestedValue(prev, step.field);

              if (typeof curVal === 'number' && typeof prevVal === 'number') {
                const deltaVal = curVal - prevVal;
                if (!isRate) {
                  setNestedValue(clone, target, deltaVal);
                } else {
                  const tCur = typeof pt.timestamp === 'number' ? pt.timestamp : new Date(pt.timestamp).getTime();
                  const tPrev = typeof prev.timestamp === 'number' ? prev.timestamp : new Date(prev.timestamp).getTime();
                  const dtSec = (tCur - tPrev) / 1000;
                  setNestedValue(clone, target, dtSec > 0 ? deltaVal / dtSec : 0);
                }
              } else {
                setNestedValue(clone, target, null);
              }
              return clone;
            });
            break;
          }

          case 'window':
          case 'resample': {
            const intervalMs = parseDurationMs(step.duration);
            if (intervalMs <= 0 || results.length === 0) break;

            // Sort chronologically first
            results.sort((a: any, b: any) => {
              const tA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
              const tB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
              return tA - tB;
            });

            const buckets = new Map<number, any[]>();
            for (const pt of results) {
              const t = typeof pt.timestamp === 'number' ? pt.timestamp : new Date(pt.timestamp).getTime();
              const bucketKey = Math.floor(t / intervalMs) * intervalMs;
              let list = buckets.get(bucketKey);
              if (!list) {
                list = [];
                buckets.set(bucketKey, list);
              }
              list.push(pt);
            }

            const resampled: any[] = [];
            for (const [bucketTime, items] of buckets.entries()) {
              const values = items
                .map((it) => getNestedValue(it, step.field))
                .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

              let aggValue: number | null = null;
              if (values.length > 0) {
                switch (step.aggregation) {
                  case 'avg': aggValue = values.reduce((s, v) => s + v, 0) / values.length; break;
                  case 'sum': aggValue = values.reduce((s, v) => s + v, 0); break;
                  case 'min': aggValue = Math.min(...values); break;
                  case 'max': aggValue = Math.max(...values); break;
                  case 'count': aggValue = values.length; break;
                  case 'first': aggValue = values[0] ?? null; break;
                  case 'last': aggValue = values[values.length - 1] ?? null; break;
                  default: aggValue = values[0] ?? null; break;
                }
              }

              resampled.push({
                timestamp: bucketTime,
                [step.field]: aggValue,
                count: items.length,
              });
            }

            results = resampled;
            break;
          }

          case 'aggregate': {
            const field = step.field;
            if (step.function === 'count' && !field) {
              results = results.length;
              break;
            }

            const values = field
              ? results
                  .map((it: any) => getNestedValue(it, field))
                  .filter((v: any): v is number => typeof v === 'number' && !Number.isNaN(v))
              : [];

            if (values.length === 0) {
              results = null;
              break;
            }

            switch (step.function) {
              case 'count': results = values.length; break;
              case 'sum': results = values.reduce((s: number, v: number) => s + v, 0); break;
              case 'avg': results = values.reduce((s: number, v: number) => s + v, 0) / values.length; break;
              case 'min': results = Math.min(...values); break;
              case 'max': results = Math.max(...values); break;
              case 'first': results = values[0] ?? null; break;
              case 'last': results = values[values.length - 1] ?? null; break;
              case 'median': {
                const sorted = [...values].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                const midVal = sorted[mid] ?? 0;
                const prevMidVal = sorted[mid - 1] ?? 0;
                results = sorted.length % 2 !== 0 ? midVal : (prevMidVal + midVal) / 2;
                break;
              }
              case 'stddev': {
                const avg = values.reduce((s: number, v: number) => s + v, 0) / values.length;
                const squareDiffs = values.map((v: number) => Math.pow(v - avg, 2));
                const avgSquareDiff = squareDiffs.reduce((s: number, v: number) => s + v, 0) / values.length;
                results = Math.sqrt(avgSquareDiff);
                break;
              }
            }
            break;
          }

          case 'summary': {
            const targetFields = step.fields;
            const firstResult = results[0];
            const fieldsToSummarize = targetFields || (results.length > 0 && firstResult
              ? Object.keys(firstResult).filter((k) => k !== 'timestamp')
              : []);

            const summaryStats: Record<string, { count: number; min: number; max: number; avg: number; sum: number; stddev: number }> = {};

            for (const f of fieldsToSummarize) {
              const vals = results
                .map((it: any) => getNestedValue(it, f))
                .filter((v: any): v is number => typeof v === 'number' && !Number.isNaN(v));

              if (vals.length > 0) {
                const count = vals.length;
                const sum = vals.reduce((s: number, v: number) => s + v, 0);
                const avg = sum / count;
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const stddev = Math.sqrt(vals.map((v: number) => Math.pow(v - avg, 2)).reduce((s: number, v: number) => s + v, 0) / count);
                summaryStats[f] = { count, min, max, avg, sum, stddev };
              }
            }

            results = {
              count: results.length,
              fields: summaryStats,
            };
            break;
          }

          case 'groupBy': {
            const groups: Record<string, any[]> = {};
            for (const pt of results) {
              const key = String(getNestedValue(pt, step.field) ?? 'unknown');
              if (!groups[key]) groups[key] = [];
              groups[key].push(pt);
            }
            results = groups;
            break;
          }

          case 'filter': {
            const subFilter = Compiler.compilePredicate<T>(step.filter);
            results = results.filter(subFilter);
            break;
          }
        }
      }

      // 3. Apply root query action (unless results is already a scalar / summary)
      if (Array.isArray(results)) {
        switch (ast.action) {
          case 'findAll':
          case 'select':
            return results;
          case 'findFirst':
            return results[0] ?? null;
          case 'findLast':
            return results[results.length - 1] ?? null;
          case 'count':
            return results.length;
          case 'exists':
            return results.length > 0;
        }
      }

      return results;
    };
  }
}
