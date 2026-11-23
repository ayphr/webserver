import type { AssistantMessage, AssistantToolCall } from '@common';

export type LiveAssistantMessage = AssistantMessage & {
  liveDurationMs?: number;
  liveTokensPerSecond?: number;
  /** Client-only grouping of tool calls by consecutive runs in the stream. */
  toolGroups?: AssistantToolCall[][];
};

export type AssistantChatAction =
  | { type: 'new'; token: number }
  | { type: 'open'; token: number; chatId: string };
