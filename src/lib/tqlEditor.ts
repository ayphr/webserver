import { StreamLanguage } from '@codemirror/language';
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { hoverTooltip } from '@codemirror/view';
import { validateQuery } from '@common/tql';

type TqlEditorState = {
  blockComment: boolean;
  braceDepth: number;
};

const ROOT_KEYWORDS = new Set([
  'findAll',
  'findFirst',
  'findLast',
  'count',
  'exists',
  'select',
]);

const CONDITION_KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'between',
  'is',
  'null',
  'missing',
  'present',
  'contains',
  'startsWith',
  'endsWith',
  'true',
  'false',
]);

const PIPELINE_KEYWORDS = new Set([
  'then',
  'sortAscending',
  'sortDescending',
  'limit',
  'offset',
  'skip',
  'slice',
  'head',
  'tail',
  'timeRange',
  'select',
  'project',
  'omit',
  'rename',
  'distinct',
  'dedup',
  'dropNulls',
  'fill',
  'fillPrevious',
  'clamp',
  'movingAverage',
  'rate',
  'diff',
  'window',
  'resample',
  'summary',
  'filter',
  'compute',
  'groupBy',
  'avg',
  'min',
  'max',
  'sum',
  'median',
  'stddev',
  'count',
]);

const DATA_FIELDS = new Set([
  'timestamp',
  'temperature',
  'humidity',
  'airPressure',
]);

const OPERATORS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|']);

export interface TqlDoc {
  signature: string;
  description: string;
  example?: string;
}

/**
 * Hover/completion documentation for TQL constructs. Keep this in sync with
 * the parser and compiler in `common/tql`.
 */
export const TQL_DOCS: Record<string, TqlDoc> = {
  // Query roots
  findAll: {
    signature: 'findAll(p -> { condition })',
    description: 'Returns every telemetry point that matches the condition.',
    example: 'findAll(p -> { temperature > 20 })',
  },
  findFirst: {
    signature: 'findFirst(p -> { condition })',
    description: 'Returns the first telemetry point that matches the condition, or null.',
  },
  findLast: {
    signature: 'findLast(p -> { condition })',
    description: 'Returns the last telemetry point that matches the condition, or null.',
  },
  count: {
    signature: 'count(p -> { condition })  ·  then count(field?)',
    description:
      'As a query root, counts matching points. As a pipeline step, counts values in a field (or rows when no field is given).',
  },
  exists: {
    signature: 'exists(p -> { condition })',
    description: 'Returns true when at least one telemetry point matches the condition.',
  },
  select: {
    signature: 'select(p -> { condition })  ·  then select(field, ...)',
    description:
      'As a query root, returns matching points (alias of findAll). As a pipeline step, projects only the listed fields.',
  },

  // Pipeline structure
  then: {
    signature: 'then <operation>(...)',
    description: 'Chains another operation onto the query. Operations run in the order they are written.',
    example: 'findAll(p -> { temperature > 20 }) then limit(100)',
  },
  sortAscending: {
    signature: 'sortAscending(field?)',
    description: 'Sorts points in ascending order by the given field. Defaults to timestamp.',
  },
  sortDescending: {
    signature: 'sortDescending(field?)',
    description: 'Sorts points in descending order by the given field. Defaults to timestamp.',
  },
  limit: {
    signature: 'limit(count)',
    description: 'Keeps only the first count points. Use sortDescending first for the newest points.',
  },
  offset: {
    signature: 'offset(count)',
    description: 'Skips the first count points.',
  },
  skip: {
    signature: 'skip(count)',
    description: 'Alias for offset(count).',
  },
  slice: {
    signature: 'slice(start, end?)',
    description: 'Returns the points between start (inclusive) and end (exclusive).',
  },
  head: {
    signature: 'head(count)',
    description: 'Keeps the first count points. Alias for limit(count).',
  },
  tail: {
    signature: 'tail(count)',
    description: 'Keeps the last count points.',
  },
  timeRange: {
    signature: 'timeRange(start, end)',
    description:
      'Keeps points inside an inclusive time range. Accepts epoch milliseconds or quoted date strings.',
    example: "timeRange('2024-01-01', '2024-02-01')",
  },
  project: {
    signature: 'project(field, ...)',
    description: 'Alias for select(field, ...). Keeps only the listed fields.',
  },
  omit: {
    signature: 'omit(field, ...)',
    description: 'Removes the listed fields and keeps everything else.',
  },
  rename: {
    signature: 'rename(from, to)',
    description: 'Renames a field.',
  },
  distinct: {
    signature: 'distinct(field?)',
    description:
      'Keeps one point per unique value of the field. With no field, de-duplicates whole points.',
  },
  dedup: {
    signature: 'dedup(field?)',
    description: 'Alias for distinct(field?).',
  },
  dropNulls: {
    signature: 'dropNulls(field, ...)',
    description: 'Drops points where any of the listed fields is null or missing.',
  },
  fill: {
    signature: 'fill(field, value)',
    description: 'Replaces null or missing values in a field with a constant.',
  },
  fillPrevious: {
    signature: 'fillPrevious(field)',
    description: 'Replaces missing values with the previous non-null value.',
  },
  clamp: {
    signature: 'clamp(field, min, max)',
    description: 'Clamps a numeric field so it stays between min and max.',
  },
  movingAverage: {
    signature: 'movingAverage(field, windowSize, targetField?)',
    description: 'Adds a rolling average over the given window size.',
  },
  rate: {
    signature: 'rate(field, targetField?)',
    description: 'Calculates the per-second rate of change of a numeric field.',
  },
  diff: {
    signature: 'diff(field, targetField?)',
    description: 'Calculates the difference from the previous point.',
  },
  window: {
    signature: "window('duration', aggregation, field)",
    description:
      "Groups points into time buckets and aggregates each bucket. Duration must be a quoted string, e.g. '1h'.",
    example: "then window('1h', 'avg', temperature)",
  },
  resample: {
    signature: "resample('duration', aggregation, field)",
    description:
      'Alias for window. Groups points into time buckets and aggregates each bucket. Duration must be a quoted string.',
    example: "then resample('15m', 'max', humidity)",
  },
  summary: {
    signature: 'summary(field, ...)',
    description:
      'Computes count, min, max, avg, sum and stddev for the listed fields. With no fields, summarizes every numeric field.',
  },
  avg: {
    signature: 'avg(field)',
    description: 'Aggregates the field and returns its mean.',
  },
  min: {
    signature: 'min(field)',
    description: 'Aggregates the field and returns its minimum value.',
  },
  max: {
    signature: 'max(field)',
    description: 'Aggregates the field and returns its maximum value.',
  },
  sum: {
    signature: 'sum(field)',
    description: 'Aggregates the field and returns its total.',
  },
  median: {
    signature: 'median(field)',
    description: 'Aggregates the field and returns its median value.',
  },
  stddev: {
    signature: 'stddev(field)',
    description: 'Aggregates the field and returns its standard deviation.',
  },
  first: {
    signature: "resample('duration', 'first', field)",
    description: 'Window aggregation that keeps the first value in each bucket.',
  },
  last: {
    signature: "resample('duration', 'last', field)",
    description: 'Window aggregation that keeps the last value in each bucket.',
  },
  groupBy: {
    signature: 'groupBy(field)',
    description: 'Groups points into an object keyed by the field value.',
  },
  compute: {
    signature: 'compute(field, expression)',
    description:
      'Creates or overwrites a numeric field using a math expression. Supports +, -, *, /, %, parentheses and field names.',
    example: 'then compute(tempF, (temperature * 1.8) + 32)',
  },
  filter: {
    signature: 'filter(p -> { condition })',
    description: 'Applies another condition later in the pipeline.',
  },

  // Condition keywords
  and: {
    signature: 'condition and condition',
    description: 'Logical AND. Both conditions must match. Can also be written as & or &&.',
  },
  or: {
    signature: 'condition or condition',
    description: 'Logical OR. At least one condition must match. Can also be written as | or ||.',
  },
  not: {
    signature: 'not condition',
    description: 'Negates a condition. Can also be written as !.',
  },
  in: {
    signature: 'field in [value, value, ...]',
    description: 'Matches when the field equals any value in the set. Use "not in" to invert it.',
  },
  between: {
    signature: 'field between min and max',
    description: 'Matches when the field is between min and max, inclusive.',
  },
  is: {
    signature: 'field is null | present | missing',
    description:
      'Checks a field state. "is null" checks for null, "is present"/"is missing" check existence.',
  },
  null: {
    signature: 'field is null  ·  field is not null',
    description: 'Checks whether a field is null.',
  },
  missing: {
    signature: 'field is missing  ·  field missing',
    description: 'Checks whether a field is absent.',
  },
  present: {
    signature: 'field is present  ·  field exists',
    description: 'Checks whether a field is present.',
  },
  contains: {
    signature: 'field contains "text"',
    description: 'Matches when a string field contains the given text. Use "not contains" to invert it.',
  },
  startsWith: {
    signature: 'field startsWith "text"',
    description: 'Matches when a string field starts with the given text.',
  },
  endsWith: {
    signature: 'field endsWith "text"',
    description: 'Matches when a string field ends with the given text.',
  },
  true: {
    signature: 'true',
    description: 'Boolean literal.',
  },
  false: {
    signature: 'false',
    description: 'Boolean literal.',
  },

  // Fields
  timestamp: {
    signature: 'timestamp',
    description: 'The point time in Unix epoch milliseconds.',
  },
  temperature: {
    signature: 'temperature',
    description: 'Temperature reading in degrees Celsius.',
  },
  humidity: {
    signature: 'humidity',
    description: 'Relative humidity reading in percent.',
  },
  airPressure: {
    signature: 'airPressure',
    description: 'Air pressure reading in hectopascals (hPa).',
  },

  // Operators
  '->': {
    signature: 'p -> { condition }',
    description: 'Separates the lambda variable from the condition block.',
  },
  '>': { signature: 'field > value', description: 'Greater than.' },
  '>=': { signature: 'field >= value', description: 'Greater than or equal to.' },
  '<': { signature: 'field < value', description: 'Less than.' },
  '<=': { signature: 'field <= value', description: 'Less than or equal to.' },
  '==': { signature: 'field == value', description: 'Equal to.' },
  '!=': { signature: 'field != value', description: 'Not equal to.' },
  '=~': { signature: 'field =~ "pattern"', description: 'Matches a regular expression.' },
  '!~': { signature: 'field !~ "pattern"', description: 'Does not match a regular expression.' },
  '~...~=': {
    signature: 'field ~delta~= value  ·  field ~delta%~= value',
    description:
      'Tolerance match. Absolute delta by default, or a percentage when the delta ends with %.',
    example: 'temperature ~2~= 21  ·  temperature ~10%~= 21',
  },
  '&': { signature: 'condition & condition', description: 'Logical AND (alias for "and").' },
  '|': { signature: 'condition | condition', description: 'Logical OR (alias for "or").' },
};

const OPERATOR_HOVER_TOKENS = ['->', '=~', '!~', '==', '!=', '<=', '>=', '>', '<', '=', '&', '|'];

export const tqlLanguage = StreamLanguage.define<TqlEditorState>({
  name: 'tql',
  startState: () => ({ blockComment: false, braceDepth: 0 }),
  copyState: (state) => ({ ...state }),

  token(stream, state) {
    if (state.blockComment) {
      if (stream.match('*/')) {
        state.blockComment = false;
      } else {
        stream.next();
      }
      return 'comment';
    }

    if (stream.eatSpace()) return null;

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match('/*')) {
      state.blockComment = true;
      return 'comment';
    }

    const char = stream.peek();
    if (char === '"' || char === "'") {
      const quote = char;
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const current = stream.next();
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === quote) break;
      }
      return 'string';
    }

    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';

    if (stream.match(/^~\d+(?:\.\d+)?%?~=/)) return 'operator';
    if (stream.match('->') || stream.match('=~') || stream.match('!~')) return 'operator';
    if (
      stream.match('==')
      || stream.match('!=')
      || stream.match('<=')
      || stream.match('>=')
    ) {
      return 'operator';
    }

    if (char && '{}[](),.'.includes(char)) {
      stream.next();
      if (char === '{') state.braceDepth += 1;
      if (char === '}') state.braceDepth = Math.max(0, state.braceDepth - 1);
      return 'punctuation';
    }

    if (char && OPERATORS.has(char)) {
      stream.next();
      return 'operator';
    }

    const word = stream.match(/^[A-Za-z_][\w.]*/);
    if (word) {
      const value = Array.isArray(word) ? word[0] ?? '' : stream.current();

      if (value === 'true' || value === 'false') return 'bool';
      if (value === 'null') return 'null';
      if (ROOT_KEYWORDS.has(value)) return 'keyword';
      if (CONDITION_KEYWORDS.has(value)) return 'keyword';
      if (PIPELINE_KEYWORDS.has(value)) return 'keyword';
      if (DATA_FIELDS.has(value) || value.includes('.') || state.braceDepth > 0) {
        return 'propertyName';
      }
      return 'variableName';
    }

    stream.next();
    return null;
  },
});

function keywordDetail(label: string): string | undefined {
  if (ROOT_KEYWORDS.has(label)) return 'query root';
  if (PIPELINE_KEYWORDS.has(label) && label !== 'then') return 'pipeline operation';
  return undefined;
}

function keywordCompletion(label: string): Completion {
  const doc = TQL_DOCS[label];
  return {
    label,
    type: ROOT_KEYWORDS.has(label) ? 'keyword' : 'function',
    detail: keywordDetail(label),
    info: doc?.description,
  };
}

const keywordCompletions: Completion[] = [
  ...new Set([
    ...ROOT_KEYWORDS,
    ...CONDITION_KEYWORDS,
    ...PIPELINE_KEYWORDS,
  ]),
].map(keywordCompletion);

const fieldCompletions: Completion[] = [
  { label: 'timestamp', type: 'property', detail: 'Date / time', info: TQL_DOCS.timestamp?.description },
  { label: 'temperature', type: 'property', detail: '°C', info: TQL_DOCS.temperature?.description },
  { label: 'humidity', type: 'property', detail: '%', info: TQL_DOCS.humidity?.description },
  { label: 'airPressure', type: 'property', detail: 'hPa', info: TQL_DOCS.airPressure?.description },
];

const comparisonCompletions: Completion[] = [
  { label: '>', type: 'operator', detail: 'greater than', info: TQL_DOCS['>']?.description },
  { label: '>=', type: 'operator', detail: 'greater than or equal', info: TQL_DOCS['>=']?.description },
  { label: '<', type: 'operator', detail: 'less than', info: TQL_DOCS['<']?.description },
  { label: '<=', type: 'operator', detail: 'less than or equal', info: TQL_DOCS['<=']?.description },
  { label: '==', type: 'operator', detail: 'equal to', info: TQL_DOCS['==']?.description },
  { label: '!=', type: 'operator', detail: 'not equal to', info: TQL_DOCS['!=']?.description },
  { label: '=~', type: 'operator', detail: 'matches regex', info: TQL_DOCS['=~']?.description },
  { label: '!~', type: 'operator', detail: 'does not match regex', info: TQL_DOCS['!~']?.description },
];

export function tqlCompletionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][\w.]*/);
  if (!word && !context.explicit) return null;

  const beforeCursor = context.state.sliceDoc(0, context.pos);
  const inCondition = /\{[^{}]*$/.test(beforeCursor);
  const afterThen = /\bthen\s+[A-Za-z_]*$/.test(beforeCursor);

  let options: Completion[];

  if (inCondition) {
    options = [
      ...fieldCompletions.map((completion) => ({ ...completion, boost: 20 })),
      ...keywordCompletions.map((completion) => ({ ...completion, boost: 5 })),
      ...comparisonCompletions,
    ];
  } else if (afterThen) {
    options = keywordCompletions.map((completion) => ({
      ...completion,
      boost: PIPELINE_KEYWORDS.has(completion.label) ? 20 : 0,
    }));
  } else {
    options = keywordCompletions.map((completion) => ({
      ...completion,
      boost: ROOT_KEYWORDS.has(completion.label) ? 10 : 0,
    }));
  }

  return {
    from: word?.from ?? context.pos,
    options,
    validFor: /^[A-Za-z_][\w.]*$/,
  };
}

export const tqlAutocompletion = autocompletion({
  override: [tqlCompletionSource],
  activateOnTyping: true,
  closeOnBlur: false,
});

function errorPosition(message: string): number | null {
  const match = /at (?:position|pos) (\d+)/.exec(message);
  if (!match?.[1]) return null;
  const position = Number.parseInt(match[1], 10);
  return Number.isNaN(position) ? null : position;
}

export const tqlLinter = linter((view): Diagnostic[] => {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return [];

  const result = validateQuery(doc);
  if (result.valid || !result.error) return [];

  const rawPosition = errorPosition(result.error);
  let from = rawPosition === null ? 0 : Math.min(rawPosition, doc.length);
  const line = view.state.doc.lineAt(from);
  const rest = line.text.slice(from - line.from);
  const token = /^[\w.]+/.exec(rest);
  let to = token ? from + token[0].length : Math.min(from + 1, line.to);

  if (to <= from) {
    if (from > 0) {
      from -= 1;
      to = from + 1;
    } else if (doc.length > 0) {
      to = 1;
    }
  }

  return [
    {
      from,
      to,
      severity: 'error',
      source: 'TQL',
      message: result.error,
    },
  ];
});

function findOperator(text: string, offset: number): string | null {
  const tolerance = /~\d+(?:\.\d+)?%?~=/g;
  let match: RegExpExecArray | null;
  while ((match = tolerance.exec(text))) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      return '~...~=';
    }
  }

  for (const operator of OPERATOR_HOVER_TOKENS) {
    let index = text.indexOf(operator);
    while (index !== -1) {
      if (offset >= index && offset <= index + operator.length) {
        return operator;
      }
      index = text.indexOf(operator, index + 1);
    }
  }

  return null;
}

function createDocElement(name: string, doc: TqlDoc): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'tql-hover';

  const title = document.createElement('div');
  title.className = 'tql-hover__title';
  title.textContent = name;
  dom.appendChild(title);

  const signature = document.createElement('code');
  signature.className = 'tql-hover__signature';
  signature.textContent = doc.signature;
  dom.appendChild(signature);

  const description = document.createElement('p');
  description.className = 'tql-hover__description';
  description.textContent = doc.description;
  dom.appendChild(description);

  if (doc.example) {
    const example = document.createElement('code');
    example.className = 'tql-hover__example';
    example.textContent = doc.example;
    dom.appendChild(example);
  }

  return dom;
}

export const tqlHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const offset = pos - line.from;
  const before = line.text.slice(0, offset);
  const after = line.text.slice(offset);

  const beforeMatch = /[A-Za-z_][\w.]*$/.exec(before);
  const afterMatch = /^[\w.]*/.exec(after);
  const wordStart = beforeMatch ? offset - beforeMatch[0].length : offset;
  const wordEnd = offset + (afterMatch?.[0].length ?? 0);
  const word = line.text.slice(wordStart, wordEnd);

  if (word && TQL_DOCS[word]) {
    const doc = TQL_DOCS[word];
    return {
      pos: line.from + wordStart,
      end: line.from + wordEnd,
      above: true,
      create: () => ({ dom: createDocElement(word, doc) }),
    };
  }

  const operator = findOperator(line.text, offset);
  if (operator) {
    const doc = TQL_DOCS[operator];
    if (doc) {
      return {
        pos: line.from,
        end: line.to,
        above: true,
        create: () => ({ dom: createDocElement(operator, doc) }),
      };
    }
  }

  return null;
});
