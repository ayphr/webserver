import type { ServerWebSocket, WebSocketHandler } from 'bun';
import {
  ASSISTANT_CONTEXT_SUMMARY_TOKEN_BUDGET,
  ASSISTANT_MODES,
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_TOOL_DEFINITIONS,
  ASSISTANT_TOOL_PERMISSION_DECISIONS,
  ASSISTANT_VARIANTS,
  estimateAssistantUsageCredits,
  estimateTokens,
  getAssistantModel,
  planAssistantContext,
  toContextMessages,
  type AssistantContextMessage,
  type AssistantContextUsage,
  type AssistantMessage,
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
import { detectSafetyCategories, redactPII } from '@common';
import { getAssistantState, saveStreamResult, updateAssistantChatContext } from '../lib/db/assistant';
import { createLogger } from '../lib/logger';
import {
  assistantActiveStreams,
  assistantMessagesTotal,
  assistantStreamDuration,
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
  consumeCredits,
  getCreditBalanceFromUuid,
  holdCredits,
  releaseCredits,
} from '../lib/credits';

const log = createLogger('assistant-websocket');

export type AssistantSocketData = { userUuid: string | null };
type AssistantWebSocket = ServerWebSocket<AssistantSocketData>;
type Timer = ReturnType<typeof setTimeout>;

type ActiveStream = {
  cancelled: boolean;
  timers: Set<Timer>;
  /** Serializes the initial prompt write ahead of the final response write. */
  persistStart?: Promise<void>;
  orphaned?: boolean;
  onOrphaned?: () => void;
  /** Aborts the in-flight provider request so streaming stops immediately. */
  onAbort?: () => void;
  /** Releases any credit hold and charges the credits actually used. */
  onSettle?: () => Promise<number>;
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

const MAX_CONCURRENT_STREAMS = 8;
const AUTH_TIMEOUT_MS = 10_000;
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

const activeStreams = new Map<AssistantWebSocket, ActiveStreams>();
const authTimers = new Map<AssistantWebSocket, Timer>();
const messageQueues = new Map<AssistantWebSocket, Promise<void>>();
const toolPermissionHandlers = new Map<string, ToolPermissionHandler>();
const toolResponseHandlers = new Map<string, ToolResponseHandler>();

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
  safetyNotice?: 'refusal' | 'crisis' | 'csam';
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

const cancelStream = (ws: AssistantWebSocket, requestId: string) => {
  const streams = activeStreams.get(ws);
  const stream = streams?.get(requestId);
  if (!stream || !streams) return;

  stream.cancelled = true;
  stream.onAbort?.();
  assistantActiveStreams.dec();
  assistantWebsocketEventsTotal.labels('cancel', 'ok').inc();
  if (stream.onSettle) {
    void stream.onSettle().catch((error: unknown) => {
      log.warn({ error, requestId }, 'failed to settle assistant credits after cancel');
    });
  }
  clearTimers(stream.timers);
  streams.delete(requestId);
  toolPermissionHandlers.delete(requestId);
  toolResponseHandlers.delete(requestId);
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
): Promise<PreparedContext> => {
  const state = chatId ? await getAssistantState(userUuid) : null;
  const chat = state?.chats.find((item) => item.id === chatId);
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
  permissionLevel: AssistantPermissionLevel,
  allowedTools: string[],
  notificationLevel: AssistantNotificationLevel,
  chatId: string | undefined,
  messageId: number | undefined,
  prompt: string | undefined,
  userUuid: string,
) => {
  const streams = activeStreams.get(ws);
  if (!streams) return;

  const notificationLink = assistantChatLink(chatId);
  const effectiveNotificationLevel = notificationLevelFor(mode, notificationLevel);
  cancelStream(ws, requestId);
  if (streams.size >= MAX_CONCURRENT_STREAMS) {
    send(ws, { type: 'error', requestId, error: 'Too many active streams' });
    notifyTaskUser(userUuid, notificationLink, effectiveNotificationLevel, false);
    return;
  }

  const context = await prepareContext(userUuid, chatId, variant, prompt, 'stream');
  send(ws, {
    type: 'context',
    requestId,
    usage: context.usage,
    ...(context.summary ? { summary: context.summary } : {}),
  });

  const modelId = context.usage.modelId;
  const systemPromptTokens = estimateTokens(buildAssistantSystemPrompt());
  const rejectInsufficientCredits = () => {
    send(ws, { type: 'error', requestId, error: 'insufficient credits' });
    notifyTaskUser(userUuid, notificationLink, effectiveNotificationLevel, false);
  };

  // Reserve enough credits for the first request before any model work happens.
  // Each continuation round reserves its own estimate before the provider call.
  let reservedCredits = estimateAssistantUsageCredits(modelId, {
    inputTokens: context.usage.usedTokens + systemPromptTokens,
    outputTokens: Math.min(getAssistantModel(modelId).maxOutputTokens, 4096),
  });
  const creditBalance = await getCreditBalanceFromUuid(userUuid);
  if (!creditBalance || creditBalance.available < reservedCredits) {
    rejectInsufficientCredits();
    return;
  }
  const hold = await holdCredits(userUuid, reservedCredits);
  if (!hold?.changed) {
    rejectInsufficientCredits();
    return;
  }

  /**
   * Reserves credits for a continuation round. The additional hold is included
   * in the final settlement and in the running-cost interruption check.
   */
  const holdMoreCredits = async (amount: number): Promise<boolean> => {
    if (!Number.isFinite(amount) || amount <= 0) return true;
    const balance = await getCreditBalanceFromUuid(userUuid);
    if (!balance || balance.available < amount) return false;
    const additional = await holdCredits(userUuid, amount);
    if (!additional?.changed) return false;
    reservedCredits += amount;
    return true;
  };

  const estimateRoundCredits = (inputTokens: number, outputTokens: number) =>
    estimateAssistantUsageCredits(modelId, { inputTokens, outputTokens });

  const promptCategories = prompt ? detectSafetyCategories(prompt) : [];
  if (prompt) {
    for (const category of promptCategories) {
      assistantSafetyEventsTotal.labels(category, 'user').inc();
    }
  }
  const redactedPrompt = prompt ? redactPII(prompt) : undefined;
  let safetyNotice: 'refusal' | 'crisis' | 'csam' | undefined;
  let safetyNoticeSent = false;

  const reportSafety = (notice: NonNullable<typeof safetyNotice>) => {
    safetyNotice = notice;
    if (safetyNoticeSent) return;
    safetyNoticeSent = true;
    send(ws, { type: 'safety', requestId, notice });
  };

  const noticeForCategories = (categories: readonly string[]): NonNullable<typeof safetyNotice> | undefined => {
    const isSuicidal = categories.includes('suicidal');
    // Suicidal intent should not be misclassified as ordinary violence.
    const highRisk = categories.filter(
      (category) => category !== 'suicidal' && !(isSuicidal && category === 'violence'),
    );
    if (highRisk.includes('csam') || highRisk.includes('child_abuse')) return 'csam';
    if (highRisk.length > 0) return 'refusal';
    if (isSuicidal) return 'crisis';
    return undefined;
  };

  // Device serials are numeric and can look exactly like phone numbers. Keep
  // the ones returned by tools so redaction does not corrupt their values.
  const knownSerials = new Set<string>();
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

  const startedAt = Date.now();
  const thinkingStatuses = new Map<string, AssistantThinkingStatus>();
  const toolSignatures = new Map<string, string>();
  const toolResults = new Map<string, AssistantToolResult>();
  const permissionDecisions = new Map<string, AssistantToolPermissionDecision>();
  const allowedToolNames = new Set(allowedTools);

  let settledCredits = false;
  let emittedText = '';
  let emittedTokenCount = 0;
  let round = 0;
  let projectedCost = 0;
  let roundTextStart = 0;
  let stopAfterRound = false;
  let textStopped = false;
  let rawBuffer = '';
  const allThinking: NonNullable<AssistantMessage['thinking']> = [];
  const allTools: AssistantToolCall[] = [];
  const allUsage = { inputTokens: 0, outputTokens: 0 };

  const abortController = new AbortController();
  const stream: ActiveStream = {
    cancelled: false,
    timers: new Set(),
    onAbort: () => abortController.abort(),
  };
  streams.set(requestId, stream);
  assistantActiveStreams.inc();
  assistantWebsocketEventsTotal.labels('stream', 'started').inc();

  const promptNotice = noticeForCategories(promptCategories);
  if (promptNotice) {
    stopAfterRound = true;
    textStopped = true;
    reportSafety(promptNotice);
  }

  /** Emits one already-validated token to the client in arrival order. */
  const emitLiveToken = (token: string) => {
    if (stream.cancelled || textStopped) return;
    const tokenIndex = emittedTokenCount;
    emittedText += token;
    emittedTokenCount += 1;
    send(ws, { type: 'token', requestId, token, index: tokenIndex });
  };

  /** Holds back the tail of the stream so PII patterns cannot span redaction boundaries. */
  const flushRawText = (final = false) => {
    const keep = final ? 0 : 48;
    if (rawBuffer.length <= keep) return;
    const cut = rawBuffer.length - keep;
    const chunk = rawBuffer.slice(0, cut);
    rawBuffer = rawBuffer.slice(cut);
    const safe = redactPII(chunk, [...knownSerials]);
    if (!safe) return;
    const combined = [...new Set([...promptCategories, ...detectSafetyCategories(safe)])];
    const notice = noticeForCategories(combined);
    if (notice) {
      textStopped = true;
      emittedText = emittedText.slice(0, roundTextStart);
      for (const category of combined) assistantSafetyEventsTotal.labels(category, 'assistant').inc();
      reportSafety(notice);
      return;
    }
    for (const token of splitAssistantResponseIntoTokens(safe)) emitLiveToken(token);
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
   */
  const applyDraftSafety = (draft: AssistantModelDraft): boolean => {
    const assistantCategories = detectSafetyCategories(draft.content);
    for (const category of assistantCategories) {
      assistantSafetyEventsTotal.labels(category, 'assistant').inc();
    }

    const combinedCategories = [...new Set([...promptCategories, ...assistantCategories])];
    const notice = noticeForCategories(combinedCategories);

    if (notice) {
      reportSafety(notice);
      draft.content = '';
      draft.thinking = [];
      draft.tools = [];
      draft.continuation = undefined;
    }
    draft.content = redactPII(draft.content, [...knownSerials]);
    return Boolean(notice);
  };

  let currentDraft: AssistantModelDraft;
  try {
    currentDraft = await generateDraft({});
  } catch (error) {
    if (streams.get(requestId) === stream) streams.delete(requestId);
    assistantActiveStreams.dec();
    await releaseCredits(userUuid, reservedCredits).catch((releaseError: unknown) => {
      log.warn({ releaseError, userUuid }, 'failed to release assistant credit hold');
    });
    // Cancelling aborts the provider request; that rejection is expected.
    if (stream.cancelled) return;
    log.warn({ error, userUuid, chatId, variant }, 'assistant model request failed');
    send(ws, {
      type: 'error',
      requestId,
      error: error instanceof Error && error.message.includes('GEMINI_API_KEY')
        ? error.message
        : 'Model request failed',
    });
    notifyTaskUser(userUuid, notificationLink, effectiveNotificationLevel, false);
    return;
  }

  flushRawText(true);
  stopAfterRound = applyDraftSafety(currentDraft);

  // Text was emitted live from provider deltas. Keep the scheduler's token list
  // empty so it advances straight to tool execution and completion.
  let tokens: string[] = [];

  /** Accumulates a round's output and its projected cost for credit tracking. */
  const addDraftToTotals = (draft: AssistantModelDraft) => {
    allThinking.push(...draft.thinking);
    allTools.push(...draft.tools);
    const usage = draft.usage ?? {
      inputTokens: context.usage.usedTokens + estimateTokens(emittedText),
      outputTokens: estimateTokens(
        `${draft.content}\n${draft.tools.map((tool) => JSON.stringify(tool.input ?? {})).join('\n')}`,
      ),
    };
    allUsage.inputTokens += usage.inputTokens;
    allUsage.outputTokens += usage.outputTokens;
    projectedCost += estimateAssistantUsageCredits(modelId, usage);
  };
  addDraftToTotals(currentDraft);

  // A provider can report more usage than the preflight estimate. Reserve the
  // difference before streaming so the running-cost guard stays meaningful.
  if (projectedCost > reservedCredits && !(await holdMoreCredits(projectedCost - reservedCredits))) {
    if (streams.get(requestId) === stream) streams.delete(requestId);
    assistantActiveStreams.dec();
    await releaseCredits(userUuid, reservedCredits).catch((releaseError: unknown) => {
      log.warn({ releaseError, userUuid }, 'failed to release assistant credit hold');
    });
    rejectInsufficientCredits();
    return;
  }

  const settleCredits = async (): Promise<number> => {
    if (settledCredits) return 0;
    settledCredits = true;
    await releaseCredits(userUuid, reservedCredits).catch((error: unknown) => {
      log.warn({ error, userUuid }, 'failed to release assistant credit hold');
    });
    // The hold was sized to cover every round. Capping the final charge keeps
    // settlement from failing after a response has already been delivered if a
    // provider reports slightly more usage than the estimate.
    const cost = Math.min(
      reservedCredits,
      estimateAssistantUsageCredits(modelId, {
        inputTokens: allUsage.inputTokens || context.usage.usedTokens,
        outputTokens: allUsage.outputTokens || estimateTokens(emittedText),
      }),
    );
    const result = await consumeCredits(userUuid, cost);
    if (cost > 0 && !result?.changed) return -1;
    return cost;
  };
  stream.onSettle = settleCredits;

  let index = 0;
  let toolCursor = 0;
  let completed = false;
  let pendingToolId: string | null = null;

  const needsPermission = (name: string) => {
    if (permissionLevel === 'never-ask') return false;
    if (allowedToolNames.has(name)) return false;
    if (permissionLevel === 'always-ask') return true;
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
    const signature = `${status}|${permission ?? ''}|${detail ?? ''}|${error ?? ''}`;
    if (toolSignatures.get(tool.id) === signature) return;
    toolSignatures.set(tool.id, signature);
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

  const waitForToolResponse = (toolId: string, question: AssistantUserQuestion) =>
    new Promise<Record<string, string>>((resolve, reject) => {
      if (stream.cancelled) {
        reject(new Error('Stream cancelled'));
        return;
      }

      send(ws, { type: 'user_question', requestId, toolId, question });
      notifyUserQuestion(userUuid, notificationLink, notificationLevel);

      toolResponseHandlers.set(requestId, (answeredToolId, answers, customAnswer) => {
        if (answeredToolId !== toolId) return;
        toolResponseHandlers.delete(requestId);
        stream.onOrphaned = undefined;
        resolve({ ...answers, ...(customAnswer ? { custom: customAnswer } : {}) });
      });
      stream.onOrphaned = () => {
        toolResponseHandlers.delete(requestId);
        reject(new Error('No answer received'));
      };
    });

  const recordToolResult = (
    base: (typeof currentDraft.tools)[number],
    result: AssistantToolResult,
    permission?: AssistantToolPermission,
  ) => {
    if (stream.cancelled) return;
    collectSerials(base.input);
    collectSerials(result.data);
    toolResults.set(base.id, result);
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
    }, permission);
  };

  const emitTools = (forceDone = false) => {
    const active =
      tokens.length === 0
        ? Math.min(toolCursor, currentDraft.tools.length - 1)
        : stageIndexFor(currentDraft.tools.length);
    currentDraft.tools.forEach((base, stageIndex) => {
      if (pendingToolId !== null && base.id !== pendingToolId) return;

      if (forceDone) {
        const decision = permissionDecisions.get(base.id);
        const result = toolResults.get(base.id);
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
        if (decision) {
          const permission = decision === 'allow_always' ? 'allowed_always' : 'allowed_once';
          emitTool(base, 'done', permission);
          return;
        }
        emitTool(base, 'done');
        return;
      }

      if (stageIndex < active) {
        const decision = permissionDecisions.get(base.id);
        const result = toolResults.get(base.id);
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

      if (needsPermission(base.name) && !permissionDecisions.has(base.id)) {
        emitTool(base, 'awaiting_permission', 'pending', 'Waiting for your approval');
        pendingToolId = base.id;
        toolPermissionHandlers.set(requestId, (toolId, decision) => {
          if (toolId !== pendingToolId || stream.cancelled) return;
          pendingToolId = null;
          stream.onOrphaned = undefined;
          toolPermissionHandlers.delete(requestId);
          permissionDecisions.set(toolId, decision);

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
        });
        stream.onOrphaned = () => {
          toolPermissionHandlers.get(requestId)?.(base.id, 'deny');
        };
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

      const decision = permissionDecisions.get(base.id);
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

  const failStream = (error: string) => {
    if (completed || stream.cancelled) return;
    stream.cancelled = true;
    clearTimers(stream.timers);
    if (streams.get(requestId) === stream) streams.delete(requestId);
    toolPermissionHandlers.delete(requestId);
    toolResponseHandlers.delete(requestId);
    // Reject any in-flight interactive tool so its executor can unwind.
    stream.onOrphaned?.();
    stream.onOrphaned = undefined;
    assistantActiveStreams.dec();
    assistantStreamsTotal.labels(mode, variant, 'error').inc();
    void settleCredits().finally(() => {
      send(ws, { type: 'error', requestId, error });
      notifyTaskUser(userUuid, notificationLink, effectiveNotificationLevel, false);
    });
  };

  const complete = async () => {
    if (completed || stream.cancelled) return;
    completed = true;

    emitThinking(true);
    emitTools(true);
    clearTimers(stream.timers);
    if (streams.get(requestId) === stream) streams.delete(requestId);
    toolPermissionHandlers.delete(requestId);
    toolResponseHandlers.delete(requestId);

    const durationMs = Math.max(1, Date.now() - startedAt);
    assistantActiveStreams.dec();

    const creditCost = await settleCredits();
    if (creditCost < 0) {
      rejectInsufficientCredits();
      return;
    }

    const finalTools: AssistantToolCall[] = allTools.map((base) => {
      const decision = permissionDecisions.get(base.id);
      const result = toolResults.get(base.id);
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
      if (decision) {
        return {
          ...base,
          status: 'done' as const,
          permission,
        };
      }
      return { ...base, status: 'done' as const };
    });

    assistantStreamsTotal.labels(mode, variant, 'success').inc();
    assistantStreamDuration.labels(mode, variant).observe(durationMs / 1000);
    assistantStreamTokensTotal.labels(variant).inc(emittedTokenCount);
    for (let stepIndex = 0; stepIndex < allThinking.length; stepIndex += 1) {
      assistantThinkingStepsTotal.labels('done').inc();
    }
    for (const tool of finalTools) {
      assistantToolCallsTotal.labels(tool.name, tool.status).inc();
    }

    if (chatId && messageId !== undefined) {
      if (stream.persistStart) await stream.persistStart;
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
        notificationLevel: effectiveNotificationLevel,
        link: notificationLink,
      });
    }

    notifyTaskUser(userUuid, notificationLink, effectiveNotificationLevel, true);

    send(ws, {
      type: 'done',
      requestId,
      durationMs,
      creditCost,
    });
  };

  /** Starts a fresh model round with its own tool cursors. */
  function startRound(nextDraft: AssistantModelDraft, nextRound: number) {
    currentDraft = nextDraft;
    round = nextRound;
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

    // Close out this round's thinking before moving on; the next round starts
    // with a fresh set of steps and cursors.
    emitThinking(true);

    const roundToolResults: AssistantModelToolResult[] = currentDraft.tools.flatMap((base) => {
      const result = toolResults.get(base.id);
      if (!result) return [];
      let content: string;
      try {
        content = JSON.stringify(
          result.status === 'error'
            ? { error: result.error ?? result.summary }
            : result.data ?? { summary: result.summary },
        );
      } catch {
        content = result.summary;
      }
      return [
        {
          toolId: base.id,
          name: base.name,
          content,
          isError: result.status === 'error',
        },
      ];
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
      estimateTokens(emittedText) +
      estimateTokens(roundToolResults.map((result) => result.content).join('\n')) +
      systemPromptTokens;
    const nextCost = estimateRoundCredits(
      nextInputTokens,
      Math.min(getAssistantModel(modelId).maxOutputTokens, 4096),
    );
    if (!(await holdMoreCredits(nextCost))) {
      failStream('insufficient credits');
      return;
    }

    // Text for the next round streams live during generateDraft, so prepare the
    // round boundary and safety state before the provider request starts.
    if (emittedText && !emittedText.endsWith('\n') && !textStopped) {
      emittedText += '\n\n';
      emittedTokenCount += 1;
      send(ws, { type: 'token', requestId, token: '\n\n', index: emittedTokenCount - 1 });
    }
    roundTextStart = emittedText.length;
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
      log.warn({ error, userUuid, chatId, variant, round: nextRound }, 'assistant continuation failed');
      // Earlier rounds already streamed content; keep that answer instead of
      // leaving the client waiting for a response that will never arrive.
      void complete();
      return;
    }

    if (applyDraftSafety(nextDraft)) stopAfterRound = true;

    addDraftToTotals(nextDraft);
    if (projectedCost > reservedCredits && !(await holdMoreCredits(projectedCost - reservedCredits))) {
      failStream('insufficient credits');
      return;
    }
    startRound(nextDraft, nextRound);
  }

  /** Text is streamed live; this only advances to tools or round completion. */
  const emitToken = () => {
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
    stream.persistStart = persistStreamResult({
      userUuid,
      chatId,
      messageId: messageId ?? 2,
      prompt: redactedPrompt,
      safetyNotice,
      mode,
      variant,
      notificationLevel: effectiveNotificationLevel,
      link: notificationLink,
    });
  }

  emitThinking();
  emitTools();

  if (pendingToolId === null) {
    emitToken();
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
    await startStream(
      ws,
      parsed.requestId,
      parsed.mode ?? 'chat',
      parsed.variant ?? 'standard',
      parsed.permissionLevel ?? 'always-ask',
      parsed.allowedTools ?? [],
      parsed.notificationLevel ?? 'always',
      parsed.chatId,
      parsed.messageId,
      parsed.prompt,
      ws.data.userUuid,
    );
    return;
  }

  if (parsed.type === 'tool_permission') {
    toolPermissionHandlers.get(parsed.requestId)?.(parsed.toolId, parsed.decision);
    return;
  }

  if (parsed.type === 'tool_response') {
    toolResponseHandlers.get(parsed.requestId)?.(
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
    // Auth resolution is async, so serialize each socket's messages to keep
    // stream/cancel requests from running before auth has completed.
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
        // Every stream runs on the server. A closed socket only stops the live
        // feed; timers, persistence and notifications continue in the background.
        stream.orphaned = true;
        stream.onOrphaned?.();
        stream.onOrphaned = undefined;
        streams.delete(requestId);
      }
      activeStreams.delete(ws);
    }
  },
};
