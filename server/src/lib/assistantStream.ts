import {
  ASSISTANT_TOOL_DEFINITIONS,
  type AssistantMode,
  type AssistantUsageTokens,
  type AssistantThinkingStep,
  type AssistantToolCall,
  type AssistantToolInput,
  type AssistantToolName,
  type AssistantVariant,
} from '@common';

export type AssistantMockStream = {
  content: string;
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
  /** Actual token usage reported by a provider, when available. */
  usage?: AssistantUsageTokens;
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
  'the auth service',
  'the notification fan-out',
  'the export worker',
  'the rate limiter',
  'the session store',
  'the metrics aggregator',
  'the feature flag service',
  'the background job runner',
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
  'memory footprint',
  'GC pause time',
  'request fan-out',
  'token refresh rate',
  'websocket churn',
  'disk I/O',
  'CPU saturation',
  'lock contention',
] as const;

const WINDOWS = [
  'the last 24 hours',
  'the previous seven days',
  'the current sprint',
  'the last deploy',
  'this week',
  'the past hour',
  'the last release',
  'the previous month',
  'the last quarter',
  'the holiday weekend',
] as const;

const OBSERVATIONS = [
  'a few sharp spikes around peak traffic',
  'one noisy tail that clears on its own',
  'a quiet but steady drift',
  'no obvious regression',
  'a clear breakpoint after the deploy',
  'a single outlier worth rechecking',
  'a slow creep that only shows in the tail',
  'a bimodal split between fast and slow paths',
  'a step change that lines up with a config edit',
  'a seasonal pattern we have seen before',
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
  'shard the hot key',
  'add a circuit breaker',
  'batch the small writes',
  'promote the read replica',
  'trim the payload',
  'cache the derived value',
  'add backpressure',
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
  'Risk review',
  'Migration notes',
  'Performance breakdown',
  'Follow-up questions',
  'Decision summary',
  'Next steps',
] as const;

const INSIGHTS = [
  'The pattern points to capacity at peak, not a regression in the query path.',
  'I would confirm the baseline before changing anything structural.',
  'This is a good candidate for one small change and a clean comparison.',
  'The cheapest check is the one most likely to settle the question.',
  'Keep the stable path boring and leave the exploratory path flexible.',
  'Most of the cost is in the long tail rather than the median.',
  'The fix is probably configuration, not code.',
  'I would measure twice and cut once on this one.',
  'The blast radius is small if we stage it behind a flag.',
  'We can learn more from a controlled experiment than from a guess.',
] as const;

const IDENTIFIERS = ['sample', 'snapshot', 'delta', 'window', 'signal', 'result', 'baseline', 'threshold', 'candidate', 'cohort'] as const;
const LANGUAGES = ['ts', 'json', 'bash', 'diff', 'sql', 'yaml'] as const;

const CAUSES = [
  'a connection pool that is too small',
  'a missing index on the hot column',
  'retry storms amplifying a transient blip',
  'a cache stampede on cold keys',
  'head-of-line blocking in the queue',
  'an N+1 query in the list endpoint',
  'oversized payloads on the mobile path',
  'a lock held across an await',
  'stale DNS entries after rotation',
  'a thundering herd on deploy',
] as const;

const RISKS = [
  'partial data loss during migration',
  'a longer tail on the slow path',
  'cache invalidation gaps',
  'user-visible latency spikes',
  'duplicate processing of events',
  'stale reads after a failover',
  'runaway retry loops',
  'memory pressure under load',
] as const;

const QUESTIONS = [
  'Should we ship this behind a flag?',
  'Do we have a clean rollback?',
  'What is the smallest change that helps?',
  'Which metric defines success here?',
  'Who owns the follow-up?',
  'Can we reproduce this locally?',
  'Is there a simpler explanation?',
] as const;

const ENVIRONMENTS = ['production', 'staging', 'canary', 'preview', 'local'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const TEAMS = ['platform', 'mobile', 'data', 'billing', 'growth', 'infra'] as const;

const PARAGRAPH_STARTS = [
  'Looking at the trend,',
  'From what I can see,',
  'The short read is that',
  'In practice,',
  'The interesting part is that',
  'My read is that',
  'The data suggests that',
  'What stands out is that',
] as const;

const SENTENCE_TEMPLATES: Array<() => string> = [
  () => `${pick(SUBJECTS)} shows ${pick(OBSERVATIONS)} over ${pick(WINDOWS)}.`,
  () => `${pick(METRICS)} ${pick(['improved', 'dipped', 'held flat', 'spiked', 'drifted'])} ${pick(['8%', '14%', '21%', '37%', '52%'])} compared with ${pick(WINDOWS)}.`,
  () => `I would ${pick(ACTIONS)} before touching ${pick(SUBJECTS)}.`,
  () => `${pick(INSIGHTS)}`,
  () => `The likely cause is ${pick(CAUSES)}.`,
  () => `The biggest risk is ${pick(RISKS)}, especially in ${pick(ENVIRONMENTS)}.`,
  () => `I would involve ${pick(TEAMS)} before rolling this out broadly.`,
  () => `Severity looks ${pick(SEVERITIES)} given the current ${pick(METRICS)}.`,
  () => `A good next step is to ${pick(ACTIONS)} and re-measure ${pick(METRICS)}.`,
  () => `Keep an eye on ${pick(METRICS)} while ${pick(SUBJECTS)} settles.`,
];

const sentence = (): string => pick(SENTENCE_TEMPLATES)();

const paragraphBlock = () => {
  const count = randomInt(2, 5);
  return `${pick(PARAGRAPH_STARTS)} ${Array.from({ length: count }, () => sentence()).join(' ')}`;
};

const headingBlock = () => `## ${pick(HEADINGS)}`;

const summaryBlock = () =>
  `**Short version:** ${pick(SUBJECTS)} is ${pick(['up', 'down', 'holding steady', 'noisier', 'quieter'])} over ${pick(WINDOWS)}, with ${pick(OBSERVATIONS)}. ${sentence()} ${sentence()}`;

const bulletsBlock = () =>
  pickSome(METRICS, randomInt(4, 7))
    .map(
      (metric) =>
        `- **${metric}** ${pick(['is up', 'held flat', 'improved', 'dipped', 'spiked'])} ${pick(['8%', '14%', '21%', '37%', '52%'])} over ${pick(WINDOWS)}. ${sentence()}`,
    )
    .join('\n');

const stepsBlock = () =>
  [
    `1. **Capture** the current state of ${pick(SUBJECTS)} and record ${pick(METRICS)}.`,
    `2. **Change** one thing: ${pick(ACTIONS)}.`,
    `3. **Measure** ${pick(METRICS)} against ${pick(WINDOWS)}.`,
    `4. **Decide** whether to keep, revert, or iterate.`,
    `5. **Document** what changed and why for ${pick(TEAMS)}.`,
  ].join('\n');

const codeBlock = () => {
  const language = pick(LANGUAGES);
  const name = pick(IDENTIFIERS);
  const value = randomInt(40, 480);
  const subject = pick(SUBJECTS);
  const window = pick(WINDOWS);
  let body: string;
  if (language === 'ts') {
    body = [
      `const ${name} = await measure('${subject}');`,
      `const limit = ${value};`,
      `const filtered = ${name}.filter((item) => item.durationMs < limit);`,
      `const sorted = filtered.sort((a, b) => a.durationMs - b.durationMs);`,
      `return { count: sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)]?.durationMs };`,
    ].join('\n');
  } else if (language === 'json') {
    body = [
      '{',
      `  "subject": "${subject}",`,
      `  "thresholdMs": ${value},`,
      `  "window": "${window}",`,
      `  "compare": true,`,
      `  "owner": "${pick(TEAMS)}"`,
      '}',
    ].join('\n');
  } else if (language === 'bash') {
    body = [
      `# check ${subject}`,
      `measure --window "${window}" --limit ${value}`,
      `compare --baseline "${pick(IDENTIFIERS)}" --candidate "${pick(IDENTIFIERS)}"`,
      `report --format markdown --out report.md`,
    ].join('\n');
  } else if (language === 'sql') {
    body = [
      `SELECT subject, avg(duration_ms) AS avg_ms`,
      `FROM measurements`,
      `WHERE recorded_at > now() - interval '24 hours'`,
      `GROUP BY subject`,
      `ORDER BY avg_ms DESC`,
      `LIMIT ${value};`,
    ].join('\n');
  } else if (language === 'yaml') {
    body = [
      `subject: ${subject}`,
      `thresholdMs: ${value}`,
      `window: ${window}`,
      `owner: ${pick(TEAMS)}`,
      `severity: ${pick(SEVERITIES)}`,
    ].join('\n');
  } else {
    body = [
      `--- a/${pick(IDENTIFIERS)}.ts`,
      `+++ b/${pick(IDENTIFIERS)}.ts`,
      `@@ -10,3 +10,5 @@`,
      `-const limit = ${value - 20};`,
      `+const limit = ${value};`,
      `+const cached = true;`,
    ].join('\n');
  }
  return `\`\`\`${language}\n${body}\n\`\`\``;
};

const tableBlock = () =>
  [
    '| Signal | Now | Before |',
    '| --- | --- | --- |',
    ...Array.from({ length: randomInt(3, 6) }, () =>
      `| ${pick(METRICS)} | ${randomInt(60, 320)}ms | ${randomInt(60, 320)}ms |`,
    ),
  ].join('\n');

const quoteBlock = () => `> ${pick(INSIGHTS)} ${sentence()}`;

const checklistBlock = () =>
  [
    `- [x] Capture ${pick(SUBJECTS)}`,
    `- [x] Record ${pick(METRICS)}`,
    `- [ ] ${pick(ACTIONS)}`,
    `- [ ] ${pick(ACTIONS)}`,
    `- [ ] Re-check ${pick(METRICS)}`,
    `- [ ] Share findings with ${pick(TEAMS)}`,
  ].join('\n');

const closingBlock = () =>
  `${pick(['Next', 'For now', 'If you want to keep going', 'My suggestion', 'Bottom line'])}: ${pick(ACTIONS)}, then compare against ${pick(WINDOWS)}. ${sentence()} See the [notes](https://example.com/notes) if you want the full write-up.`;

const calloutBlock = () =>
  `> **${pick(['Note', 'Tip', 'Caution', 'Heads up', 'FYI'])}:** ${sentence()} ${sentence()}`;

const riskBlock = () =>
  [
    `**Risk:** ${pick(RISKS)}`,
    `- **Impact:** ${sentence()}`,
    `- **Likelihood:** ${pick(SEVERITIES)}`,
    `- **Mitigation:** ${pick(ACTIONS)}.`,
  ].join('\n');

const recommendationBlock = () =>
  [
    `**Recommendation:** ${pick(ACTIONS)}.`,
    sentence(),
    sentence(),
    `Owner: ${pick(TEAMS)}.`,
  ].join('\n');

const timelineBlock = () =>
  [
    `- **Now:** ${sentence()}`,
    `- **Next:** ${pick(ACTIONS)}.`,
    `- **Later:** ${pick(ACTIONS)} and re-check ${pick(METRICS)}.`,
    `- **Follow-up:** ${pick(QUESTIONS)}`,
  ].join('\n');

const faqBlock = () =>
  [
    `**Q:** ${pick(QUESTIONS)}`,
    `**A:** ${sentence()} ${sentence()}`,
  ].join('\n');

const comparisonBlock = () =>
  [
    '| Option | Upside | Downside |',
    '| --- | --- | --- |',
    `| ${pick(ACTIONS)} | ${sentence()} | ${sentence()} |`,
    `| ${pick(ACTIONS)} | ${sentence()} | ${sentence()} |`,
    `| Do nothing | ${sentence()} | ${sentence()} |`,
  ].join('\n');

const nestedListBlock = () =>
  [
    `- ${pick(SUBJECTS)}`,
    `  - ${pick(METRICS)}: ${sentence()}`,
    `  - ${pick(METRICS)}: ${sentence()}`,
    `- ${pick(SUBJECTS)}`,
    `  - ${pick(METRICS)}: ${sentence()}`,
  ].join('\n');

const metricDetailBlock = () =>
  [
    `**${pick(METRICS)}**`,
    `- current: ${randomInt(60, 320)}${pick(['ms', '%', 'rps'])}`,
    `- baseline: ${randomInt(60, 320)}${pick(['ms', '%', 'rps'])}`,
    `- target: ${randomInt(60, 320)}${pick(['ms', '%', 'rps'])}`,
    `- note: ${sentence()}`,
  ].join('\n');

const BLOCKS = [
  paragraphBlock,
  summaryBlock,
  bulletsBlock,
  stepsBlock,
  codeBlock,
  tableBlock,
  quoteBlock,
  checklistBlock,
  closingBlock,
  calloutBlock,
  riskBlock,
  recommendationBlock,
  timelineBlock,
  faqBlock,
  comparisonBlock,
  nestedListBlock,
  metricDetailBlock,
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
  { label: 'Estimate the cost', detail: 'Weigh effort against expected gain' },
  { label: 'Plan the rollout', detail: 'Stage the change behind a flag' },
  { label: 'Check regressions', detail: 'Look for side effects in adjacent paths' },
  { label: 'Review metrics', detail: 'Confirm the baseline and targets' },
] as const;

const TOOL_POOL: AssistantToolName[] = [
  'devices.list',
  'devices.data',
  'locations.list',
  'team.settings',
  'team.members',
  'user.question',
];

const createToolInput = (name: AssistantToolName): AssistantToolInput => {
  if (name === 'devices.data') return { hours: 24, limit: 20, metric: 'all' };
  if (name === 'devices.list' || name === 'locations.list' || name === 'team.members') {
    return { limit: 20 };
  }
  if (name === 'user.question') {
    return {
      prompt: 'A couple of quick choices will help me tailor the answer.',
      customAnswerAllowed: true,
      steps: [
        {
          id: 'metric',
          prompt: 'Which signal matters most right now?',
          suggestedAnswers: ['Temperature', 'Humidity', 'Battery level'],
          recommendedAnswer: 'Temperature',
        },
        {
          id: 'window',
          prompt: 'How far back should I look?',
          suggestedAnswers: ['Last 24 hours', 'Last 7 days', 'Last 30 days'],
          recommendedAnswer: 'Last 24 hours',
        },
      ],
    };
  }
  return {};
};

const TARGET_LENGTHS: Record<AssistantMode, [number, number]> = {
  chat: [1900, 2300],
  task: [18000, 21500],
};

const createContent = (mode: AssistantMode): string => {
  const [min, max] = TARGET_LENGTHS[mode];
  const target = randomInt(min, max);
  const parts: string[] = [];
  if (mode === 'task' || Math.random() < 0.6) parts.push(headingBlock());
  parts.push(paragraphBlock());
  while (parts.join('\n\n').length < target) {
    parts.push(pick(BLOCKS)());
  }
  parts.push(closingBlock());
  return parts.join('\n\n');
};

const createThinking = (count: number): AssistantThinkingStep[] =>
  pickSome(THINKING_POOL, count).map((item, index) =>
    step(`thinking-${index}`, item.label, item.detail, randomInt(120, 340)),
  );

const createTools = (count: number): AssistantToolCall[] =>
  pickSome(TOOL_POOL, count).map((name, index) => ({
    ...tool(
      `tool-${index}`,
      name,
      ASSISTANT_TOOL_DEFINITIONS[name].label,
      randomInt(120, 380),
    ),
    input: createToolInput(name),
  }));

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

type MockToolResult = {
  name: string;
  content: string;
  isError?: boolean;
};

/**
 * Mock follow-up after a tool round. A real provider answers from the tool
 * results; the mock echoes a short summary so the same multi-round loop can be
 * exercised without live AI.
 */
export const createAssistantMockFollowUp = (
  mode: AssistantMode,
  _variant: AssistantVariant,
  results: MockToolResult[],
): AssistantMockStream => {
  const succeeded = results.filter((result) => !result.isError);
  if (succeeded.length === 0) {
    return {
      content:
        "I couldn't read the data I needed, so I don't have a reliable answer for that yet. You can retry the request or adjust the tool permissions.",
      thinking: [],
      tools: [],
    };
  }

  const inputs = succeeded
    .map((result) => result.content.replace(/\s+/g, ' ').slice(0, 160))
    .join(' ');
  const content =
    mode === 'task'
      ? `## Findings\n\nI used the data returned by the tools and reviewed ${succeeded.length} result${succeeded.length === 1 ? '' : 's'}.\n\n${inputs}\n\n## Next steps\n\nIf you want, I can dig into a specific device, location, or team member next.`
      : `Here's what I found: ${inputs}`;

  return { content, thinking: [], tools: [] };
};

export const generateAssistantResponse = (mode: AssistantMode = 'chat'): string =>
  createAssistantMockStream(mode).content;

export const splitAssistantResponseIntoTokens = (text: string): string[] =>
  text.match(/\S+\s*/g) ?? [];