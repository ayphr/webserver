import type { AssistantMessage } from '@common';

export type LiveAssistantMessage = AssistantMessage & {
  liveDurationMs?: number;
  liveTokensPerSecond?: number;
};
