import type { ServerWebSocket, WebSocketHandler } from 'bun';
import {
  ASSISTANT_CONTEXT_SUMMARY_TOKEN_BUDGET,
  ASSISTANT_MODES,
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_TOOL_DEFINITIONS,
  ASSISTANT_TOOL_PERMISSION_DECISIONS,
  ASSISTANT_VARIANTS,
  DEFAULT_ASSISTANT_PREFERENCES,
  describeAssistantToolChange,
  isAssistantMutationTool,
  isAssistantToolName,
  estimateTokens,
  getAssistantModel,
  normalizeAssistantToolInput,
  planAssistantContext,
  toContextMessages,
  type AssistantContextMessage,
  type AssistantContextUsage,
  type AssistantMessage,
  type AssistantState,
  type AssistantToolResult,
  type AssistantUserQuestion,
  type AssistantMode,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantStreamClientMessage,
  type AssistantStreamServerMessage,
  type AssistantThinkingStatus,
  type AssistantToolCall,
  type AssistantToolPermission,
  type AssistantToolPermissionDecision,
  type AssistantToolStatus,
  type AssistantVariant,
} from '@common';
import {
  detectSafetyCategories,
  noticeForSafetyCategories,
  safeContentForNotice,
  shouldShortCircuitPrompt,
  type SafetyNotice,
} from '../../../common/utils/safety';
import { estimateAssistantUsageCredits } from '../../../common/utils/assistantPricing';
import { runBackgroundTask } from '../lib/backgroundTasks';
import { splitAssistantResponseIntoTokens } from '../lib/assistantStream';
import { summarizeAssistantContext } from '../lib/assistantContextSummary';
import {
  getAssistantModelAdapter,
  type AssistantModelDraft,
  type AssistantModelToolResult,
} from '../lib/assistantModel';
import { buildAssistantSystemPrompt } from '../lib/geminiAdapter';
import { executeAssistantTool } from '../lib/assistantTools';
import { redactPII } from '@common';
import { getUserFromUuid } from '../lib/db';
import { getTeamForUser } from '../lib/db/teams';
import { logTeamAudit } from '../lib/teamAuditService';
import { getAssistantState, saveStreamResult, updateAssistantChatContext } from '../lib/db/assistant';
import { createLogger } from '../lib/logger';
import {
  assistantActiveStreams,
  assistantMessagesTotal,
  assistantResumeTotal,
  assistantStreamDuration,
  assistantStreamErrorsTotal,
  assistantStreamsTotal,
  assistantStreamTokensTotal,
  assistantThinkingStepsTotal,
  assistantToolCallsTotal,
  assistantWebsocketEventsTotal,
  assistantSafetyEventsTotal,
  assistantContextTokens,
  assistantContextCompactionsTotal,
} from '../lib/metrics';
import { notifyUser } from '../lib/notifications';
import { getUserFromToken } from './auth';
import {
  getCreditBalanceFromUuid,
  holdCredits,
  settleCreditHold,
} from '../lib/credits';

const log = createLogger('assistant-websocket');

/** Adds a human-readable change preview to every tool before it reaches the UI. */
const withToolPreviews = (
  draft: AssistantModelDraft,
  knownSerials: string[] = [],
): AssistantModelDraft => ({
  ...draft,
  tools: draft.tools.map((tool) => ({
    ...tool,
    preview: tool.preview
      ? redactPII(tool.preview, knownSerials)
      : redactPII(
          describeAssistantToolChange(tool.name, tool.input ?? {}) ?? '',
          knownSerials,
        ) || undefined,
  })),
});

export type AssistantSocketData = { userUuid: string | null };
type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type Timer = ReturnType<typeof setTimeout>;

type ActiveStream = {
  cancelled: boolean;
  /** Live timers (overall deadline and interactive waits) for this stream. */
  timers: Set<Timer>;
  /** Guards the active-stream gauge across cancel, completion and socket close. */
  gaugeReleased: boolean;
  detached: boolean;
  /** Rejects a pending permission/answer wait so credits cannot be held forever. */
  onOrphaned?: () => void;
  /** Aborts the in-flight provider request so streaming stops immediately. */
  onAbort?: () => void;
  /** Releases the hold and charges the credits actually used. */
  onSettle?: () => Promise<number>;
  /** Resolves the stream's lifetime once cancellation has been handled. */
  onFinish?: () => void;
};
type ActiveStreams = Map<string, ActiveStream>;
type ToolPermissionHandler = (
  toolId: string,
  decision: AssistantToolPermissionDecision,
) => void;
type ToolResponseHandler = (
  toolId: string,
  answers: Record<string, string>,
  customAnswer?: string,
) => void;
type HandlerMap<T> = Map<AssistantWebSocket, Map<string, T>>;

const MAX_CONCURRENT_STREAMS = 8;
const AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60_000;
const USER_QUESTION_TIMEOUT_MS = 60_000;
const DEFAULT_TASK_LINK = '/dashboard';
/** Task mode may chain many tool rounds; chat is capped much lower. */
const MAX_CHAT_TOOL_ROUNDS = 8;
const MAX_TASK_TOOL_ROUNDS = 64;

const maxToolRounds = (mode: AssistantMode) =>
  mode === 'task' ? MAX_TASK_TOOL_ROUNDS : MAX_CHAT_TOOL_ROUNDS;

const assistantChatLink = (chatId?: string) =>
  chatId
    ? `/dashboard/assistant/chat/${encodeURIComponent(chatId)}`
    : DEFAULT_TASK_LINK;

/** Notifications are a task feature; chats stay quiet even while running. */
const notificationLevelFor = (
  mode: AssistantMode,
  level: AssistantNotificationLevel,
): AssistantNotificationLevel => (mode === 'task' ? level : 'never');

const streamTimeoutMs = (): number => {
  const configured = Number(process.env.ASSISTANT_STREAM_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 60 * 60_000)
    : DEFAULT_STREAM_TIMEOUT_MS;
};

const activeStreams = new Map<AssistantWebSocket, ActiveStreams>();
const authTimers = new Map<AssistantWebSocket, Timer>();
const messageQueues = new Map<AssistantWebSocket, Promise<void>>();
// Handler maps are scoped by socket: a decision on one connection must never
// approve or answer a tool call made on another connection.
const toolPermissionHandlers: HandlerMap<ToolPermissionHandler> = new Map();
const toolResponseHandlers: HandlerMap<ToolResponseHandler> = new Map();

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const send = (ws: AssistantWebSocket, message: AssistantStreamServerMessage) => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(message));
};

const rejectUnauthenticated = (ws: AssistantWebSocket, error: string) => {
  send(ws, { type: 'auth_error', error });
  ws.close();
};

const clearTimers = (timers: Set<Timer>) => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
};

const handlersFor = <T>(
  map: HandlerMap<T>,
  ws: AssistantWebSocket,
  create = false,
): Map<string, T> | undefined => {
  const existing = map.get(ws);
  if (existing) return existing;
  if (!create) return undefined;
  const created = new Map<string, T>();
  map.set(ws, created);
  return created;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TOOL_NAME_PATTERN = new RegExp(
  `\\b(?:${Object.keys(ASSISTANT_TOOL_DEFINITIONS).map(escapeRegExp).join('|')})\\b`,
  'g',
);
const INTERNAL_DETAIL_PATTERNS = [
  /\b(?:gemini|google)[- ]?\d+(?:\.\d+)*[-a-z]*\b/gi,
  /\b(?:gemini-tool|call|req)-[A-Za-z0-9_-]{4,}\b/gi,
  /\b(?:\/v1beta\/|v1beta\/)[A-Za-z0-9_/-]*\b/gi,
  /\b\/ws\/assistant\b/g,
  /\b(?:assistantStates|creditTransactions|teamAuditLogs|streamResults)\b/gi,
  /\b(?:team|user|chat|alert|notification|session|device|location)_[A-Za-z0-9_-]{6,}\b/gi,
  /\b(?:system_instruction|generation_config|call_id|toolId|referenceId|onHold|monthlyUsed|isError|x-goog-api-key)\b/gi,
  /\$?0\.005\b/g,
];

/** Keeps model output free of internal identifiers, paths and cost arithmetic. */
export const scrubInternalDetails = (text: string, requestId?: string): string => {
  let result = text.replace(TOOL_NAME_PATTERN, 'the workspace lookup');
  for (const pattern of INTERNAL_DETAIL_PATTERNS) {
    result = result.replace(pattern, '[internal detail]');
  }
  if (requestId && requestId.length > 3) {
    result = result.split(requestId).join('[internal detail]');
  }
  return result;
};

/** Assistant notifications are deliberately generic across chats and tasks. */
const notifyTaskUser = (
  userUuid: string,
  link: string,
  notificationLevel: AssistantNotificationLevel,
  succeeded: boolean,
) => {
  if (notificationLevel === 'never') return;

  void runBackgroundTask('assistant-task-notification', () =>
    notifyUser({
      userUuid,
      type: 'assistant_task',
      title: 'Iris',
      message: succeeded
        ? 'Iris has finished responding.'
        : "There was an error in Iris' response.",
      link,
    }),
  );
};

/** Interactive tools need a response even from chat mode, unlike task completion notices. */
const notifyUserQuestion = (
  userUuid: string,
  link: string,
  notificationLevel: AssistantNotificationLevel,
) => {
  if (notificationLevel === 'never') return;

  void runBackgroundTask('assistant-user-question-notification', () =>
    notifyUser({
      userUuid,
      type: 'assistant_task',
      title: 'Iris',
      message: 'Iris needs your answer.',
      link,
    }),
  );
};

type StreamResultInput = {
  userUuid: string;
  chatId: string;
  messageId: number;
  prompt?: string;
  mode: AssistantMode;
  variant: AssistantVariant;
  /** Omitted for the initial prompt write; set once the response is complete. */
  content?: string;
  thinking?: NonNullable<AssistantMessage['thinking']>;
  tools?: NonNullable<AssistantMessage['tools']>;
  safetyNotice?: SafetyNotice;
  durationMs?: number;
  creditCost?: number;
  notificationLevel: AssistantNotificationLevel;
  link: string;
};

/**
 * Persist the server's version of a stream. Called once when the stream starts
 * (to save the prompt) and again when it completes (to save the response).
 * This is the only writer of chat message content; clients only render the
 * live stream and reload the authoritative state afterwards.
 */
const persistStreamResult = async (input: StreamResultInput): Promise<void> => {
  const now = Date.now();
  const assistantMessage: AssistantMessage | undefined =
    input.content === undefined
      ? undefined
      : {
          id: input.messageId,
          role: 'assistant',
          content: input.content,
          createdAt: now,
          variant: input.variant,
          durationMs: input.durationMs,
          creditCost: input.creditCost,
          safetyNotice: input.safetyNotice,
          thinking: (input.thinking ?? []).map((step) => ({ ...step, status: 'done' })),
          tools: input.tools ?? [],
        };
  const userMessage: AssistantMessage | undefined = input.prompt
    ? {
        id: Math.max(1, input.messageId - 1),
        role: 'user',
        content: input.prompt,
        createdAt: now - 1,
      }
    : undefined;

  if (input.content !== undefined) {
    assistantMessagesTotal.labels('assistant').inc();
  }
  if (input.content === undefined && input.prompt) {
    assistantMessagesTotal.labels('user').inc();
  }
  try {
    await saveStreamResult(input.userUuid, {
      chatId: input.chatId,
      messageId: input.messageId,
      chatTitle: input.prompt?.trim().slice(0, 60) || 'Assistant chat',
      mode: input.mode,
      userMessage,
      assistantMessage,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    log.warn(
      { error, userUuid: input.userUuid, chatId: input.chatId },
      'failed to persist assistant stream result',
    );
    notifyTaskUser(input.userUuid, input.link, input.notificationLevel, false);
  }
};

/**
 * Detaches a stream from all socket-keyed maps exactly once. `onOrphaned` runs
 * before the handler maps are deleted so a pending tool question or approval
 * is rejected instead of being left waiting with a credit hold in place.
 */
const detachStream = (
  ws: AssistantWebSocket,
  requestId: string,
  stream: ActiveStream,
  options: { clearTimers?: boolean } = {},
) => {
  if (!stream.detached) {
    stream.detached = true;
    stream.onOrphaned?.();
    stream.onOrphaned = undefined;
    if (options.clearTimers !== false) clearTimers(stream.timers);
    const streams = activeStreams.get(ws);
    if (streams?.get(requestId) === stream) streams.delete(requestId);
    handlersFor(toolPermissionHandlers, ws)?.delete(requestId);
    handlersFor(toolResponseHandlers, ws)?.delete(requestId);
  }
  if (!stream.gaugeReleased) {
    stream.gaugeReleased = true;
    assistantActiveStreams.dec();
  }
};

const cancelStream = (ws: AssistantWebSocket, requestId: string) => {
  const streams = activeStreams.get(ws);
  const stream = streams?.get(requestId);
  if (!stream || !streams) return;

  stream.cancelled = true;
  stream.onAbort?.();
  detachStream(ws, requestId, stream);
  stream.onFinish?.();
  assistantWebsocketEventsTotal.labels('cancel', 'ok').inc();
  if (stream.onSettle) {
    void stream.onSettle().catch((error: unknown) => {
      log.warn({ error, requestId }, 'failed to settle assistant credits after cancel');
    });
  }
};

const isMode = (value: unknown): value is AssistantMode =>
  typeof value === 'string' && ASSISTANT_MODES.includes(value as AssistantMode);

const isVariant = (value: unknown): value is AssistantVariant =>
  typeof value === 'string' && ASSISTANT_VARIANTS.includes(value as AssistantVariant);

type PreparedContext = {
  usage: AssistantContextUsage;
  contextMessages: ReturnType<typeof planAssistantContext>['contextMessages'];
  summary?: string;
};

/**
 * Loads the authoritative chat, estimates its context usage and compacts old
 * messages when needed. Compaction is local; only response generation uses the
 * model provider.
 */
const prepareContext = async (
  userUuid: string,
  chatId: string | undefined,
  variant: AssistantVariant,
  prompt: string | undefined,
  trigger: 'stream' | 'manual',
  state?: AssistantState | null,
): Promise<PreparedContext> => {
  const assistantState = state ?? (chatId ? await getAssistantState(userUuid) : null);
  const chat = assistantState?.chats.find((item) => item.id === chatId);
  let plan = planAssistantContext({ chat, variant, prompt });
  let summary = chat?.contextSummary;

  if (chatId && chat && (plan.needsCompaction || trigger === 'manual') && plan.olderMessages.length > 0) {
    try {
      const summaryMessages: AssistantContextMessage[] = summary
        ? [{ role: 'system', content: summary }]
        : [];
      const generated = summarizeAssistantContext(
        [...summaryMessages, ...toContextMessages(plan.olderMessages)],
        ASSISTANT_CONTEXT_SUMMARY_TOKEN_BUDGET,
      );
      if (generated.trim()) {
        summary = generated;
        const compactedThroughMessageId = plan.olderMessages[plan.olderMessages.length - 1]?.id;
        if (compactedThroughMessageId !== undefined) {
          await updateAssistantChatContext(userUuid, chatId, {
            contextSummary: summary,
            compactedThroughMessageId,
          });
          plan = planAssistantContext({
            chat: { ...chat, contextSummary: summary, compactedThroughMessageId },
            variant,
            prompt,
          });
          assistantContextCompactionsTotal.labels(variant, trigger).inc();
        }
      }
    } catch (error) {
      log.warn({ error, userUuid, chatId }, 'failed to compact assistant context');
    }
  }

  assistantContextTokens.labels(variant).set(plan.usage.usedTokens);
  if (chatId && chat) assistantResumeTotal.labels(summary ? 'summary' : 'fresh').inc();
  return {
    usage: { ...plan.usage, compacted: Boolean(summary) },
    contextMessages: plan.contextMessages,
    summary,
  };
};

const startStream = async (
  ws: AssistantWebSocket,
  requestId: string,
  mode: AssistantMode,
  variant: AssistantVariant,
  chatId: string | undefined,
  messageId: number | undefined,
  prompt: string | undefined,
  userUuid: string,
) => {
  const streams = activeStreams.get(ws);
  if (!streams) return;

  const notificationLink = assistantChatLink(chatId);
  cancelStream(ws, requestId);
  if (streams.size >= MAX_CONCURRENT_STREAMS) {
    assistantStreamErrorsTotal.labels('too_many_active_streams').inc();
    send(ws, { type: 'error', requestId, error: 'Too many active streams' });
    notifyTaskUser(userUuid, notificationLink, 'never', false);
    return;
  }

  // Register the stream before any await so an early cancel is not lost while
  // preferences or context are being loaded.
  const abortController = new AbortController();
  const stream: ActiveStream = {
    cancelled: false,
    timers: new Set(),
    gaugeReleased: false,
    detached: false,
    onAbort: () => abortController.abort(),
  };
  // Tool rounds and permission waits continue after this function reaches the
  // scheduler. Keep it alive until one of those paths finishes explicitly.
  let resolveAsyncCompletion!: () => void;
  const asyncCompletion = new Promise<void>((resolve) => {
    resolveAsyncCompletion = resolve;
  });
  stream.onFinish = resolveAsyncCompletion;
  streams.set(requestId, stream);
  assistantActiveStreams.inc();
  assistantWebsocketEventsTotal.labels('stream', 'started').inc();

  let holdSucceeded = false;
  let reservedCredits = 0;
  /** Holds in flight must finish before settlement snapshots `reservedCredits`. */
  let pendingHolds = 0;
  const holdWaiters = new Set<() => void>();
  let settlementPromise: Promise<number> | undefined;
  let emittedText = '';
  let emittedTokenCount = 0;
  let round = 0;
  let roundTextStart = 0;
  let roundTokenStart = 0;
  let projectedCost = 0;
  let stopAfterRound = false;
  let textStopped = false;
  let rawBuffer = '';
  let completed = false;
  let failureNotified = false;
  let safetyNotice: SafetyNotice | undefined;
  let pendingToolId: string | null = null;
  let index = 0;
  let toolCursor = 0;
  const startedAt = Date.now();
  const thinkingStatuses = new Map<string, AssistantThinkingStatus>();
  const toolSignatures = new Map<string, string>();
  const toolResults = new Map<string, AssistantToolResult>();
  const permissionDecisions = new Map<string, AssistantToolPermissionDecision>();
  const pendingAudits: Promise<void>[] = [];
  const seenSafetyCategories = new Set<string>();
  const promptCategories = prompt ? detectSafetyCategories(prompt) : [];
  const promptCategorySet = new Set<string>(promptCategories);
  const allThinking: NonNullable<AssistantMessage['thinking']> = [];
  const allTools: AssistantToolCall[] = [];
  /**
   * Provider tool IDs can repeat across rounds. Bind each draft tool occurrence
   * to the round that created it so late results/decisions cannot be looked up
   * with a newer round number.
   */
  const toolKeys = new WeakMap<object, string>();
  const allUsage = { inputTokens: 0, outputTokens: 0 };
  const knownSerials = new Set<string>();
  const redactedPrompt = prompt ? redactPII(prompt) : undefined;
  let effectiveNotificationLevel: AssistantNotificationLevel =
    DEFAULT_ASSISTANT_PREFERENCES.notificationLevel;
  let effectivePermissionLevel: AssistantPermissionLevel = DEFAULT_ASSISTANT_PREFERENCES.permissionLevel;
  let allowedToolNames = new Set<string>();
  let context!: PreparedContext;
  let currentDraft!: AssistantModelDraft;
  let tokens: string[] = [];

  /** Completion notifications stay task-only; question prompts use the raw preference. */
  const taskNotificationLevel = () => notificationLevelFor(mode, effectiveNotificationLevel);

  const notifyFailure = () => {
    if (failureNotified) return;
    failureNotified = true;
    notifyTaskUser(userUuid, notificationLink, taskNotificationLevel(), false);
  };

  const streamError = (error: string, code: string) => {
    assistantStreamErrorsTotal.labels(code).inc();
    send(ws, { type: 'error', requestId, error });
  };

  const rejectInsufficientCredits = () => {
    streamError('insufficient credits', 'insufficient_credits');
    notifyFailure();
  };

  const SAFETY_NOTICE_PRIORITY: Record<NonNullable<SafetyNotice>, number> = {
    refusal: 1,
    crisis: 2,
    csam: 3,
  };

  const reportSafety = (notice: NonNullable<SafetyNotice>) => {
    // Live text is validated in small chunks, so an early lower-priority card
    // can precede a higher-priority one found in the full draft. Send an
    // upgrade and keep the persisted notice in sync; never downgrade it.
    if (safetyNotice && SAFETY_NOTICE_PRIORITY[safetyNotice] >= SAFETY_NOTICE_PRIORITY[notice]) return;
    safetyNotice = notice;
    send(ws, { type: 'safety', requestId, notice });
  };

  const countAssistantSafety = (categories: readonly string[]) => {
    for (const category of new Set(categories)) {
      // Prompt categories were already counted as user events; counting them
      // again as assistant events inflated the safety metrics.
      if (promptCategorySet.has(category) || seenSafetyCategories.has(category)) continue;
      seenSafetyCategories.add(category);
      assistantSafetyEventsTotal.labels(category, 'assistant').inc();
    }
  };

  const waitForPendingHolds = () =>
    new Promise<void>((resolve) => {
      holdWaiters.add(resolve);
    });

  const beginHold = () => {
    pendingHolds += 1;
  };

  const finishHold = () => {
    pendingHolds = Math.max(0, pendingHolds - 1);
    if (pendingHolds > 0) return;
    for (const waiter of holdWaiters) waiter();
    holdWaiters.clear();
  };

  const settleCredits = (): Promise<number> => {
    if (settlementPromise) return settlementPromise;
    // A cancel can arrive before the first hold starts. Do not cache a no-op
    // here: a later hold must still be able to schedule settlement.
    if (!holdSucceeded && pendingHolds === 0) return Promise.resolve(0);
    settlementPromise = (async () => {
      while (pendingHolds > 0) await waitForPendingHolds();
      if (!holdSucceeded || reservedCredits <= 0) return 0;
      const pricingDate = new Date();
      const cost = Math.min(
        reservedCredits,
        estimateAssistantUsageCredits(
          context.usage.modelId,
          {
            inputTokens: allUsage.inputTokens || context.usage.usedTokens,
            outputTokens: allUsage.outputTokens || estimateTokens(emittedText),
          },
          pricingDate,
        ),
      );
      return settleCreditHold(userUuid, reservedCredits, cost, {
        referenceId: requestId,
        reason: 'assistant_stream',
      });
    })().catch((error: unknown) => {
      log.warn({ error, userUuid, requestId }, 'assistant credit settlement failed');
      return -1;
    });
    return settlementPromise;
  };
  // Install the fallback as soon as the stream is registered; before the
  // provider call it is a no-op, afterwards it releases any successful hold.
  stream.onSettle = settleCredits;

  const overallTimer = setTimeout(() => {
    if (stream.cancelled || completed || stream.detached) return;
    stream.onAbort?.();
    streamError('Assistant took too long to respond', 'timeout');
    stream.cancelled = true;
    detachStream(ws, requestId, stream);
    assistantStreamsTotal.labels(mode, variant, 'error').inc();
    void settleCredits();
    notifyFailure();
    resolveAsyncCompletion();
  }, streamTimeoutMs());
  stream.timers.add(overallTimer);

  const toolKeyFor = (tool: { id: string }) => toolKeys.get(tool) ?? `${round}:${tool.id}`;

  try {
    const state = await getAssistantState(userUuid);
    if (stream.cancelled) return;

    // Preferences are authoritative on the server. Client-supplied
    // permissionLevel/allowedTools/notificationLevel are deliberately ignored.
    const preferences = state?.preferences ?? DEFAULT_ASSISTANT_PREFERENCES;
    effectivePermissionLevel = isOneOf(ASSISTANT_PERMISSION_LEVELS, preferences.permissionLevel)
      ? preferences.permissionLevel
      : DEFAULT_ASSISTANT_PREFERENCES.permissionLevel;
    allowedToolNames = new Set(preferences.allowedTools.filter(isAssistantToolName));
    effectiveNotificationLevel = isOneOf(ASSISTANT_NOTIFICATION_LEVELS, preferences.notificationLevel)
      ? preferences.notificationLevel
      : DEFAULT_ASSISTANT_PREFERENCES.notificationLevel;

    for (const category of promptCategories) {
      assistantSafetyEventsTotal.labels(category, 'user').inc();
    }
    for (const category of promptCategories) seenSafetyCategories.add(category);

    const promptNotice = shouldShortCircuitPrompt(promptCategories)
      ? noticeForSafetyCategories(promptCategories)
      : undefined;
    if (promptNotice) {
      const content = safeContentForNotice(promptNotice);
      reportSafety(promptNotice);
      for (const token of splitAssistantResponseIntoTokens(content)) {
        if (stream.cancelled) return;
        send(ws, { type: 'token', requestId, token, index: emittedTokenCount });
        emittedTokenCount += 1;
      }
      if (chatId && messageId !== undefined) {
        await persistStreamResult({
          userUuid,
          chatId,
          messageId,
          prompt: redactedPrompt,
          mode,
          variant,
          content,
          safetyNotice: promptNotice,
          durationMs: Math.max(1, Date.now() - startedAt),
          creditCost: 0,
          notificationLevel: taskNotificationLevel(),
          link: notificationLink,
        });
      }
      send(ws, {
        type: 'done',
        requestId,
        durationMs: Math.max(1, Date.now() - startedAt),
        creditCost: 0,
      });
      if (stream.cancelled) return;
      assistantStreamsTotal.labels(mode, variant, 'success').inc();
      return;
    }

    context = await prepareContext(userUuid, chatId, variant, prompt, 'stream', state);
    if (stream.cancelled) return;
    send(ws, {
      type: 'context',
      requestId,
      usage: context.usage,
      ...(context.summary ? { summary: context.summary } : {}),
    });

    const modelId = context.usage.modelId;
    const pricingDate = new Date();
    const systemPromptTokens = estimateTokens(buildAssistantSystemPrompt());
    const toolSchemaTokens = estimateTokens(JSON.stringify(ASSISTANT_TOOL_DEFINITIONS));
    const estimateFor = (inputTokens: number, outputTokens: number) =>
      estimateAssistantUsageCredits(modelId, { inputTokens, outputTokens }, pricingDate);

    // Reserve enough credits for the first request before any model work happens.
    // Each continuation round reserves its own estimate before the provider call.
    reservedCredits = estimateFor(
      context.usage.usedTokens + systemPromptTokens + toolSchemaTokens,
      Math.min(getAssistantModel(modelId).maxOutputTokens, 4096),
    );
    const creditBalance = await getCreditBalanceFromUuid(userUuid);
    if (stream.cancelled) return;
    if (!creditBalance || creditBalance.available < reservedCredits) {
      rejectInsufficientCredits();
      return;
    }
    let hold: Awaited<ReturnType<typeof holdCredits>> | undefined;
    beginHold();
    try {
      hold = await holdCredits(userUuid, reservedCredits, undefined, {
        referenceId: requestId,
        reason: 'assistant_stream_reserve',
      });
      if (hold?.changed) holdSucceeded = true;
    } finally {
      finishHold();
    }
    // The settlement fallback is already installed; an early cancel during
    // these awaits waits for the hold and then settles it exactly once.
    if (stream.cancelled) {
      await settleCredits();
      return;
    }
    if (!hold?.changed) {
      rejectInsufficientCredits();
      return;
    }
    if (stream.cancelled) {
      await settleCredits();
      return;
    }

    /**
     * Reserves credits for a continuation round. The additional hold is included
     * in the final settlement and in the running-cost interruption check.
     */
    const holdMoreCredits = async (amount: number): Promise<boolean> => {
      if (stream.cancelled) return false;
      if (!Number.isFinite(amount) || amount <= 0) return true;
      const balance = await getCreditBalanceFromUuid(userUuid);
      if (stream.cancelled) return false;
      if (!balance || balance.available < amount) return false;
      let changed = false;
      beginHold();
      try {
        const additional = await holdCredits(userUuid, amount, undefined, {
          referenceId: requestId,
          reason: 'assistant_stream_continuation',
        });
        // Count the hold even when cancel arrived during the await, otherwise
        // settlement could snapshot a total that excludes it.
        if (additional?.changed) {
          reservedCredits += amount;
          changed = true;
        }
      } finally {
        finishHold();
      }
      return !stream.cancelled && changed;
    };

    /** Serials are numeric and can look like phone numbers to PII redaction. */
    const collectSerials = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(collectSerials);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, item] of Object.entries(value)) {
        if (
          (key === 'serial' || key === 'deviceSerial' || key === 'deviceId') &&
          (typeof item === 'number' || typeof item === 'string') &&
          /^\d{6,16}$/.test(String(item))
        ) {
          knownSerials.add(String(item));
        }
        collectSerials(item);
      }
    };

    /** Emits one already-validated token to the client in arrival order. */
    const emitLiveToken = (token: string) => {
      if (stream.cancelled || textStopped) return;
      const safeToken = scrubInternalDetails(token, requestId);
      if (!safeToken) return;
      const tokenIndex = emittedTokenCount;
      emittedText += safeToken;
      emittedTokenCount += 1;
      send(ws, { type: 'token', requestId, token: safeToken, index: tokenIndex });
    };

    /** Holds back the tail so PII patterns cannot span redaction boundaries. */
    const flushRawText = (final = false) => {
      const keep = final ? 0 : 48;
      if (rawBuffer.length <= keep) return;
      const cut = rawBuffer.length - keep;
      const chunk = rawBuffer.slice(0, cut);
      rawBuffer = rawBuffer.slice(cut);
      const safe = redactPII(chunk, [...knownSerials]);
      if (!safe) return;
      const assistantCategories = detectSafetyCategories(safe);
      const notice = noticeForSafetyCategories(assistantCategories);
      if (notice) {
        textStopped = true;
        countAssistantSafety(assistantCategories);
        emittedText = emittedText.slice(0, roundTextStart);
        emittedTokenCount = roundTokenStart;
        reportSafety(notice);
        return;
      }
      // Whitespace-only live chunks must be kept so words cannot join.
      for (const token of splitAssistantResponseIntoTokens(safe, { preserveWhitespaceOnly: true })) {
        emitLiveToken(token);
      }
    };

    const generateDraft = (options: {
      continuation?: AssistantModelDraft['continuation'];
      toolResults?: AssistantModelToolResult[];
      disableTools?: boolean;
    }): Promise<AssistantModelDraft> =>
      getAssistantModelAdapter().generate(
        {
          mode,
          variant,
          modelId,
          messages: context.contextMessages,
          usage: context.usage,
          signal: abortController.signal,
          ...options,
        },
        {
          onTextDelta: (delta) => {
            if (stream.cancelled || textStopped) return;
            rawBuffer += delta;
            flushRawText();
          },
        },
      );

    /**
     * Final safety pass on the assembled draft. Live text was already validated
     * and redacted while streaming, so this mainly protects tool-only rounds.
     * If it fires, roll the round's emitted tokens back to the round start so
     * the persisted content matches the safety card.
     */
    const applyDraftSafety = (draft: AssistantModelDraft): boolean => {
      const assistantCategories = detectSafetyCategories(draft.content);
      countAssistantSafety(assistantCategories);
      const notice = noticeForSafetyCategories(assistantCategories);
      if (notice) {
        reportSafety(notice);
        draft.content = '';
        draft.thinking = [];
        draft.tools = [];
        draft.continuation = undefined;
        emittedText = emittedText.slice(0, roundTextStart);
        emittedTokenCount = roundTokenStart;
        textStopped = true;
        rawBuffer = '';
      }
      draft.content = redactPII(draft.content, [...knownSerials]);
      return Boolean(notice);
    };

    try {
      currentDraft = withToolPreviews(await generateDraft({}), [...knownSerials]);
    } catch (error) {
      if (stream.cancelled) return;
      log.warn({ error, userUuid, chatId, variant }, 'assistant model request failed');
      streamError(
        error instanceof Error && error.message.includes('GEMINI_API_KEY')
          ? error.message
          : 'Model request failed',
        'model_request',
      );
      notifyFailure();
      return;
    }
    if (stream.cancelled) return;

    flushRawText(true);
    stopAfterRound = applyDraftSafety(currentDraft);

    // Text was emitted live from provider deltas. Keep the scheduler's token
    // list empty so it advances straight to tool execution and completion.
    tokens = [];

    /** Accumulates a round's output and its projected cost for credit tracking. */
    const addDraftToTotals = (draft: AssistantModelDraft, draftRound = round) => {
      for (const tool of draft.tools) toolKeys.set(tool, `${draftRound}:${tool.id}`);
      allThinking.push(...draft.thinking);
      allTools.push(...draft.tools);
      const usage = draft.usage ?? {
        inputTokens:
          context.usage.usedTokens +
          systemPromptTokens +
          toolSchemaTokens +
          estimateTokens(JSON.stringify(draft.continuation?.steps ?? [])) +
          estimateTokens(emittedText),
        outputTokens: estimateTokens(
          `${draft.content}\n${draft.tools.map((tool) => JSON.stringify(tool.input ?? {})).join('\n')}`,
        ),
      };
      allUsage.inputTokens += usage.inputTokens;
      allUsage.outputTokens += usage.outputTokens;
      projectedCost += estimateFor(usage.inputTokens, usage.outputTokens);
    };
    addDraftToTotals(currentDraft);

    // A provider can report more usage than the preflight estimate. Reserve the
    // difference before streaming so the running-cost guard stays meaningful.
    if (projectedCost > reservedCredits && !(await holdMoreCredits(projectedCost - reservedCredits))) {
      if (!stream.cancelled) rejectInsufficientCredits();
      return;
    }
    if (stream.cancelled) return;

    const needsPermission = (name: string) => {
      if (effectivePermissionLevel === 'never-ask') return false;
      if (allowedToolNames.has(name)) return false;
      if (effectivePermissionLevel === 'always-ask') return true;
      const definition =
        ASSISTANT_TOOL_DEFINITIONS[name as keyof typeof ASSISTANT_TOOL_DEFINITIONS];
      return Boolean(definition?.sensitive || definition?.interactive);
    };

    const stageIndexFor = (length: number) => {
      if (length === 0) return -1;
      if (tokens.length === 0) return 0;
      return Math.min(length - 1, Math.floor((index / tokens.length) * length));
    };

    const emitThinking = (forceDone = false) => {
      const active = stageIndexFor(currentDraft.thinking.length);
      currentDraft.thinking.forEach((base, stageIndex) => {
        const status: AssistantThinkingStatus = forceDone
          ? 'done'
          : stageIndex < active
            ? 'done'
            : stageIndex === active
              ? 'running'
              : 'pending';
        if (thinkingStatuses.get(base.id) === status) return;
        thinkingStatuses.set(base.id, status);
        send(ws, {
          type: 'thinking',
          requestId,
          step: {
            ...base,
            status,
            durationMs: status === 'done' ? base.durationMs : undefined,
          },
        });
      });
    };

    const emitTool = (
      tool: (typeof currentDraft.tools)[number],
      status: AssistantToolStatus,
      permission?: AssistantToolPermission,
      detail?: string,
      error?: string,
    ) => {
      const key = toolKeyFor(tool);
      const signature = `${status}|${permission ?? ''}|${detail ?? ''}|${error ?? ''}`;
      if (toolSignatures.get(key) === signature) return;
      toolSignatures.set(key, signature);
      send(ws, {
        type: 'tool',
        requestId,
        tool: {
          ...tool,
          status,
          detail,
          error,
          durationMs: status === 'done' ? tool.durationMs : undefined,
          permission,
        },
      });
    };

    /** Removes PII and internal IDs from JSON string values, preserving keys. */
    const scrubForProvider = (value: unknown, preserve: readonly string[]): unknown => {
      if (typeof value === 'string') {
        return scrubInternalDetails(redactPII(value, [...preserve]), requestId);
      }
      if (Array.isArray(value)) return value.map((item) => scrubForProvider(item, preserve));
      if (isRecord(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, scrubForProvider(item, preserve)]),
        );
      }
      return value;
    };

    const waitForToolResponse = (toolId: string, question: AssistantUserQuestion) =>
      new Promise<Record<string, string>>((resolve, reject) => {
        if (stream.cancelled) {
          reject(new Error('Stream cancelled'));
          return;
        }
        send(ws, { type: 'user_question', requestId, toolId, question });
        notifyUserQuestion(userUuid, notificationLink, effectiveNotificationLevel);

        const timer = setTimeout(() => {
          handlersFor(toolResponseHandlers, ws)?.delete(requestId);
          stream.onOrphaned = undefined;
          stream.timers.delete(timer);
          reject(new Error('No answer received'));
        }, USER_QUESTION_TIMEOUT_MS);
        stream.timers.add(timer);
        const clear = () => {
          clearTimeout(timer);
          stream.timers.delete(timer);
          handlersFor(toolResponseHandlers, ws)?.delete(requestId);
          stream.onOrphaned = undefined;
        };
        const handlers = handlersFor(toolResponseHandlers, ws, true)!;
        handlers.set(requestId, (answeredToolId, answers, customAnswer) => {
          if (answeredToolId !== toolId || stream.cancelled) return;
          clear();
          resolve({ ...answers, ...(customAnswer ? { custom: customAnswer } : {}) });
        });
        // The direct rejection does not depend on the handler map, so
        // cancellation can safely reject before the maps are deleted.
        stream.onOrphaned = () => {
          clear();
          reject(new Error('No answer received'));
        };
      });

    /** Writes a team audit entry at execution time with normalized input. */
    const auditToolMutation = async (
      base: (typeof currentDraft.tools)[number],
      result: AssistantToolResult,
      normalizedInput: Record<string, unknown>,
    ) => {
      if (!isAssistantMutationTool(base.name)) return;
      try {
        const user = await getUserFromUuid(userUuid);
        if (!user) return;
        const team = await getTeamForUser(user);
        if (!team) return;
        await logTeamAudit({
          teamId: team.id,
          actorUuid: user.uuid,
          actorUsername: user.username,
          action: `assistant.${base.name}`,
          details: {
            requestId,
            toolId: base.id,
            status: result.status,
            input: normalizedInput,
            summary: result.summary,
            preview: base.preview ?? describeAssistantToolChange(base.name, normalizedInput),
          },
        });
      } catch (error) {
        log.warn({ error, userUuid, name: base.name }, 'failed to record assistant tool audit');
      }
    };

    const recordToolResult = (
      base: (typeof currentDraft.tools)[number],
      result: AssistantToolResult,
      permission?: AssistantToolPermission,
      options: { audit?: boolean } = {},
    ) => {
      if (stream.cancelled) return;
      collectSerials(base.input);
      collectSerials(result.data);
      if (options.audit !== false && isAssistantMutationTool(base.name)) {
        let normalizedInput: Record<string, unknown> = {};
        try {
          normalizedInput = normalizeAssistantToolInput(base.name, base.input ?? {}) as unknown as Record<string, unknown>;
        } catch (error) {
          log.warn({ error, name: base.name }, 'invalid mutation input omitted from audit');
        }
        pendingAudits.push(auditToolMutation(base, result, normalizedInput));
      }
      toolResults.set(toolKeyFor(base), result);
      send(ws, { type: 'tool_result', requestId, toolId: base.id, result });
      emitTool(
        base,
        result.status === 'ok' ? 'done' : 'error',
        permission,
        result.summary,
        result.error,
      );
    };

    const runTool = (
      base: (typeof currentDraft.tools)[number],
      permission?: AssistantToolPermission,
    ) => {
      void executeAssistantTool(base.name, {
        userUuid,
        chatId,
        requestId,
        toolId: base.id,
        input: base.input ?? {},
        askUser: (question) => waitForToolResponse(base.id, question),
      })
        .then((result) => recordToolResult(base, result, permission))
        .catch((error: unknown) => {
          recordToolResult(base, {
            toolId: base.id,
            name: base.name,
            status: 'error',
            summary: 'The tool failed.',
            error: error instanceof Error ? error.message : 'Unknown error',
          }, permission);
        })
        .finally(() => {
          if (stream.cancelled) return;
          pendingToolId = null;
          toolCursor += 1;
          if (tokens.length === 0 && toolCursor < currentDraft.tools.length) {
            emitTools();
          } else {
            emitToken();
          }
        });
    };

    const denyTool = (
      base: (typeof currentDraft.tools)[number],
      permission: AssistantToolPermission,
    ) => {
      emitTool(base, 'denied', permission, 'Denied by you');
      recordToolResult(base, {
        toolId: base.id,
        name: base.name,
        status: 'error',
        summary: 'You denied this tool.',
        error: 'Denied by you',
      }, permission, { audit: false });
    };

    const handlePermissionDecision = (
      base: (typeof currentDraft.tools)[number],
      decision: AssistantToolPermissionDecision,
    ) => {
      if (stream.cancelled || pendingToolId !== base.id) return;
      pendingToolId = null;
      permissionDecisions.set(toolKeyFor(base), decision);
      if (decision === 'deny') {
        denyTool(base, 'denied');
        toolCursor += 1;
        if (tokens.length === 0 && toolCursor < currentDraft.tools.length) {
          emitTools();
        } else {
          emitToken();
        }
        return;
      }
      const permission = decision === 'allow_always' ? 'allowed_always' : 'allowed_once';
      const label = decision === 'allow_always' ? 'Allowed always' : 'Allowed once';
      emitTool(base, 'running', permission, label);
      pendingToolId = base.id;
      runTool(base, permission);
    };

    const waitForPermission = (
      base: (typeof currentDraft.tools)[number],
    ): Promise<AssistantToolPermissionDecision> =>
      new Promise((resolve, reject) => {
        if (stream.cancelled) {
          reject(new Error('Stream cancelled'));
          return;
        }
        const timer = setTimeout(() => {
          handlersFor(toolPermissionHandlers, ws)?.delete(requestId);
          stream.onOrphaned = undefined;
          stream.timers.delete(timer);
          reject(new Error('Permission request timed out'));
        }, USER_QUESTION_TIMEOUT_MS);
        stream.timers.add(timer);
        const clear = () => {
          clearTimeout(timer);
          stream.timers.delete(timer);
          handlersFor(toolPermissionHandlers, ws)?.delete(requestId);
          stream.onOrphaned = undefined;
        };
        const handlers = handlersFor(toolPermissionHandlers, ws, true)!;
        handlers.set(requestId, (toolId, decision) => {
          if (toolId !== base.id || stream.cancelled) return;
          clear();
          resolve(decision);
        });
        stream.onOrphaned = () => {
          clear();
          reject(new Error('Permission request orphaned'));
        };
      });

    const emitTools = (forceDone = false) => {
      const active =
        tokens.length === 0
          ? Math.min(toolCursor, currentDraft.tools.length - 1)
          : stageIndexFor(currentDraft.tools.length);
      currentDraft.tools.forEach((base, stageIndex) => {
        if (pendingToolId !== null && base.id !== pendingToolId) return;

        if (forceDone) {
          const decision = permissionDecisions.get(toolKeyFor(base));
          const result = toolResults.get(toolKeyFor(base));
          if (decision === 'deny') {
            emitTool(base, 'denied', 'denied', 'Denied by you');
            return;
          }
          if (result) {
            emitTool(
              base,
              result.status === 'ok' ? 'done' : 'error',
              decision === 'allow_always'
                ? 'allowed_always'
                : decision === 'allow_once'
                  ? 'allowed_once'
                  : undefined,
              result.summary,
              result.error,
            );
            return;
          }
          // A tool that never ran must not be reported as completed.
          emitTool(base, decision ? 'running' : 'pending', undefined, 'Not run');
          return;
        }

        if (stageIndex < active) {
          const decision = permissionDecisions.get(toolKeyFor(base));
          const result = toolResults.get(toolKeyFor(base));
          const permission = decision
            ? decision === 'allow_always'
              ? 'allowed_always'
              : decision === 'allow_once'
                ? 'allowed_once'
                : 'denied'
            : undefined;
          emitTool(
            base,
            result ? (result.status === 'ok' ? 'done' : 'error') : decision === 'deny' ? 'denied' : 'done',
            permission,
            result?.summary,
            result?.error,
          );
          return;
        }

        if (stageIndex !== active || pendingToolId !== null) return;

        if (needsPermission(base.name) && !permissionDecisions.has(toolKeyFor(base))) {
          emitTool(base, 'awaiting_permission', 'pending', 'Waiting for your approval');
          pendingToolId = base.id;
          void waitForPermission(base)
            .then((decision) => handlePermissionDecision(base, decision))
            .catch((error: unknown) => {
              if (completed || stream.cancelled) return;
              const orphaned =
                error instanceof Error && error.message.includes('orphaned');
              failStream(
                orphaned ? 'Tool approval was interrupted' : 'Permission request timed out',
                orphaned ? 'permission_interrupted' : 'permission_timeout',
              );
            });
          send(ws, {
            type: 'tool_permission_request',
            requestId,
            tool: {
              ...base,
              status: 'awaiting_permission',
              detail: 'Waiting for your approval',
              permission: 'pending',
            },
          });
          return;
        }

        const decision = permissionDecisions.get(toolKeyFor(base));
        const permission =
          decision === 'allow_always'
            ? 'allowed_always'
            : decision === 'allow_once'
              ? 'allowed_once'
              : undefined;
        emitTool(base, 'running', permission, 'Reading data');
        pendingToolId = base.id;
        runTool(base, permission);
      });
    };

    const failStream = (error: string, code = 'stream_failed') => {
      if (completed || stream.cancelled) return;
      stream.cancelled = true;
      detachStream(ws, requestId, stream);
      assistantStreamsTotal.labels(mode, variant, 'error').inc();
      void settleCredits().finally(() => {
        streamError(error, code);
        notifyFailure();
        resolveAsyncCompletion();
      });
    };

    const complete = async () => {
      if (completed || stream.cancelled) return;
      completed = true;

      emitThinking(true);
      emitTools(true);
      detachStream(ws, requestId, stream);

      const durationMs = Math.max(1, Date.now() - startedAt);
      let creditCost = 0;
      let settlementFailed = false;
      try {
        const settled = await settleCredits();
        settlementFailed = settled < 0;
        if (!settlementFailed) creditCost = settled;
      } catch (error) {
        log.warn({ error, userUuid, requestId }, 'unexpected assistant settlement error');
        settlementFailed = true;
      }
      try {
        await Promise.all(pendingAudits);
      } catch (error) {
        log.warn({ error, userUuid, requestId }, 'unexpected assistant audit error');
      }
      if (stream.cancelled) return;

      const finalTools: AssistantToolCall[] = allTools.map((base) => {
        const decision = permissionDecisions.get(toolKeyFor(base));
        const result = toolResults.get(toolKeyFor(base));
        const permission =
          decision === 'allow_always'
            ? ('allowed_always' as const)
            : decision === 'allow_once'
              ? ('allowed_once' as const)
              : decision === 'deny'
                ? ('denied' as const)
                : undefined;

        if (result) {
          return {
            ...base,
            status: result.status === 'ok' ? ('done' as const) : ('error' as const),
            ...(permission ? { permission } : {}),
            detail: result.summary,
            error: result.error,
            result,
          };
        }
        if (decision === 'deny') {
          return {
            ...base,
            status: 'denied' as const,
            permission: 'denied' as const,
            detail: 'Denied by you',
          };
        }
        // Never claim an unexecuted tool succeeded.
        return { ...base, status: 'pending' as const, detail: 'Not run' };
      });

      assistantStreamsTotal.labels(mode, variant, settlementFailed ? 'error' : 'success').inc();
      if (!settlementFailed) {
        assistantStreamDuration.labels(mode, variant).observe(durationMs / 1000);
        assistantStreamTokensTotal.labels(variant).inc(emittedTokenCount);
        for (let stepIndex = 0; stepIndex < allThinking.length; stepIndex += 1) {
          assistantThinkingStepsTotal.labels('done').inc();
        }
        for (const tool of finalTools) {
          assistantToolCallsTotal.labels(tool.name, tool.status).inc();
        }
      }

      if (chatId && messageId !== undefined) {
        await persistStreamResult({
          userUuid,
          chatId,
          messageId,
          prompt: redactedPrompt,
          mode,
          variant,
          content: emittedText,
          safetyNotice,
          thinking: allThinking.map((step) => ({ ...step, status: 'done' as const })),
          tools: finalTools,
          durationMs,
          creditCost,
          notificationLevel: taskNotificationLevel(),
          link: notificationLink,
        });
      }

      if (settlementFailed) {
        streamError('Failed to settle assistant credits', 'settlement');
        notifyFailure();
        resolveAsyncCompletion();
        return;
      }

      notifyTaskUser(userUuid, notificationLink, taskNotificationLevel(), true);
      send(ws, {
        type: 'done',
        requestId,
        durationMs,
        creditCost,
      });
      resolveAsyncCompletion();
    };

    /** Redacts a tool result before replaying it to the provider. */
    const redactToolContent = (base: (typeof currentDraft.tools)[number], result: AssistantToolResult) => {
      let content: string;
      try {
        content = JSON.stringify(
          scrubForProvider(
            result.status === 'error'
              ? { error: result.error ?? result.summary }
              : result.data ?? { summary: result.summary },
            [...knownSerials],
          ),
        );
      } catch {
        content = scrubInternalDetails(redactPII(result.summary, [...knownSerials]), requestId);
      }
      return { toolId: base.id, name: base.name, content, isError: result.status === 'error' };
    };

    /** Starts a fresh model round with its own tool cursors. */
    function startRound(nextDraft: AssistantModelDraft, nextRound: number) {
      if (stream.cancelled) return;
      currentDraft = withToolPreviews(nextDraft, [...knownSerials]);
      round = nextRound;
      for (const tool of currentDraft.tools) toolKeys.set(tool, `${nextRound}:${tool.id}`);
      index = 0;
      toolCursor = 0;
      pendingToolId = null;
      // The next round's text was streamed live while the draft was generated.
      tokens = [];

      emitThinking();
      emitTools();
      if (pendingToolId === null) emitToken();
    }

    /** Feeds this round's tool results back to the model, or finishes the stream. */
    async function finishRound() {
      if (completed || stream.cancelled) return;

      emitThinking(true);

      const roundToolResults: AssistantModelToolResult[] = currentDraft.tools.flatMap((base) => {
        const result = toolResults.get(toolKeyFor(base));
        if (!result) return [];
        return [redactToolContent(base, result)];
      });

      const limit = maxToolRounds(mode);
      const canContinue =
        !stopAfterRound &&
        currentDraft.tools.length > 0 &&
        roundToolResults.length > 0 &&
        round + 1 < limit;

      if (!canContinue) {
        void complete();
        return;
      }

      const nextRound = round + 1;
      const nextInputTokens =
        context.usage.usedTokens +
        systemPromptTokens +
        toolSchemaTokens +
        estimateTokens(emittedText) +
        estimateTokens(roundToolResults.map((result) => result.content).join('\n')) +
        estimateTokens(JSON.stringify(currentDraft.continuation?.steps ?? []));
      const nextCost = estimateFor(
        nextInputTokens,
        Math.min(getAssistantModel(modelId).maxOutputTokens, 4096),
      );
      if (!(await holdMoreCredits(nextCost))) {
        if (!stream.cancelled) failStream('insufficient credits');
        return;
      }
      if (stream.cancelled) return;

      // Text for the next round streams live during generateDraft, so prepare the
      // round boundary and safety state before the provider request starts.
      if (emittedText && !emittedText.endsWith('\n') && !textStopped) {
        emittedText += '\n\n';
        emittedTokenCount += 1;
        send(ws, { type: 'token', requestId, token: '\n\n', index: emittedTokenCount - 1 });
      }
      roundTextStart = emittedText.length;
      roundTokenStart = emittedTokenCount;
      textStopped = Boolean(stopAfterRound);
      rawBuffer = '';

      let nextDraft: AssistantModelDraft;
      try {
        nextDraft = await generateDraft({
          continuation: currentDraft.continuation,
          toolResults: roundToolResults,
          // On the last allowed round, force the model to answer with what it has.
          disableTools: nextRound + 1 >= limit,
        });
      } catch (error) {
        if (stream.cancelled) return;
        log.warn({ error, userUuid, chatId, variant, round: nextRound }, 'assistant continuation failed');
        // Earlier rounds already streamed content; keep that answer instead of
        // leaving the client waiting for a response that will never arrive.
        void complete();
        return;
      }
      if (stream.cancelled) return;

      flushRawText(true);
      if (applyDraftSafety(nextDraft)) stopAfterRound = true;

      addDraftToTotals(nextDraft, nextRound);
      if (projectedCost > reservedCredits && !(await holdMoreCredits(projectedCost - reservedCredits))) {
        if (!stream.cancelled) failStream('insufficient credits');
        return;
      }
      if (stream.cancelled) return;
      startRound(nextDraft, nextRound);
    }

    /** Text is streamed live; this only advances to tools or round completion. */
    const emitToken = () => {
      if (stream.cancelled) return;
      if (projectedCost > reservedCredits) {
        failStream('insufficient credits');
        return;
      }

      if (currentDraft.tools.length > 0 && toolCursor < currentDraft.tools.length) {
        emitTools();
        return;
      }
      void finishRound();
    };

    if (chatId) {
      void persistStreamResult({
        userUuid,
        chatId,
        messageId: messageId ?? 2,
        prompt: redactedPrompt,
        safetyNotice,
        mode,
        variant,
        notificationLevel: taskNotificationLevel(),
        link: notificationLink,
      });
    }

    emitThinking();
    emitTools();

    if (pendingToolId === null) {
      emitToken();
    }
    await asyncCompletion;
  } catch (error) {
    if (stream.cancelled) return;
    log.warn({ error, userUuid, requestId, chatId }, 'assistant stream preflight failed');
    streamError('Assistant request failed', 'preflight');
    notifyFailure();
  } finally {
    if (holdSucceeded || pendingHolds > 0) {
      await settleCredits().catch((error: unknown) => {
        log.warn({ error, userUuid, requestId }, 'failed to release assistant credit hold');
      });
    }
    detachStream(ws, requestId, stream);
  }
};

const isClientMessage = (value: unknown): value is AssistantStreamClientMessage => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;

  if (message.type === 'auth') {
    return typeof message.token === 'string' && message.token.length <= 512;
  }

  const hasValidRequestId =
    typeof message.requestId === 'string' &&
    Boolean(message.requestId) &&
    message.requestId.length <= 200;
  if (!hasValidRequestId) return false;
  if (
    message.chatId !== undefined &&
    (typeof message.chatId !== 'string' || !message.chatId || message.chatId.length > 200)
  ) {
    return false;
  }
  if (
    message.messageId !== undefined &&
    (typeof message.messageId !== 'number' ||
      !Number.isInteger(message.messageId) ||
      message.messageId < 1 ||
      message.messageId > 1_000_000)
  ) {
    return false;
  }
  if (message.prompt !== undefined && (typeof message.prompt !== 'string' || message.prompt.length > 4000)) {
    return false;
  }

  if (message.type === 'cancel') return true;
  if (message.type === 'compact') {
    return typeof message.chatId === 'string' && isVariant(message.variant);
  }
  if (message.type === 'tool_permission') {
    return (
      typeof message.toolId === 'string' &&
      Boolean(message.toolId) &&
      message.toolId.length <= 200 &&
      isOneOf(ASSISTANT_TOOL_PERMISSION_DECISIONS, message.decision)
    );
  }
  if (message.type === 'tool_response') {
    if (
      typeof message.toolId !== 'string' ||
      !message.toolId ||
      message.toolId.length > 200 ||
      !isRecord(message.answers)
    ) {
      return false;
    }
    const answers = Object.values(message.answers);
    if (answers.length > 20 || !answers.every((answer) => typeof answer === 'string' && answer.length <= 500)) {
      return false;
    }
    return message.customAnswer === undefined || (
      typeof message.customAnswer === 'string' && message.customAnswer.length <= 500
    );
  }
  if (message.type !== 'stream') return false;
  if (message.mode !== undefined && !isMode(message.mode)) return false;
  if (message.variant !== undefined && !isVariant(message.variant)) return false;
  if (
    message.permissionLevel !== undefined &&
    !isOneOf(ASSISTANT_PERMISSION_LEVELS, message.permissionLevel)
  ) {
    return false;
  }
  if (
    message.notificationLevel !== undefined &&
    !isOneOf(ASSISTANT_NOTIFICATION_LEVELS, message.notificationLevel)
  ) {
    return false;
  }
  if (
    message.allowedTools !== undefined &&
    (!Array.isArray(message.allowedTools) ||
      message.allowedTools.length > 100 ||
      !message.allowedTools.every(
        (tool) => typeof tool === 'string' && Boolean(tool) && tool.length <= 200,
      ))
  ) {
    return false;
  }
  return true;
};

const handleMessage = async (ws: AssistantWebSocket, raw: string | Buffer<ArrayBuffer>) => {
  const text = typeof raw === 'string' ? raw : raw.toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (!isClientMessage(parsed)) return;

  if (parsed.type === 'auth') {
    if (ws.data.userUuid) return;
    const timer = authTimers.get(ws);
    if (timer) clearTimeout(timer);
    authTimers.delete(ws);

    let user;
    try {
      user = await getUserFromToken(parsed.token);
    } catch {
      user = null;
    }
    if (!user) {
      rejectUnauthenticated(ws, 'Unauthorized');
      return;
    }
    ws.data.userUuid = user.uuid;
    return;
  }

  if (!ws.data.userUuid) {
    rejectUnauthenticated(ws, 'Authentication required');
    return;
  }

  if (parsed.type === 'compact') {
    const context = await prepareContext(
      ws.data.userUuid,
      parsed.chatId,
      parsed.variant,
      undefined,
      'manual',
    );
    send(ws, {
      type: 'context',
      requestId: parsed.requestId,
      usage: context.usage,
      ...(context.summary ? { summary: context.summary } : {}),
    });
    return;
  }

  if (parsed.type === 'stream') {
    // permissionLevel, allowedTools and notificationLevel are intentionally
    // not forwarded: they come from server-side assistant preferences.
    await startStream(
      ws,
      parsed.requestId,
      parsed.mode ?? 'chat',
      parsed.variant ?? 'standard',
      parsed.chatId,
      parsed.messageId,
      parsed.prompt,
      ws.data.userUuid,
    );
    return;
  }

  if (parsed.type === 'tool_permission') {
    handlersFor(toolPermissionHandlers, ws)?.get(parsed.requestId)?.(parsed.toolId, parsed.decision);
    return;
  }

  if (parsed.type === 'tool_response') {
    handlersFor(toolResponseHandlers, ws)?.get(parsed.requestId)?.(
      parsed.toolId,
      parsed.answers,
      parsed.customAnswer,
    );
    return;
  }

  cancelStream(ws, parsed.requestId);
};

export const assistantWebSocket: WebSocketHandler<AssistantSocketData> = {
  data: undefined as AssistantSocketData | undefined,

  open(ws) {
    activeStreams.set(ws, new Map());
    authTimers.set(
      ws,
      setTimeout(() => rejectUnauthenticated(ws, 'Authentication timed out'), AUTH_TIMEOUT_MS),
    );
  },

  message(ws, raw) {
    // Interactive replies bypass the queue: stream requests now stay alive
    // until completion, so queued approvals/answers/cancels would deadlock.
    if (ws.data.userUuid) {
      try {
        const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        if (
          isRecord(parsed) &&
          (parsed.type === 'cancel' ||
            parsed.type === 'tool_permission' ||
            parsed.type === 'tool_response')
        ) {
          void handleMessage(ws, raw).catch(() => {});
          return;
        }
      } catch {
        // Malformed frames fall through to normal validation.
      }
    }

    // Auth resolution is async, so serialize each socket's messages to keep
    // stream requests from running before auth has completed.
    const previous = messageQueues.get(ws) ?? Promise.resolve();
    const next = previous.then(() => handleMessage(ws, raw));
    messageQueues.set(ws, next);
    void next.then(
      () => {
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
      () => {
        if (messageQueues.get(ws) === next) messageQueues.delete(ws);
      },
    );
  },

  close(ws) {
    const timer = authTimers.get(ws);
    if (timer) clearTimeout(timer);
    authTimers.delete(ws);
    messageQueues.delete(ws);

    const streams = activeStreams.get(ws);
    if (streams) {
      for (const [requestId, stream] of [...streams.entries()]) {
        // The provider keeps working after the socket closes; only the live
        // feed and interactive waits are detached. Completion still settles.
        detachStream(ws, requestId, stream, { clearTimers: false });
      }
      activeStreams.delete(ws);
    }
    toolPermissionHandlers.delete(ws);
    toolResponseHandlers.delete(ws);
  },
};
