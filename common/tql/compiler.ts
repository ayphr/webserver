import type {
  ASTNode,
  QueryAST,
  TelemetryPoint,
} from './ast';

export type PredicateFn<T> = (point: T) => boolean;

export type QueryResult<T extends TelemetryPoint = TelemetryPoint> =
  | T[]
  | Record<string, unknown>
  | number
  | boolean
  | null;

export type QueryExecutor<T extends TelemetryPoint> = (dataset: T[]) => QueryResult<T>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

/**
 * Compares two values the same way JS relational operators do. Returns `NaN`
 * when neither side is comparable, which makes `<`, `<=`, `>` and `>=` all
 * evaluate to false exactly like the language semantics.
 */
function compareValues(a: unknown, b: unknown): number {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;

  if (typeof left === 'number' && typeof right === 'number') {
    if (Number.isNaN(left) || Number.isNaN(right)) return Number.NaN;
    return left === right ? 0 : left < right ? -1 : 1;
  }

  if (typeof left === 'string' && typeof right === 'string') {
    return left === right ? 0 : left < right ? -1 : 1;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return left === right ? 0 : left ? 1 : -1;
  }

  const numericLeft = Number(left);
  const numericRight = Number(right);
  if (!Number.isNaN(numericLeft) && !Number.isNaN(numericRight)) {
    return numericLeft === numericRight ? 0 : numericLeft < numericRight ? -1 : 1;
  }

  const stringLeft = String(left);
  const stringRight = String(right);
  return stringLeft === stringRight ? 0 : stringLeft < stringRight ? -1 : 1;
}

/**
 * Resolves a property from an object, supporting nested dot-notation paths
 * like "sensor.temperature" or direct property names.
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (path in record) return record[path];

  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Sets a property on an object, supporting nested dot-notation paths.
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    const existing = current[part];
    if (existing === undefined || existing === null || typeof existing !== 'object') {
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    } else {
      current = existing as Record<string, unknown>;
    }
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
            case '<': return compareValues(val, targetValue) < 0;
            case '<=': return compareValues(val, targetValue) <= 0;
            case '>': return compareValues(val, targetValue) > 0;
            case '>=': return compareValues(val, targetValue) >= 0;
            case '==': return val === targetValue;
            case '!=': return val !== targetValue;
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
          const has = values.some((candidate) => candidate === val);
          return negated ? !has : has;
        };
      }

      case 'between': {
        const { field, min, max } = ast;
        return (point: T) => {
          const val = getNestedValue(point, field);
          if (val === undefined || val === null) return false;
          return compareValues(val, min) >= 0 && compareValues(val, max) <= 0;
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
    const filterFn = ast.filter
      ? Compiler.compilePredicate<T>(ast.filter)
      : () => true;

    return (dataset: T[]): QueryResult<T> => {
      // 1. Initial filter phase
      let rows: T[] = dataset.filter(filterFn);
      let terminal: { value: QueryResult<T> } | null = null;

      // 2. Sequential pipeline operations
      for (const step of ast.pipeline) {
        if (terminal) break; // Terminal operation already executed

        switch (step.type) {
          case 'timeRange': {
            rows = rows.filter((pt) => {
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

            rows.sort((a, b) => {
              const rawA = getNestedValue(a, field);
              const rawB = getNestedValue(b, field);
              const valA = rawA instanceof Date ? rawA.getTime() : rawA;
              const valB = rawB instanceof Date ? rawB.getTime() : rawB;

              if (valA === undefined || valA === null) return isAsc ? 1 : -1;
              if (valB === undefined || valB === null) return isAsc ? -1 : 1;

              const comparison = compareValues(valA, valB);
              return isAsc ? comparison : -comparison;
            });
            break;
          }

          case 'limit': {
            rows = rows.slice(0, step.count);
            break;
          }

          case 'offset': {
            rows = rows.slice(step.count);
            break;
          }

          case 'head': {
            rows = rows.slice(0, step.count);
            break;
          }

          case 'tail': {
            rows = rows.slice(Math.max(0, rows.length - step.count));
            break;
          }

          case 'slice': {
            rows = step.end !== undefined
              ? rows.slice(step.start, step.end)
              : rows.slice(step.start);
            break;
          }

          case 'select':
          case 'project': {
            const keep = new Set(['timestamp', ...step.fields]);
            rows = rows.map((pt) => {
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
            rows = rows.map((pt) => {
              const clone = { ...pt };
              for (const key of remove) {
                delete clone[key];
              }
              return clone;
            });
            break;
          }

          case 'rename': {
            rows = rows.map((pt) => {
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
            rows = rows.filter((pt) => {
              const key = step.field ? String(getNestedValue(pt, step.field)) : JSON.stringify(pt);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            break;
          }

          case 'dropNulls': {
            const fields = step.fields;
            rows = rows.filter((pt) => {
              for (const f of fields) {
                const v = getNestedValue(pt, f);
                if (v === null || v === undefined) return false;
              }
              return true;
            });
            break;
          }

          case 'fill': {
            rows = rows.map((pt) => {
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
            rows = rows.map((pt) => {
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
            rows = rows.map((pt) => {
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
            rows = rows.map((pt) => {
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
            rows = rows.map((pt, idx, arr) => {
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

            rows = rows.map((pt, idx, arr) => {
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
            if (intervalMs <= 0 || rows.length === 0) break;

            // Sort chronologically first
            rows.sort((a, b) => {
              const tA = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
              const tB = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
              return tA - tB;
            });

            const buckets = new Map<number, T[]>();
            for (const pt of rows) {
              const t = typeof pt.timestamp === 'number' ? pt.timestamp : new Date(pt.timestamp).getTime();
              const bucketKey = Math.floor(t / intervalMs) * intervalMs;
              let list = buckets.get(bucketKey);
              if (!list) {
                list = [];
                buckets.set(bucketKey, list);
              }
              list.push(pt);
            }

            const resampled: T[] = [];
            for (const [bucketTime, items] of buckets.entries()) {
              const values = items
                .map((it) => getNestedValue(it, step.field))
                .filter(isFiniteNumber);

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
              } as unknown as T);
            }

            rows = resampled;
            break;
          }

          case 'aggregate': {
            const field = step.field;
            if (step.function === 'count' && !field) {
              terminal = { value: rows.length };
              break;
            }

            const values = field
              ? rows
                  .map((it) => getNestedValue(it, field))
                  .filter(isFiniteNumber)
              : [];

            if (values.length === 0) {
              terminal = { value: null };
              break;
            }

            switch (step.function) {
              case 'count': terminal = { value: values.length }; break;
              case 'sum': terminal = { value: values.reduce((s, v) => s + v, 0) }; break;
              case 'avg': terminal = { value: values.reduce((s, v) => s + v, 0) / values.length }; break;
              case 'min': terminal = { value: Math.min(...values) }; break;
              case 'max': terminal = { value: Math.max(...values) }; break;
              case 'first': terminal = { value: values[0] ?? null }; break;
              case 'last': terminal = { value: values[values.length - 1] ?? null }; break;
              case 'median': {
                const sorted = [...values].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                const midVal = sorted[mid] ?? 0;
                const prevMidVal = sorted[mid - 1] ?? 0;
                terminal = { value: sorted.length % 2 !== 0 ? midVal : (prevMidVal + midVal) / 2 };
                break;
              }
              case 'stddev': {
                const avg = values.reduce((s, v) => s + v, 0) / values.length;
                const squareDiffs = values.map((v) => Math.pow(v - avg, 2));
                const avgSquareDiff = squareDiffs.reduce((s, v) => s + v, 0) / values.length;
                terminal = { value: Math.sqrt(avgSquareDiff) };
                break;
              }
            }
            break;
          }

          case 'summary': {
            const targetFields = step.fields;
            const firstResult = rows[0];
            const fieldsToSummarize = targetFields || (rows.length > 0 && firstResult
              ? Object.keys(firstResult).filter((k) => k !== 'timestamp')
              : []);

            const summaryStats: Record<string, { count: number; min: number; max: number; avg: number; sum: number; stddev: number }> = {};

            for (const f of fieldsToSummarize) {
              const vals = rows
                .map((it) => getNestedValue(it, f))
                .filter(isFiniteNumber);

              if (vals.length > 0) {
                const count = vals.length;
                const sum = vals.reduce((s, v) => s + v, 0);
                const avg = sum / count;
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const stddev = Math.sqrt(vals.map((v) => Math.pow(v - avg, 2)).reduce((s, v) => s + v, 0) / count);
                summaryStats[f] = { count, min, max, avg, sum, stddev };
              }
            }

            terminal = {
              value: {
                count: rows.length,
                fields: summaryStats,
              },
            };
            break;
          }

          case 'groupBy': {
            const groups: Record<string, T[]> = {};
            for (const pt of rows) {
              const key = String(getNestedValue(pt, step.field) ?? 'unknown');
              if (!groups[key]) groups[key] = [];
              groups[key].push(pt);
            }
            terminal = { value: groups };
            break;
          }

          case 'filter': {
            const subFilter = Compiler.compilePredicate<T>(step.filter);
            rows = rows.filter(subFilter);
            break;
          }
        }
      }

      // 3. Terminal operations return their scalar/summary result directly.
      if (terminal) return terminal.value;

      // 4. Apply root query action.
      switch (ast.action) {
        case 'findAll':
        case 'select':
          return rows;
        case 'findFirst':
          return rows[0] ?? null;
        case 'findLast':
          return rows[rows.length - 1] ?? null;
        case 'count':
          return rows.length;
        case 'exists':
          return rows.length > 0;
      }

      return rows;
    };
  }
}
