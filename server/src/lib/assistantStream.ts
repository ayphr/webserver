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

const pick = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
};

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

const shuffled = <T>(items: readonly T[]): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
};

const pickSome = <T>(items: readonly T[], count: number): T[] => shuffled(items).slice(0, count);

const SUBJECTS = [
  'the ingest pipeline',
  'the cache layer',
  'the mobile client',
  'the query path',
  'last night’s deploy',
  'the retry policy',
  'the onboarding flow',
  'the alerting rules',
  'the search index',
  'the billing worker',
  'the admin dashboard',
  'the webhook queue',
] as const;

const METRICS = [
  'p95 latency',
  'cache hit rate',
  'queue depth',
  'error rate',
  'throughput',
  'cold starts',
  'retry volume',
  'database connections',
  'time to first byte',
  'worker runtime',
] as const;

const WINDOWS = [
  'the last 24 hours',
  'the previous seven days',
  'the current sprint',
  'the last deploy',
  'this week',
  'the past hour',
] as const;

const OBSERVATIONS = [
  'a few sharp spikes around peak traffic',
  'one noisy tail that clears on its own',
  'a quiet but steady drift',
  'no obvious regression',
  'a clear breakpoint after the deploy',
  'a single outlier worth rechecking',
] as const;

const ACTIONS = [
  'tighten the retry window',
  'add a narrower cache key',
  'split the worker by priority',
  'instrument the slow path',
  'drop the redundant query',
  'cap the concurrency',
  'move the transform earlier',
  'warm the cache on deploy',
] as const;

const HEADINGS = [
  'What the numbers are saying',
  'A quick read',
  'Short version',
  'Recommendation',
  'What I would change',
  'A compact plan',
  'Implementation outline',
  'Debug checklist',
] as const;

const INSIGHTS = [
  'The pattern points to capacity at peak, not a regression in the query path.',
  'I would confirm the baseline before changing anything structural.',
  'This is a good candidate for one small change and a clean comparison.',
  'The cheapest check is the one most likely to settle the question.',
  'Keep the stable path boring and leave the exploratory path flexible.',
] as const;

const IDENTIFIERS = ['sample', 'snapshot', 'delta', 'window', 'signal', 'result'] as const;
const LANGUAGES = ['ts', 'json', 'bash'] as const;

const headingBlock = () => `## ${pick(HEADINGS)}`;

const summaryBlock = () =>
  `**Short version:** ${pick(SUBJECTS)} is ${pick(['up', 'down', 'holding steady', 'noisier'])} over ${pick(WINDOWS)}, with ${pick(OBSERVATIONS)}.`;

const bulletsBlock = () =>
  pickSome(METRICS, 3)
    .map(
      (metric) =>
        `- **${metric}** ${pick(['is up', 'held flat', 'improved', 'dipped'])} ${pick(['8%', '14%', '21%', '37%'])} over ${pick(WINDOWS)}.`,
    )
    .join('\n');

const stepsBlock = () =>
  [
    `1. **Capture** the current state of ${pick(SUBJECTS)}.`,
    `2. **Change** one thing: ${pick(ACTIONS)}.`,
    `3. **Compare** the result against ${pick(WINDOWS)}.`,
  ].join('\n');

const codeBlock = () => {
  const language = pick(LANGUAGES);
  const name = pick(IDENTIFIERS);
  const value = randomInt(40, 480);
  const body =
    language === 'ts'
      ? [
          `const ${name} = await measure('${pick(SUBJECTS)}');`,
          `const limit = ${value};`,
          `return ${name}.filter((item) => item.durationMs < limit);`,
        ].join('\n')
      : language === 'json'
        ? [
            '{',
            `  "subject": "${pick(SUBJECTS)}",`,
            `  "thresholdMs": ${value},`,
            '  "compare": true',
            '}',
          ].join('\n')
        : [
            `# check ${pick(SUBJECTS)}`,
            `measure --window "${pick(WINDOWS)}" --limit ${value}`,
          ].join('\n');
  return `\`\`\`${language}\n${body}\n\`\`\``;
};

const tableBlock = () =>
  [
    '| Signal | Now | Before |',
    '| --- | --- | --- |',
    `| ${pick(METRICS)} | ${randomInt(60, 320)}ms | ${randomInt(60, 320)}ms |`,
    `| ${pick(METRICS)} | ${randomInt(3, 48)}% | ${randomInt(3, 48)}% |`,
  ].join('\n');

const quoteBlock = () => `> ${pick(INSIGHTS)}`;

const checklistBlock = () =>
  [
    `- [x] Capture ${pick(SUBJECTS)}`,
    `- [ ] ${pick(ACTIONS)}`,
    `- [ ] Re-check ${pick(METRICS)}`,
  ].join('\n');

const closingBlock = () =>
  `${pick(['Next', 'For now', 'If you want to keep going', 'My suggestion'])}: ${pick(ACTIONS)}, then compare against ${pick(WINDOWS)}. See the [notes](https://example.com/notes) if you want the full write-up.`;

const BLOCKS = [
  summaryBlock,
  bulletsBlock,
  stepsBlock,
  codeBlock,
  tableBlock,
  quoteBlock,
  checklistBlock,
  closingBlock,
] as const;

const THINKING_POOL = [
  { label: 'Frame the question', detail: 'Identify the subject and comparison window' },
  { label: 'Scan the signal', detail: 'Check trend, dispersion and outliers' },
  { label: 'Check the edges', detail: 'Look for a single misleading data point' },
  { label: 'Rank the options', detail: 'Order changes by cost and likelihood' },
  { label: 'Shape the answer', detail: 'Lead with the takeaway, then support it' },
  { label: 'Map the work', detail: 'Split the task into reviewable pieces' },
  { label: 'Choose boundaries', detail: 'Keep effects outside the pure core' },
  { label: 'Verify the example', detail: 'Check that the snippet makes sense' },
] as const;

const TOOL_POOL = [
  { name: 'context.search', label: 'Searched recent signals' },
  { name: 'data.query', label: 'Queried the metric store' },
  { name: 'docs.lookup', label: 'Checked the docs' },
  { name: 'response.format', label: 'Formatted the response' },
] as const;

const createContent = (mode: AssistantMode): string => {
  const blocks = pickSome(BLOCKS, randomInt(3, 5));
  const parts = mode === 'task' || Math.random() < 0.6 ? [headingBlock()] : [];
  parts.push(...blocks.map((block) => block()));
  return parts.filter(Boolean).join('\n\n');
};

const createThinking = (count: number): AssistantThinkingStep[] =>
  pickSome(THINKING_POOL, count).map((item, index) =>
    step(`thinking-${index}`, item.label, item.detail, randomInt(120, 340)),
  );

const createTools = (count: number): AssistantToolCall[] =>
  pickSome(TOOL_POOL, count).map((item, index) =>
    tool(`tool-${index}`, item.name, item.label, randomInt(120, 380)),
  );

export const createAssistantMockStream = (
  mode: AssistantMode = 'chat',
  variant: AssistantVariant = 'standard',
): AssistantMockStream => {
  const includeThinking = variant !== 'nano' && (mode === 'task' || Math.random() < 0.75);
  const includeTools = Math.random() < (mode === 'task' ? 0.85 : 0.6);

  return {
    content: createContent(mode),
    thinking: includeThinking ? createThinking(randomInt(2, 4)) : [],
    tools: includeTools ? createTools(randomInt(1, 3)) : [],
  };
};

export const generateAssistantResponse = (mode: AssistantMode = 'chat'): string =>
  createAssistantMockStream(mode).content;

// Attach each token's trailing whitespace so appending tokens reconstructs the
// original markdown exactly, including newlines between blocks.
export const splitAssistantResponseIntoTokens = (text: string): string[] =>
  text.match(/\S+\s*/g) ?? [];
