import type { AssistantModelId } from './assistantModels';
import type {
  AssistantToolInput,
  AssistantToolResult,
  AssistantUserQuestion,
} from './assistantTools';

export const ASSISTANT_VARIANTS: AssistantVariant[] = ['nano', 'lite', 'standard', 'plus', 'turbo'];
export type AssistantVariant = 'nano' | 'lite' | 'standard' | 'plus' | 'turbo';
export type AssistantSendShortcut = 'enter' | 'shift-enter';

export const ASSISTANT_MODES: AssistantMode[] = ['chat', 'task'];
export type AssistantMode = 'chat' | 'task';

export const ASSISTANT_PERMISSION_LEVELS = ['always-ask', 'sometimes-ask', 'never-ask'] as const;
export type AssistantPermissionLevel = (typeof ASSISTANT_PERMISSION_LEVELS)[number];

export const ASSISTANT_NOTIFICATION_LEVELS = ['always', 'sometimes', 'never'] as const;
export type AssistantNotificationLevel = (typeof ASSISTANT_NOTIFICATION_LEVELS)[number];

export const ASSISTANT_TOOL_PERMISSION_DECISIONS = ['allow_once', 'allow_always', 'deny'] as const;
export type AssistantToolPermissionDecision = (typeof ASSISTANT_TOOL_PERMISSION_DECISIONS)[number];

export const ASSISTANT_TOOL_PERMISSIONS = [
  'not_required',
  'pending',
  'allowed_once',
  'allowed_always',
  'denied',
] as const;
export type AssistantToolPermission = (typeof ASSISTANT_TOOL_PERMISSIONS)[number];

export const ASSISTANT_THINKING_STATUSES = ['pending', 'running', 'done'] as const;
export type AssistantThinkingStatus = (typeof ASSISTANT_THINKING_STATUSES)[number];

export type AssistantThinkingStep = {
  id: string;
  label: string;
  detail?: string;
  status: AssistantThinkingStatus;
  durationMs?: number;
};

export const ASSISTANT_TOOL_STATUSES = [
  'pending',
  'awaiting_permission',
  'running',
  'done',
  'denied',
  'error',
] as const;
export type AssistantToolStatus = (typeof ASSISTANT_TOOL_STATUSES)[number];

export type AssistantToolCall = {
  id: string;
  name: string;
  label?: string;
  status: AssistantToolStatus;
  detail?: string;
  durationMs?: number;
  error?: string;
  /** Character offset in the assistant message content where this tool run occurred. */
  contentOffset?: number;
  /** Records how a permission-gated tool was resolved. */
  permission?: AssistantToolPermission;
  /** Validated arguments the server executed with. */
  input?: AssistantToolInput;
  /** Human-readable preview of a pending mutation, shown before approval. */
  preview?: string;
  /** Result returned by the tool, persisted with the message. */
  result?: AssistantToolResult;
};

export const ASSISTANT_STREAM_PATH = '/ws/assistant';

export type AssistantContextMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Server-authoritative view of how much of a model's context is in use. */
export type AssistantContextUsage = {
  chatId?: string;
  variant: AssistantVariant;
  modelId: AssistantModelId;
  modelLabel: string;
  usedTokens: number;
  budgetTokens: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  ratio: number;
  thresholdRatio: number;
  messageCount: number;
  includedMessageCount: number;
  compactedMessageCount: number;
  summaryTokens: number;
  compacted: boolean;
};

export type AssistantStreamClientMessage =
  | { type: 'auth'; token: string }
  | {
      type: 'compact';
      requestId: string;
      chatId: string;
      variant: AssistantVariant;
    }
  | {
      type: 'stream';
      requestId: string;
      mode?: AssistantMode;
      variant?: AssistantVariant;
      permissionLevel?: AssistantPermissionLevel;
      allowedTools?: string[];
      chatId?: string;
      messageId?: number;
      prompt?: string;
      notificationLevel?: AssistantNotificationLevel;
    }
  | {
      type: 'tool_permission';
      requestId: string;
      toolId: string;
      decision: AssistantToolPermissionDecision;
    }
  | {
      type: 'tool_response';
      requestId: string;
      toolId: string;
      answers: Record<string, string>;
      customAnswer?: string;
    }
  | { type: 'cancel'; requestId: string };

export type AssistantStreamServerMessage =
  | { type: 'auth_error'; error: string }
  | { type: 'thinking'; requestId: string; step: AssistantThinkingStep }
  | { type: 'tool'; requestId: string; tool: AssistantToolCall }
  | { type: 'tool_permission_request'; requestId: string; tool: AssistantToolCall }
  | { type: 'token'; requestId: string; token: string; index?: number }
  | { type: 'done'; requestId: string; durationMs?: number; creditCost?: number }
  | { type: 'safety'; requestId: string; notice: 'refusal' | 'crisis' | 'csam' }
  | { type: 'context'; requestId: string; usage: AssistantContextUsage; summary?: string }
  | { type: 'tool_result'; requestId: string; toolId: string; result: AssistantToolResult }
  | { type: 'user_question'; requestId: string; toolId: string; question: AssistantUserQuestion }
  | { type: 'error'; requestId: string; error: string };

export type AssistantMessageFeedback = 'like' | 'dislike' | null;

export type AssistantMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
  error?: string;
  /** Safety intervention applied to this message, if any. */
  safetyNotice?: 'refusal' | 'crisis' | 'csam';
  feedback?: AssistantMessageFeedback;
  variant?: AssistantVariant;
  durationMs?: number;
  /** Credits charged by the server for this response. */
  creditCost?: number;
  thinking?: AssistantThinkingStep[];
  tools?: AssistantToolCall[];
  /** Persisted grouping of tool calls by consecutive runs in the stream. */
  toolGroups?: AssistantToolCall[][];
};

export type AssistantFolder = {
  id: string;
  name: string;
  createdAt: number;
  /** Display position. Legacy folders without it fall back to createdAt. */
  order?: number;
};

export type AssistantChat = {
  id: string;
  title: string;
  folderId: string | null;
  mode: AssistantMode;
  messages: AssistantMessage[];
  createdAt: number;
  updatedAt: number;
  /** Display position within folderId. Legacy chats without it fall back to createdAt. */
  order?: number;
  /** Server-generated summary of messages compacted out of the model context. */
  contextSummary?: string;
  /** Last message id already folded into contextSummary. */
  compactedThroughMessageId?: number;
};

export type AssistantPreferences = {
  defaultVariant: AssistantVariant;
  sendShortcut: AssistantSendShortcut;
  permissionLevel: AssistantPermissionLevel;
  /** Controls how much cloud-task progress is reported as notifications. */
  notificationLevel: AssistantNotificationLevel;
  /** Tool names the user chose to always allow, persisted across sessions. */
  allowedTools: string[];
  /** Delete chats older than this many days. 0 keeps everything. */
  chatRetentionDays?: number;
  /** Redact PII from stored assistant messages and logs. */
  piiRedactionEnabled?: boolean;
};

export type AssistantState = {
  chats: AssistantChat[];
  folders: AssistantFolder[];
  activeChatId: string | null;
  activeFolderId: string | null;
  activeMode: AssistantMode;
  preferences: AssistantPreferences;
};

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  defaultVariant: 'standard',
  sendShortcut: 'enter',
  permissionLevel: 'always-ask',
  notificationLevel: 'always',
  allowedTools: [],
  chatRetentionDays: 0,
  piiRedactionEnabled: true,
};

export const createDefaultAssistantState = (): AssistantState => ({
  chats: [],
  folders: [],
  activeChatId: null,
  activeFolderId: null,
  activeMode: 'chat',
  preferences: { ...DEFAULT_ASSISTANT_PREFERENCES, allowedTools: [] },
});

export type AssistantThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type AssistantData = {
  model: AssistantModelId;
  modelLabel: string;
  variantLabel: string;
  thinkingLevel?: AssistantThinkingLevel;
  usageRateMultiplierFromBaseline: number;
};

export const ASSISTANT_DATA: Record<AssistantVariant, AssistantData> = {
  nano: {
    model: 'gemini-3.5-flash-lite',
    modelLabel: 'Gemini 3.5 Flash Lite (minimal)',
    variantLabel: 'Nano',
    thinkingLevel: 'minimal',
    usageRateMultiplierFromBaseline: 1,
  },
  lite: {
    model: 'gemini-4-hydrogen',
    modelLabel: 'Gemini 4 Hydrogen (low)',
    variantLabel: 'Lite',
    thinkingLevel: 'low',
    usageRateMultiplierFromBaseline: 5,
  },
  standard: {
    model: 'gemini-4-hydrogen',
    modelLabel: 'Gemini 4 Hydrogen (medium)',
    variantLabel: 'Standard',
    thinkingLevel: 'medium',
    usageRateMultiplierFromBaseline: 6,
  },
  plus: {
    model: 'gemini-4-neon',
    modelLabel: 'Gemini 4 Neon (high)',
    variantLabel: 'Plus',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 25,
  },
  turbo: {
    model: 'gemini-4-carbon',
    modelLabel: 'Gemini 4 Carbon',
    variantLabel: 'Turbo',
    thinkingLevel: 'high',
    usageRateMultiplierFromBaseline: 40,
  },
};
