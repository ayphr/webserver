import type {
  AssistantMode,
  AssistantThinkingStep,
  AssistantToolCall,
  AssistantVariant,
} from '@common';

export type AssistantMockStream = {
  content: string;
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
};

const step = (
  id: string,
  label: string,
  detail: string,
  durationMs: number,
): AssistantThinkingStep => ({ id, label, detail, status: 'pending', durationMs });

const tool = (
  id: string,
  name: string,
  label: string,
  durationMs: number,
): AssistantToolCall => ({ id, name, label, status: 'pending', durationMs });

type MockTemplate = Omit<AssistantMockStream, 'thinking' | 'tools'> & {
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
};

const CHAT_TEMPLATES: MockTemplate[] = [
  {
    content: [
      '## What the numbers are saying',
      '',
      '**Short version:** throughput is trending up, but the *tail latency* is getting noisier.',
      '',
      '- Requests per minute are up **18%** week over week.',
      '- The p95 is still under `250ms`, with a few spikes around `09:00`.',
      '- Cached responses account for roughly a third of traffic.',
      '',
      '> The pattern suggests a capacity issue at peak, not a regression in the query path.',
      '',
      '| Window | p50 | p95 |',
      '| --- | --- | --- |',
      '| Last 24h | 82ms | 214ms |',
      '| Previous 7d | 79ms | 181ms |',
      '',
      'See the [runbook](https://example.com/runbook) if you want the full checklist.',
    ].join('\n'),
    thinking: [
      step('frame', 'Frame the question', 'Identify the metric and comparison window', 180),
      step('scan', 'Scan the signal', 'Check trend, dispersion, and outliers', 240),
      step('shape', 'Shape the answer', 'Lead with the takeaway, then support it', 160),
    ],
    tools: [
      tool('context', 'context.search', 'Searched recent signals', 320),
      tool('format', 'response.format', 'Formatted the response', 140),
    ],
  },
  {
    content: [
      '### A compact plan',
      '',
      '1. **Capture** the current state with a before snapshot.',
      '2. **Change** one variable at a time.',
      '3. **Compare** the result against the baseline.',
      '',
      'A tiny helper makes this repeatable:',
      '',
      '```ts',
      'const diff = (before: number[], after: number[]) =>',
      '  after.map((value, index) => value - (before[index] ?? 0));',
      '```',
      '',
      'Use ~~guesswork~~ measured deltas, and keep the output in `reports/summary.md`.',
    ].join('\n'),
    thinking: [
      step('goal', 'Break down the goal', 'Turn the request into concrete steps', 150),
      step('sequence', 'Sequence the steps', 'Order work by dependency and risk', 210),
      step('verify', 'Verify the example', 'Check that the snippet compiles', 190),
    ],
    tools: [
      tool('docs', 'docs.lookup', 'Checked the docs', 260),
      tool('format', 'response.format', 'Formatted the response', 120),
    ],
  },
  {
    content: [
      'Here is the distinction I would keep in mind:',
      '',
      '- **Deterministic work** belongs in the pipeline.',
      '- _Exploratory work_ belongs in a notebook first.',
      '',
      '---',
      '',
      'If the shape is stable, promote it. If it is not, leave it exploratory a little longer.',
    ].join('\n'),
    thinking: [
      step('clarify', 'Clarify the distinction', 'Separate stable from exploratory work', 170),
      step('examples', 'Pick concrete examples', 'Choose examples that show the boundary', 200),
    ],
    tools: [
      tool('context', 'context.search', 'Searched recent signals', 230),
    ],
  },
];

const TASK_TEMPLATES: MockTemplate[] = [
  {
    content: [
      '## Implementation outline',
      '',
      '1. Add a typed event for each state transition.',
      '2. Keep the reducer pure and move side effects to the boundary.',
      '3. Add one regression test per failure mode.',
      '',
      '```ts',
      "type Event = { type: 'start' } | { type: 'done'; durationMs: number };",
      '```',
      '',
      '- [x] Define the event union',
      '- [ ] Wire the reducer',
      '- [ ] Add tests',
      '',
      'That gives us a clean seam for future variants.',
    ].join('\n'),
    thinking: [
      step('map', 'Map the work', 'Split the task into reviewable pieces', 190),
      step('boundaries', 'Choose boundaries', 'Keep effects outside the pure core', 230),
      step('failure', 'Check failure modes', 'List the cases worth a test', 180),
    ],
    tools: [
      tool('context', 'context.search', 'Reviewed the existing structure', 300),
      tool('format', 'response.format', 'Formatted the response', 130),
    ],
  },
  {
    content: [
      '## Debug checklist',
      '',
      '| Symptom | Likely cause | First check |',
      '| --- | --- | --- |',
      '| Slow cold start | Cold cache | Warm-up trace |',
      '| Intermittent 429 | Burst traffic | Rate-limit headers |',
      '| Stale result | Missed invalidation | Cache key |',
      '',
      'Start with the **cheapest** check. If the trace is flat, move to the cache key; otherwise inspect the burst window.',
      '',
      'Reference the [incident guide](https://example.com/incidents) for escalation.',
    ].join('\n'),
    thinking: [
      step('classify', 'Classify symptoms', 'Group reports by observable behaviour', 200),
      step('rank', 'Rank likely causes', 'Order by cost and likelihood', 220),
      step('tighten', 'Tighten the checklist', 'Keep only decisive checks', 160),
    ],
    tools: [
      tool('query', 'data.query', 'Queried recent data', 340),
      tool('format', 'response.format', 'Formatted the response', 150),
    ],
  },
];

const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
};

export const createAssistantMockStream = (
  mode: AssistantMode = 'chat',
  variant: AssistantVariant = 'standard',
): AssistantMockStream => {
  const template = pick(mode === 'task' ? TASK_TEMPLATES : CHAT_TEMPLATES);
  const includeThinking = variant !== 'nano' && (mode === 'task' || Math.random() < 0.75);
  const includeTools = Math.random() < (mode === 'task' ? 0.85 : 0.6);

  return {
    content: template.content,
    thinking: includeThinking ? template.thinking : [],
    tools: includeTools ? template.tools : [],
  };
};

export const generateAssistantResponse = (mode: AssistantMode = 'chat'): string =>
  createAssistantMockStream(mode).content;

// Attach each token's trailing whitespace so appending tokens reconstructs the
// original markdown exactly, including newlines between blocks.
export const splitAssistantResponseIntoTokens = (text: string): string[] =>
  text.match(/\S+\s*/g) ?? [];
