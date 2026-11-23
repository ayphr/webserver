import {
  ASSISTANT_DATA,
  getAssistantInputBudget,
  getAssistantModel,
  type AssistantChat,
  type AssistantContextMessage,
  type AssistantContextUsage,
  type AssistantMessage,
  type AssistantVariant,
} from '../types';

/** Compact once the conversation reaches this share of the usable input budget. */
export const ASSISTANT_CONTEXT_THRESHOLD_RATIO = 0.8;
/** Messages always kept verbatim when compacting (most recent first). */
export const ASSISTANT_CONTEXT_RECENT_MESSAGES = 8;
/** Approximate token ceiling for a generated context summary. */
export const ASSISTANT_CONTEXT_SUMMARY_TOKEN_BUDGET = 2_048;

const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * Gemini documents roughly four characters per token. This is deliberately a
 * cheap estimate so it can run on every request; a provider adapter can later
 * replace it with an exact `countTokens` call.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateContextMessageTokens(message: AssistantContextMessage): number {
  return estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
}

export function estimateMessageTokens(
  message: Pick<AssistantMessage, 'content' | 'thinking' | 'tools' | 'safetyNotice'>,
): number {
  let text = message.content;
  if (message.safetyNotice) text += message.safetyNotice;
  for (const step of message.thinking ?? []) text += `${step.label}${step.detail ?? ''}`;
  for (const tool of message.tools ?? []) text += `${tool.name}${tool.label ?? ''}${tool.detail ?? ''}`;
  return estimateContextMessageTokens({ role: 'assistant', content: text });
}

export function toContextMessages(messages: readonly AssistantMessage[]): AssistantContextMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export type AssistantContextPlanInput = {
  chat?: AssistantChat;
  variant: AssistantVariant;
  prompt?: string;
  thresholdRatio?: number;
  recentMessageCount?: number;
};

export type AssistantContextPlan = {
  usage: AssistantContextUsage;
  /** The exact messages that would be handed to a model adapter. */
  contextMessages: AssistantContextMessage[];
  /** True when there is enough history to justify a compaction pass. */
  needsCompaction: boolean;
  /** Older messages that should be folded into a new summary. */
  olderMessages: AssistantMessage[];
};

/**
 * Builds the model-facing context and the usage numbers used by the gauge.
 * Compaction itself is async (the adapter generates the summary), so this
 * function only decides whether it is needed and what it would cover.
 */
export function planAssistantContext({
  chat,
  variant,
  prompt,
  thresholdRatio = ASSISTANT_CONTEXT_THRESHOLD_RATIO,
  recentMessageCount = ASSISTANT_CONTEXT_RECENT_MESSAGES,
}: AssistantContextPlanInput): AssistantContextPlan {
  const modelId = ASSISTANT_DATA[variant].model;
  const model = getAssistantModel(modelId);
  const budgetTokens = getAssistantInputBudget(modelId);
  const messages = chat?.messages ?? [];
  const compactedThrough = chat?.compactedThroughMessageId ?? 0;
  const activeMessages = messages.filter((message) => message.id > compactedThrough);
  const summary = chat?.contextSummary?.trim() || undefined;

  const summaryMessages: AssistantContextMessage[] = summary
    ? [{ role: 'system', content: summary }]
    : [];
  const promptMessages: AssistantContextMessage[] = prompt ? [{ role: 'user', content: prompt }] : [];
  const contextMessages = [
    ...summaryMessages,
    ...toContextMessages(activeMessages),
    ...promptMessages,
  ];

  const usedTokens = contextMessages.reduce(
    (total, message) => total + estimateContextMessageTokens(message),
    0,
  );
  const summaryTokens = summaryMessages.reduce(
    (total, message) => total + estimateContextMessageTokens(message),
    0,
  );

  const usage: AssistantContextUsage = {
    chatId: chat?.id,
    variant,
    modelId,
    modelLabel: model.label,
    usedTokens,
    budgetTokens,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    ratio: budgetTokens > 0 ? usedTokens / budgetTokens : 0,
    thresholdRatio,
    messageCount: messages.length,
    includedMessageCount: activeMessages.length + promptMessages.length,
    compactedMessageCount: messages.length - activeMessages.length,
    summaryTokens,
    compacted: Boolean(summary),
  };

  const compactableCount = Math.max(0, activeMessages.length - recentMessageCount);
  return {
    usage,
    contextMessages,
    needsCompaction: usedTokens >= budgetTokens * thresholdRatio && compactableCount >= 2,
    olderMessages: activeMessages.slice(0, compactableCount),
  };
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}
