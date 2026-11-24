import {
  ASSISTANT_NOTIFICATION_LEVELS,
  ASSISTANT_PERMISSION_LEVELS,
  ASSISTANT_STREAM_PATH,
  ASSISTANT_THINKING_STATUSES,
  ASSISTANT_TOOL_PERMISSIONS,
  ASSISTANT_TOOL_PERMISSION_DECISIONS,
  ASSISTANT_TOOL_STATUSES,
  ASSISTANT_VARIANTS,
  isAssistantModelId,
  type AssistantContextUsage,
  type AssistantMode,
  type AssistantToolResult,
  type AssistantUserQuestion,
  type AssistantNotificationLevel,
  type AssistantPermissionLevel,
  type AssistantStreamClientMessage,
  type AssistantStreamServerMessage,
  type AssistantThinkingStep,
  type AssistantThinkingStatus,
  type AssistantToolCall,
  type AssistantToolPermission,
  type AssistantToolPermissionDecision,
  type AssistantToolStatus,
  type AssistantVariant,
} from '@common';
import { API_BASE_URL, api } from './api';

/**
 * Token events can arrive duplicated or out of order. Hold them until the next
 * expected index is available so the rendered answer is assembled in order.
 */
export class OrderedTokenBuffer {
  private nextIndex = 0;
  private readonly pending = new Map<number, string>();

  /** Returns every token that is now safe to append, in stream order. */
  push(token: string, index?: number): string[] {
    const hasIndex = typeof index === 'number' && Number.isInteger(index) && index >= 0;
    const tokenIndex = hasIndex ? (index as number) : this.nextIndex;
    if (tokenIndex < this.nextIndex || this.pending.has(tokenIndex)) return [];

    this.pending.set(tokenIndex, token);
    const ready: string[] = [];
    while (this.pending.has(this.nextIndex)) {
      ready.push(this.pending.get(this.nextIndex) as string);
      this.pending.delete(this.nextIndex);
      this.nextIndex += 1;
    }
    return ready;
  }

  /** Releases any buffered tail in index order when the stream settles. */
  flush(): string[] {
    const indexes = [...this.pending.keys()].sort((a, b) => a - b);
    const ready = indexes.map((index) => this.pending.get(index) as string);
    this.pending.clear();
    if (indexes.length > 0) this.nextIndex = Math.max(this.nextIndex, (indexes.at(-1) as number) + 1);
    return ready;
  }

  reset() {
    this.nextIndex = 0;
    this.pending.clear();
  }

  get pendingCount() {
    return this.pending.size;
  }
}

export type AssistantStreamHandlers = {
  onToken: (requestId: string, token: string, index?: number) => void;
  onThinking?: (requestId: string, step: AssistantThinkingStep) => void;
  onTool?: (requestId: string, tool: AssistantToolCall) => void;
  onToolPermissionRequest?: (requestId: string, tool: AssistantToolCall) => void;
  onSafety?: (requestId: string, notice: 'refusal' | 'crisis' | 'csam') => void;
  onContext?: (requestId: string, usage: AssistantContextUsage, summary?: string) => void;
  onToolResult?: (requestId: string, toolId: string, result: AssistantToolResult) => void;
  onUserQuestion?: (requestId: string, toolId: string, question: AssistantUserQuestion) => void;
  onDone: (requestId: string, durationMs?: number, creditCost?: number) => void;
  onError?: (requestId: string, error: string) => void;
};

export type AssistantStreamOptions = {
  mode?: AssistantMode;
  variant?: AssistantVariant;
  permissionLevel?: AssistantPermissionLevel;
  allowedTools?: string[];
  chatId?: string;
  messageId?: number;
  prompt?: string;
  notificationLevel?: AssistantNotificationLevel;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isThinkingStatus = (value: unknown): value is AssistantThinkingStatus =>
  typeof value === 'string' && ASSISTANT_THINKING_STATUSES.includes(value as AssistantThinkingStatus);

const isToolStatus = (value: unknown): value is AssistantToolStatus =>
  typeof value === 'string' && ASSISTANT_TOOL_STATUSES.includes(value as AssistantToolStatus);

const isToolPermission = (value: unknown): value is AssistantToolPermission =>
  typeof value === 'string' && ASSISTANT_TOOL_PERMISSIONS.includes(value as AssistantToolPermission);

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

const isThinkingStep = (value: unknown): value is AssistantThinkingStep => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.label !== 'string') return false;
  if (!isThinkingStatus(value.status)) return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  return value.durationMs === undefined || (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs));
};

const isToolCall = (value: unknown): value is AssistantToolCall => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (!isToolStatus(value.status)) return false;
  if (value.label !== undefined && typeof value.label !== 'string') return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  if (value.permission !== undefined && !isToolPermission(value.permission)) return false;
  return value.durationMs === undefined || (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs));
};

const isContextUsage = (value: unknown): value is AssistantContextUsage => {
  if (!isRecord(value)) return false;
  const numbers = [
    'usedTokens',
    'budgetTokens',
    'contextWindowTokens',
    'maxOutputTokens',
    'ratio',
    'thresholdRatio',
    'messageCount',
    'includedMessageCount',
    'compactedMessageCount',
    'summaryTokens',
  ];
  if (!numbers.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    return false;
  }
  if (typeof value.variant !== 'string' || !ASSISTANT_VARIANTS.includes(value.variant as never)) {
    return false;
  }
  if (typeof value.modelId !== 'string' || !isAssistantModelId(value.modelId)) return false;
  if (typeof value.modelLabel !== 'string' || typeof value.compacted !== 'boolean') return false;
  return value.chatId === undefined || typeof value.chatId === 'string';
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

const isUserQuestion = (value: unknown): value is AssistantUserQuestion => {
  if (!isRecord(value) || typeof value.prompt !== 'string') return false;
  if (typeof value.customAnswerAllowed !== 'boolean' || !Array.isArray(value.steps)) return false;
  return value.steps.every((step) => {
    if (!isRecord(step) || typeof step.id !== 'string' || typeof step.prompt !== 'string') {
      return false;
    }
    if (!Array.isArray(step.suggestedAnswers)) return false;
    if (!step.suggestedAnswers.every((answer) => typeof answer === 'string')) return false;
    return step.recommendedAnswer === undefined || typeof step.recommendedAnswer === 'string';
  });
};

const isToolResult = (value: unknown): value is AssistantToolResult => {
  if (!isRecord(value)) return false;
  if (typeof value.toolId !== 'string' || typeof value.name !== 'string') return false;
  if (value.status !== 'ok' && value.status !== 'error') return false;
  if (typeof value.summary !== 'string') return false;
  if (value.error !== undefined && typeof value.error !== 'string') return false;
  if (value.answers !== undefined && !isStringRecord(value.answers)) return false;
  return value.question === undefined || isUserQuestion(value.question);
};

const isServerMessage = (value: unknown): value is AssistantStreamServerMessage => {
  if (!isRecord(value)) return false;
  if (value.type === 'auth_error') return typeof value.error === 'string';

  if (typeof value.requestId !== 'string') return false;
  if (value.type === 'thinking') return isThinkingStep(value.step);
  if (value.type === 'tool') return isToolCall(value.tool);
  if (value.type === 'tool_permission_request') return isToolCall(value.tool);
  if (value.type === 'token') {
    return (
      typeof value.token === 'string' &&
      (value.index === undefined || (typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0))
    );
  }
  if (value.type === 'done') {
    return (
      (value.durationMs === undefined ||
        (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs))) &&
      (value.creditCost === undefined ||
        (typeof value.creditCost === 'number' && Number.isFinite(value.creditCost)))
    );
  }
  if (value.type === 'safety') {
    return value.notice === 'refusal' || value.notice === 'crisis' || value.notice === 'csam';
  }
  if (value.type === 'context') {
    return (
      isContextUsage(value.usage) &&
      (value.summary === undefined || typeof value.summary === 'string')
    );
  }
  if (value.type === 'tool_result') {
    return typeof value.toolId === 'string' && isToolResult(value.result);
  }
  if (value.type === 'user_question') {
    return typeof value.toolId === 'string' && isUserQuestion(value.question);
  }
  return value.type === 'error' && typeof value.error === 'string';
};

export class AssistantStreamClient {
  private readonly url: string;
  private readonly handlers: AssistantStreamHandlers;
  private socket: WebSocket | null = null;
  private pending: AssistantStreamClientMessage[] = [];
  private readonly active = new Set<string>();

  constructor(handlers: AssistantStreamHandlers) {
    this.handlers = handlers;
    const base = API_BASE_URL.replace(/^http/, 'ws');
    this.url = `${base}${ASSISTANT_STREAM_PATH}`;
  }

  private connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: api.getAuthToken() ?? '' }));
      const queued = this.pending;
      this.pending = [];
      for (const message of queued) socket.send(JSON.stringify(message));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isServerMessage(parsed)) return;

      if (parsed.type === 'auth_error') {
        this.close();
        const requestIds = [...this.active];
        this.active.clear();
        for (const requestId of requestIds) {
          this.handlers.onError?.(requestId, parsed.error);
        }
        return;
      }

      if (parsed.type === 'context') {
        this.handlers.onContext?.(parsed.requestId, parsed.usage, parsed.summary);
        return;
      }
      if (parsed.type === 'tool_result') {
        this.handlers.onToolResult?.(parsed.requestId, parsed.toolId, parsed.result);
        return;
      }
      if (parsed.type === 'user_question') {
        this.handlers.onUserQuestion?.(parsed.requestId, parsed.toolId, parsed.question);
        return;
      }
      if (parsed.type === 'thinking') {
        this.handlers.onThinking?.(parsed.requestId, parsed.step);
        return;
      }
      if (parsed.type === 'tool') {
        this.handlers.onTool?.(parsed.requestId, parsed.tool);
        return;
      }
      if (parsed.type === 'tool_permission_request') {
        this.handlers.onToolPermissionRequest?.(parsed.requestId, parsed.tool);
        return;
      }
      if (parsed.type === 'token') {
        this.handlers.onToken(parsed.requestId, parsed.token, parsed.index);
        return;
      }

      this.active.delete(parsed.requestId);
      if (parsed.type === 'safety') this.handlers.onSafety?.(parsed.requestId, parsed.notice);
      if (parsed.type === 'done') this.handlers.onDone(parsed.requestId, parsed.durationMs, parsed.creditCost);
      else if (parsed.type === 'error') this.handlers.onError?.(parsed.requestId, parsed.error);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.pending = [];
      if (this.active.size === 0) return;
      const requestIds = [...this.active];
      this.active.clear();
      for (const requestId of requestIds) {
        this.handlers.onError?.(requestId, 'Stream disconnected');
      }
    };
  }

  private send(message: AssistantStreamClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pending.push(message);
    this.connect();
  }

  stream(requestId: string, options: AssistantStreamOptions = {}) {
    this.active.add(requestId);
    this.send({
      type: 'stream',
      requestId,
      mode: options.mode,
      variant: options.variant,
      permissionLevel: isOneOf(ASSISTANT_PERMISSION_LEVELS, options.permissionLevel)
        ? options.permissionLevel
        : undefined,
      allowedTools: Array.isArray(options.allowedTools)
        ? options.allowedTools.filter((tool): tool is string => typeof tool === 'string')
        : undefined,
      chatId: options.chatId || undefined,
      messageId:
        typeof options.messageId === 'number' && Number.isInteger(options.messageId)
          ? options.messageId
          : undefined,
      prompt: options.prompt || undefined,
      notificationLevel: isOneOf(ASSISTANT_NOTIFICATION_LEVELS, options.notificationLevel)
        ? options.notificationLevel
        : undefined,
    });
  }

  respondToToolPermission(
    requestId: string,
    toolId: string,
    decision: AssistantToolPermissionDecision,
  ) {
    if (!isOneOf(ASSISTANT_TOOL_PERMISSION_DECISIONS, decision)) return;
    this.send({ type: 'tool_permission', requestId, toolId, decision });
  }

  compact(requestId: string, chatId: string, variant: AssistantVariant) {
    this.send({ type: 'compact', requestId, chatId, variant });
  }

  respondToTool(
    requestId: string,
    toolId: string,
    answers: Record<string, string>,
    customAnswer?: string,
  ) {
    this.send({ type: 'tool_response', requestId, toolId, answers, customAnswer });
  }

  cancel(requestId: string) {
    this.active.delete(requestId);
    this.send({ type: 'cancel', requestId });
  }

  close() {
    this.pending = [];
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}
