import type { AssistantMessage } from '@common';

export type LiveAssistantMessage = AssistantMessage & {
  liveDurationMs?: number;
  liveTokensPerSecond?: number;
};

export type AssistantChatAction =
  | { type: 'new'; token: number }
  | { type: 'open'; token: number; chatId: string };
