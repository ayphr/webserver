import { randomUUID } from 'node:crypto';
import type { Document } from 'mongodb';
import {
  ASSISTANT_DATA,
  ASSISTANT_MODES,
  ASSISTANT_VARIANTS,
  type AssistantMetricCounters,
  type AssistantMetricsPayload,
  type AssistantMode,
  type AssistantState,
  type AssistantVariant,
} from '@common';
import {
  ASSISTANT_METRICS_COLLECTION,
  getCollection,
  trackMongoOperation,
  type AssistantMetricEventDocument,
  type AssistantMetricEventType,
} from './internal';

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 365;
const DURATION_BUCKETS_MS = [0, 100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000];
const DURATION_BUCKET_DEFAULT = 300_001;

export type AssistantMetricEventInput = {
  type: AssistantMetricEventType;
  mode?: AssistantMode;
  variant?: AssistantVariant;
  result?: 'complete' | 'done' | 'cancelled' | 'error';
  role?: 'user' | 'assistant';
  feedback?: 'like' | 'dislike' | 'none';
  code?: string;
  name?: string;
  status?: string;
  tokens?: number;
  durationMs?: number;
  costProxy?: number;
};

type BucketRow = { _id: string | null; count: number };
type TotalsRow = {
  _id: null;
  events: number;
  streams: number;
  completedStreams: number;
  cancelledStreams: number;
  errorStreams: number;
  messageEvents: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  interrupted: number;
  errors: number;
  cancelled: number;
  thinkingEvents: number;
  thinkingSteps: number;
  toolEvents: number;
  toolCalls: number;
  tokens: number;
  costProxy: number;
  likes: number;
  dislikes: number;
  durationTotalMs: number;
  durationCount: number;
  minMs: number | null;
  maxMs: number | null;
};
type DailyRow = {
  _id: string;
  streams: number;
  messages: number;
  tokens: number;
  costProxy: number;
  durationMs: number;
  durationCount: number;
  thinkingSteps: number;
  toolCalls: number;
  errors: number;
  cancelled: number;
  likes: number;
  dislikes: number;
};
type DurationBucketRow = { _id: number; count: number };
type LatestSnapshotRow = {
  _id: null;
  activeChats: number;
  activeFolders: number;
};
type FacetResult = {
  totals: TotalsRow[];
  modes: BucketRow[];
  variants: BucketRow[];
  modeCounters: Array<{ _id: null } & Partial<Record<AssistantMode, number>>>;
  variantCounters: Array<{ _id: null } & Partial<Record<AssistantVariant, number>>>;
  feedback: BucketRow[];
  feedbackCounters: Array<{ _id: null; like: number; dislike: number }>;
  roles: BucketRow[];
  roleCounters: Array<{ _id: null; user: number; assistant: number }>;
  results: BucketRow[];
  errors: BucketRow[];
  thinkingByStatus: BucketRow[];
  thinkingCounters: Array<{ _id: null; pending: number; running: number; done: number }>;
  toolsByStatus: BucketRow[];
  toolCounters: Array<{ _id: null; pending: number; running: number; done: number; error: number }>;
  eventTools: BucketRow[];
  snapshotTools: BucketRow[];
  durationBuckets: DurationBucketRow[];
  daily: DailyRow[];
  latest: LatestSnapshotRow[];
};

const num = (field: string): Document => ({ $ifNull: [field, 0] });
const isType = (type: string): Document => ({ $eq: ['$type', type] });
const countIf = (condition: Document): Document => ({ $cond: [condition, 1, 0] });

function costProxyForTokens(tokens: number, variant: AssistantVariant): number {
  const multiplier = ASSISTANT_DATA[variant]?.usageRateMultiplierFromBaseline ?? 1;
  return (tokens * multiplier) / 1000;
}

/** Rough token estimate from content length; message text is never persisted in metrics. */
function estimateTokens(content: string): number {
  return content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4));
}

function emptyCounters(): AssistantMetricCounters {
  return {
    activeChats: 0,
    activeFolders: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    interrupted: 0,
    errors: 0,
    likes: 0,
    dislikes: 0,
    tokens: 0,
    costProxy: 0,
    thinkingPending: 0,
    thinkingRunning: 0,
    thinkingDone: 0,
    toolsPending: 0,
    toolsRunning: 0,
    toolsDone: 0,
    toolsError: 0,
  };
}

function subtractCounters(
  current: AssistantMetricCounters,
  previous: AssistantMetricCounters | undefined,
): AssistantMetricCounters {
  const delta = emptyCounters();
  for (const key of Object.keys(current) as Array<keyof AssistantMetricCounters>) {
    delta[key] = Math.max(0, current[key] - (previous?.[key] ?? 0));
  }
  return delta;
}

function subtractCounts(
  current: Record<string, number>,
  previous: Record<string, number | undefined> | undefined,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(current)) {
    const difference = Math.max(0, value - (previous?.[key] ?? 0));
    if (difference > 0) delta[key] = difference;
  }
  return delta;
}

function hasAnyValue(values: Record<string, number>): boolean {
  return Object.values(values).some((value) => value !== 0);
}

function buildSnapshotCounters(state: AssistantState): {
  counters: AssistantMetricCounters;
  countersByMode: Partial<Record<AssistantMode, number>>;
  countersByVariant: Partial<Record<AssistantVariant, number>>;
  toolsByName: Array<{ name: string; count: number }>;
} {
  const counters = emptyCounters();
  const countersByMode: Partial<Record<AssistantMode, number>> = {};
  const countersByVariant: Partial<Record<AssistantVariant, number>> = {};
  const tools = new Map<string, number>();

  counters.activeChats = state.chats.length;
  counters.activeFolders = state.folders.length;

  for (const chat of state.chats) {
    for (const message of chat.messages) {
      const variant = message.variant ?? state.preferences.defaultVariant;
      counters.messages += 1;
      countersByMode[chat.mode] = (countersByMode[chat.mode] ?? 0) + 1;
      countersByVariant[variant] = (countersByVariant[variant] ?? 0) + 1;

      if (message.role === 'user') {
        counters.userMessages += 1;
      } else {
        counters.assistantMessages += 1;
        const tokens = estimateTokens(message.content);
        counters.tokens += tokens;
        counters.costProxy += costProxyForTokens(tokens, variant);
      }

      if (message.interrupted) counters.interrupted += 1;
      if (message.error) counters.errors += 1;
      if (message.feedback === 'like') counters.likes += 1;
      if (message.feedback === 'dislike') counters.dislikes += 1;

      for (const step of message.thinking ?? []) {
        if (step.status === 'pending') counters.thinkingPending += 1;
        if (step.status === 'running') counters.thinkingRunning += 1;
        if (step.status === 'done') counters.thinkingDone += 1;
      }

      for (const tool of message.tools ?? []) {
        if (tool.status === 'pending') counters.toolsPending += 1;
        if (tool.status === 'running') counters.toolsRunning += 1;
        if (tool.status === 'done') counters.toolsDone += 1;
        if (tool.status === 'error') counters.toolsError += 1;
        tools.set(tool.name, (tools.get(tool.name) ?? 0) + 1);
      }
    }
  }

  counters.costProxy = Math.round(counters.costProxy * 1000) / 1000;
  return {
    counters,
    countersByMode,
    countersByVariant,
    toolsByName: [...tools].map(([name, count]) => ({ name, count })),
  };
}

/**
 * Records the delta since the previous state save as a count-only event.
 * Cumulative counts stay on the document solely so the next delta can be
 * computed; chat content is never copied into the metrics collection.
 */
export async function recordAssistantStateMetrics(userUuid: string, state: AssistantState): Promise<void> {
  const metrics = await getCollection('assistantMetrics');
  trackMongoOperation('findOne', ASSISTANT_METRICS_COLLECTION);
  const previous = await metrics.findOne(
    { userUuid, type: 'state' },
    { sort: { timestamp: -1 } },
  );

  const { counters, countersByMode, countersByVariant, toolsByName } = buildSnapshotCounters(state);
  const delta = subtractCounters(counters, previous?.cumulative);
  const modeDelta: Partial<Record<AssistantMode, number>> = subtractCounts(
    { ...countersByMode },
    previous?.countersByMode,
  );
  const variantDelta: Partial<Record<AssistantVariant, number>> = subtractCounts(
    { ...countersByVariant },
    previous?.countersByVariant,
  );

  const previousTools = new Map((previous?.toolsByName ?? []).map((tool) => [tool.name, tool.count]));
  const toolDelta = toolsByName
    .map((tool) => ({ name: tool.name, count: Math.max(0, tool.count - (previousTools.get(tool.name) ?? 0)) }))
    .filter((tool) => tool.count > 0);

  if (!hasAnyValue(delta) && !hasAnyValue(modeDelta) && !hasAnyValue(variantDelta) && toolDelta.length === 0) {
    return;
  }

  const document: AssistantMetricEventDocument = {
    id: randomUUID(),
    userUuid,
    type: 'state',
    timestamp: new Date(),
    tokens: delta.tokens,
    costProxy: delta.costProxy,
    durationMs: 0,
    counters: delta,
    cumulative: counters,
    countersByMode: modeDelta,
    countersByVariant: variantDelta,
    toolsByName: toolDelta,
  };

  trackMongoOperation('insertOne', ASSISTANT_METRICS_COLLECTION);
  await metrics.insertOne(document);
}

/** Records a single lightweight metrics event (no message content allowed). */
export async function recordAssistantMetricEvent(
  userUuid: string,
  event: AssistantMetricEventInput,
): Promise<void> {
  const metrics = await getCollection('assistantMetrics');
  const tokens = Math.max(0, event.tokens ?? 0);
  const variant = event.variant ?? 'standard';
  const document: AssistantMetricEventDocument = {
    id: randomUUID(),
    userUuid,
    type: event.type,
    timestamp: new Date(),
    tokens,
    costProxy: event.costProxy ?? costProxyForTokens(tokens, variant),
    durationMs: Math.max(0, event.durationMs ?? 0),
    ...(event.mode ? { mode: event.mode } : {}),
    ...(event.variant ? { variant: event.variant } : {}),
    ...(event.result ? { result: event.result } : {}),
    ...(event.role ? { role: event.role } : {}),
    ...(event.feedback ? { feedback: event.feedback } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(event.name ? { name: event.name } : {}),
    ...(event.status ? { status: event.status } : {}),
  };

  trackMongoOperation('insertOne', ASSISTANT_METRICS_COLLECTION);
  await metrics.insertOne(document);
}

export function normalizeAssistantMetricsPeriodDays(value: string | null): number {
  if (!value) return DEFAULT_PERIOD_DAYS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PERIOD_DAYS;
  return Math.min(MAX_PERIOD_DAYS, Math.floor(parsed));
}

function fillBuckets<T extends string>(keys: readonly T[], rows: BucketRow[]): Record<T, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const row of rows) {
    if (typeof row._id !== 'string') continue;
    if (Object.prototype.hasOwnProperty.call(result, row._id)) {
      result[row._id as T] += row.count;
    }
  }
  return result;
}

function percentileFromBuckets(buckets: DurationBucketRow[], fraction: number): number {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return 0;

  const sorted = [...buckets].sort((a, b) => a._id - b._id);
  const target = total * fraction;
  let running = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const bucket = sorted[index]!;
    running += bucket.count;
    if (running < target) continue;

    const lower = bucket._id === DURATION_BUCKET_DEFAULT ? DURATION_BUCKETS_MS[DURATION_BUCKETS_MS.length - 1]! : bucket._id;
    const nextBoundary = DURATION_BUCKETS_MS.find((boundary) => boundary > lower);
    const upper = nextBoundary ?? lower * 2;
    return Math.round((lower + upper) / 2);
  }

  return DURATION_BUCKETS_MS[DURATION_BUCKETS_MS.length - 1]!;
}

function buildPipeline(match: Document): Document[] {
  const thinkingStepsExpression = {
    $add: [
      num('$counters.thinkingPending'),
      num('$counters.thinkingRunning'),
      num('$counters.thinkingDone'),
      countIf(isType('thinking')),
    ],
  };
  const toolCallsExpression = {
    $add: [
      num('$counters.toolsPending'),
      num('$counters.toolsRunning'),
      num('$counters.toolsDone'),
      num('$counters.toolsError'),
      countIf(isType('tool')),
    ],
  };
  const messagesExpression = { $add: [num('$counters.messages'), countIf(isType('message'))] };
  const userMessagesExpression = { $add: [num('$counters.userMessages'), countIf({ $and: [isType('message'), { $eq: ['$role', 'user'] }] })] };
  const assistantMessagesExpression = { $add: [num('$counters.assistantMessages'), countIf({ $and: [isType('message'), { $eq: ['$role', 'assistant'] }] })] };
  const tokensExpression = { $add: [num('$tokens'), num('$counters.tokens')] };
  const costProxyExpression = { $add: [num('$costProxy'), num('$counters.costProxy')] };
  const errorsExpression = { $add: [num('$counters.errors'), countIf(isType('error'))] };
  const cancelledExpression = { $add: [num('$counters.interrupted'), countIf(isType('cancel'))] };

  return [
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              events: { $sum: 1 },
              streams: { $sum: countIf(isType('stream')) },
              completedStreams: {
                $sum: countIf({
                  $and: [
                    isType('stream'),
                    { $or: [{ $eq: ['$result', 'complete'] }, { $eq: ['$result', 'done'] }] },
                  ],
                }),
              },
              cancelledStreams: {
                $sum: {
                  $add: [
                    countIf({ $and: [isType('stream'), { $eq: ['$result', 'cancelled'] }] }),
                    countIf(isType('cancel')),
                  ],
                },
              },
              errorStreams: {
                $sum: {
                  $add: [
                    countIf({ $and: [isType('stream'), { $eq: ['$result', 'error'] }] }),
                    countIf(isType('error')),
                  ],
                },
              },
              messageEvents: { $sum: countIf(isType('message')) },
              messages: { $sum: messagesExpression },
              userMessages: { $sum: userMessagesExpression },
              assistantMessages: { $sum: assistantMessagesExpression },
              interrupted: { $sum: num('$counters.interrupted') },
              errors: { $sum: errorsExpression },
              cancelled: { $sum: cancelledExpression },
              thinkingEvents: { $sum: countIf(isType('thinking')) },
              thinkingSteps: { $sum: thinkingStepsExpression },
              toolEvents: { $sum: countIf(isType('tool')) },
              toolCalls: { $sum: toolCallsExpression },
              tokens: { $sum: tokensExpression },
              costProxy: { $sum: costProxyExpression },
              likes: { $sum: { $add: [num('$counters.likes'), countIf({ $and: [isType('feedback'), { $eq: ['$feedback', 'like'] }] })] } },
              dislikes: { $sum: { $add: [num('$counters.dislikes'), countIf({ $and: [isType('feedback'), { $eq: ['$feedback', 'dislike'] }] })] } },
              durationTotalMs: { $sum: num('$durationMs') },
              durationCount: { $sum: countIf({ $gt: ['$durationMs', 0] }) },
              minMs: { $min: { $cond: [{ $gt: ['$durationMs', 0] }, '$durationMs', null] } },
              maxMs: { $max: { $cond: [{ $gt: ['$durationMs', 0] }, '$durationMs', null] } },
            },
          },
        ],
        modes: [
          { $match: { mode: { $exists: true, $ne: null } } },
          { $group: { _id: '$mode', count: { $sum: 1 } } },
        ],
        variants: [
          { $match: { variant: { $exists: true, $ne: null } } },
          { $group: { _id: '$variant', count: { $sum: 1 } } },
        ],
        modeCounters: [
          {
            $group: {
              _id: null,
              ...Object.fromEntries(
                ASSISTANT_MODES.map((mode) => [mode, { $sum: num(`$countersByMode.${mode}`) }]),
              ),
            },
          },
        ],
        variantCounters: [
          {
            $group: {
              _id: null,
              ...Object.fromEntries(
                ASSISTANT_VARIANTS.map((variant) => [variant, { $sum: num(`$countersByVariant.${variant}`) }]),
              ),
            },
          },
        ],
        feedback: [
          { $match: { feedback: { $exists: true, $ne: null } } },
          { $group: { _id: '$feedback', count: { $sum: 1 } } },
        ],
        feedbackCounters: [
          {
            $group: {
              _id: null,
              like: { $sum: num('$counters.likes') },
              dislike: { $sum: num('$counters.dislikes') },
            },
          },
        ],
        roles: [
          { $match: { role: { $exists: true, $ne: null } } },
          { $group: { _id: '$role', count: { $sum: 1 } } },
        ],
        roleCounters: [
          {
            $group: {
              _id: null,
              user: { $sum: num('$counters.userMessages') },
              assistant: { $sum: num('$counters.assistantMessages') },
            },
          },
        ],
        results: [
          { $match: { result: { $exists: true, $ne: null } } },
          { $group: { _id: '$result', count: { $sum: 1 } } },
        ],
        errors: [
          { $match: { type: 'error' } },
          { $group: { _id: { $ifNull: ['$code', 'unknown'] }, count: { $sum: 1 } } },
        ],
        thinkingByStatus: [
          { $match: { type: 'thinking', status: { $exists: true, $ne: null } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ],
        thinkingCounters: [
          {
            $group: {
              _id: null,
              pending: { $sum: num('$counters.thinkingPending') },
              running: { $sum: num('$counters.thinkingRunning') },
              done: { $sum: num('$counters.thinkingDone') },
            },
          },
        ],
        toolsByStatus: [
          { $match: { type: 'tool', status: { $exists: true, $ne: null } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ],
        toolCounters: [
          {
            $group: {
              _id: null,
              pending: { $sum: num('$counters.toolsPending') },
              running: { $sum: num('$counters.toolsRunning') },
              done: { $sum: num('$counters.toolsDone') },
              error: { $sum: num('$counters.toolsError') },
            },
          },
        ],
        eventTools: [
          { $match: { type: 'tool', name: { $exists: true, $ne: null } } },
          { $group: { _id: '$name', count: { $sum: 1 } } },
        ],
        snapshotTools: [
          { $unwind: '$toolsByName' },
          { $group: { _id: '$toolsByName.name', count: { $sum: '$toolsByName.count' } } },
        ],
        durationBuckets: [
          { $match: { durationMs: { $gt: 0 } } },
          {
            $bucket: {
              groupBy: '$durationMs',
              boundaries: DURATION_BUCKETS_MS,
              default: DURATION_BUCKET_DEFAULT,
              output: { count: { $sum: 1 } },
            },
          },
        ],
        daily: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'UTC' } },
              streams: { $sum: countIf(isType('stream')) },
              messages: { $sum: messagesExpression },
              tokens: { $sum: tokensExpression },
              costProxy: { $sum: costProxyExpression },
              durationMs: { $sum: num('$durationMs') },
              durationCount: { $sum: countIf({ $gt: ['$durationMs', 0] }) },
              thinkingSteps: { $sum: thinkingStepsExpression },
              toolCalls: { $sum: toolCallsExpression },
              errors: { $sum: errorsExpression },
              cancelled: { $sum: cancelledExpression },
              likes: { $sum: { $add: [num('$counters.likes'), countIf({ $and: [isType('feedback'), { $eq: ['$feedback', 'like'] }] })] } },
              dislikes: { $sum: { $add: [num('$counters.dislikes'), countIf({ $and: [isType('feedback'), { $eq: ['$feedback', 'dislike'] }] })] } },
            },
          },
        ],
        latest: [
          { $match: { type: 'state' } },
          { $sort: { timestamp: -1 } },
          { $group: { _id: '$userUuid', snapshot: { $first: '$$ROOT' } } },
          {
            $group: {
              _id: null,
              activeChats: {
                $sum: { $ifNull: ['$snapshot.cumulative.activeChats', { $ifNull: ['$snapshot.counters.activeChats', 0] }] },
              },
              activeFolders: {
                $sum: { $ifNull: ['$snapshot.cumulative.activeFolders', { $ifNull: ['$snapshot.counters.activeFolders', 0] }] },
              },
            },
          },
        ],
      },
    },
  ];
}

/** Aggregates per-user (or global for staff) assistant metrics from lightweight events. */
export async function getAssistantMetrics(
  userUuid: string | null = null,
  periodDays = DEFAULT_PERIOD_DAYS,
): Promise<AssistantMetricsPayload> {
  const metrics = await getCollection('assistantMetrics');
  const days = normalizeAssistantMetricsPeriodDays(String(periodDays));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match: Document = { timestamp: { $gte: since } };
  if (userUuid) match.userUuid = userUuid;

  trackMongoOperation('aggregate', ASSISTANT_METRICS_COLLECTION);
  const rows = await metrics.aggregate<FacetResult>(buildPipeline(match)).toArray();
  const facet = rows[0];

  const totals = facet?.totals[0];
  const modeCounters: Partial<Record<AssistantMode, number>> = facet?.modeCounters[0] ?? {};
  const variantCounters: Partial<Record<AssistantVariant, number>> = facet?.variantCounters[0] ?? {};
  const latest = facet?.latest[0];

  const byMode = fillBuckets(ASSISTANT_MODES, facet?.modes ?? []);
  for (const mode of ASSISTANT_MODES) {
    byMode[mode] += modeCounters[mode] ?? 0;
  }
  const byVariant = fillBuckets(ASSISTANT_VARIANTS, facet?.variants ?? []);
  for (const variant of ASSISTANT_VARIANTS) {
    byVariant[variant] += variantCounters[variant] ?? 0;
  }

  const byFeedback = fillBuckets(['like', 'dislike', 'none'] as const, facet?.feedback ?? []);
  byFeedback.like += facet?.feedbackCounters[0]?.like ?? 0;
  byFeedback.dislike += facet?.feedbackCounters[0]?.dislike ?? 0;
  const byRole = fillBuckets(['user', 'assistant'] as const, facet?.roles ?? []);
  byRole.user += facet?.roleCounters[0]?.user ?? 0;
  byRole.assistant += facet?.roleCounters[0]?.assistant ?? 0;
  const byResult = fillBuckets(['complete', 'done', 'cancelled', 'error'] as const, facet?.results ?? []);

  const byError: Record<string, number> = {};
  for (const row of facet?.errors ?? []) {
    if (row._id) byError[row._id] = row.count;
  }

  const thinkingByStatus = fillBuckets(['pending', 'running', 'done'] as const, facet?.thinkingByStatus ?? []);
  thinkingByStatus.pending += facet?.thinkingCounters[0]?.pending ?? 0;
  thinkingByStatus.running += facet?.thinkingCounters[0]?.running ?? 0;
  thinkingByStatus.done += facet?.thinkingCounters[0]?.done ?? 0;
  const toolsByStatus = fillBuckets(['pending', 'running', 'done', 'error'] as const, facet?.toolsByStatus ?? []);
  toolsByStatus.pending += facet?.toolCounters[0]?.pending ?? 0;
  toolsByStatus.running += facet?.toolCounters[0]?.running ?? 0;
  toolsByStatus.done += facet?.toolCounters[0]?.done ?? 0;
  toolsByStatus.error += facet?.toolCounters[0]?.error ?? 0;

  const toolCounts = new Map<string, number>();
  for (const row of [...(facet?.eventTools ?? []), ...(facet?.snapshotTools ?? [])]) {
    if (!row._id) continue;
    toolCounts.set(row._id, (toolCounts.get(row._id) ?? 0) + row.count);
  }
  const topTools = [...toolCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 10);

  const durationCount = totals?.durationCount ?? 0;
  const durationTotalMs = totals?.durationTotalMs ?? 0;
  const durationBuckets = facet?.durationBuckets ?? [];

  return {
    scope: userUuid ? 'user' : 'global',
    generatedAt: new Date(),
    periodDays: days,
    totals: {
      events: totals?.events ?? 0,
      streams: totals?.streams ?? 0,
      completedStreams: totals?.completedStreams ?? 0,
      cancelledStreams: totals?.cancelledStreams ?? 0,
      errorStreams: totals?.errorStreams ?? 0,
      messages: totals?.messages ?? 0,
      userMessages: totals?.userMessages ?? 0,
      assistantMessages: totals?.assistantMessages ?? 0,
      interrupted: totals?.interrupted ?? 0,
      errors: totals?.errors ?? 0,
      cancelled: totals?.cancelled ?? 0,
      thinkingSteps: totals?.thinkingSteps ?? 0,
      toolCalls: totals?.toolCalls ?? 0,
      tokens: totals?.tokens ?? 0,
      costProxy: Math.round((totals?.costProxy ?? 0) * 1000) / 1000,
      likes: totals?.likes ?? 0,
      dislikes: totals?.dislikes ?? 0,
      activeChats: latest?.activeChats ?? 0,
      activeFolders: latest?.activeFolders ?? 0,
    },
    byMode,
    byVariant,
    byFeedback,
    byRole,
    byResult,
    byError,
    thinkingByStatus,
    toolsByStatus,
    topTools,
    duration: {
      count: durationCount,
      totalMs: Math.round(durationTotalMs),
      averageMs: durationCount === 0 ? 0 : Math.round(durationTotalMs / durationCount),
      minMs: Math.round(totals?.minMs ?? 0),
      maxMs: Math.round(totals?.maxMs ?? 0),
      p50Ms: percentileFromBuckets(durationBuckets, 0.5),
      p95Ms: percentileFromBuckets(durationBuckets, 0.95),
    },
    daily: [...(facet?.daily ?? [])]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((row) => ({
        date: row._id,
        streams: row.streams,
        messages: row.messages,
        tokens: row.tokens,
        costProxy: Math.round(row.costProxy * 1000) / 1000,
        durationMs: Math.round(row.durationMs),
        durationCount: row.durationCount,
        thinkingSteps: row.thinkingSteps,
        toolCalls: row.toolCalls,
        errors: row.errors,
        cancelled: row.cancelled,
        likes: row.likes,
        dislikes: row.dislikes,
      })),
  };
}
