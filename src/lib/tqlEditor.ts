import { StreamLanguage } from '@codemirror/language';
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';

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
  'aggregate',
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
  'first',
  'last',
]);

const DATA_FIELDS = new Set([
  'timestamp',
  'temperature',
  'humidity',
  'airPressure',
]);

const OPERATORS = new Set(['+', '-', '*', '/', '%', '<', '>', '=', '!', '&', '|']);

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

const keywordCompletions: Completion[] = [
  ...ROOT_KEYWORDS,
  ...CONDITION_KEYWORDS,
  ...PIPELINE_KEYWORDS,
].map((label) => ({
  label,
  type: ROOT_KEYWORDS.has(label) ? 'keyword' : 'function',
  detail: ROOT_KEYWORDS.has(label) ? 'query root' : undefined,
}));

const fieldCompletions: Completion[] = [
  { label: 'timestamp', type: 'property', detail: 'Date / time' },
  { label: 'temperature', type: 'property', detail: '°C' },
  { label: 'humidity', type: 'property', detail: '%' },
  { label: 'airPressure', type: 'property', detail: 'hPa' },
];

const comparisonCompletions: Completion[] = [
  { label: '>', type: 'operator', detail: 'greater than' },
  { label: '>=', type: 'operator', detail: 'greater than or equal' },
  { label: '<', type: 'operator', detail: 'less than' },
  { label: '<=', type: 'operator', detail: 'less than or equal' },
  { label: '==', type: 'operator', detail: 'equal to' },
  { label: '!=', type: 'operator', detail: 'not equal to' },
  { label: '=~', type: 'operator', detail: 'matches regex' },
  { label: '!~', type: 'operator', detail: 'does not match regex' },
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
