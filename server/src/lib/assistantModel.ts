import type {
  AssistantContextMessage,
  AssistantContextUsage,
  AssistantMode,
  AssistantModelId,
  AssistantThinkingStep,
  AssistantToolCall,
  AssistantUsageTokens,
  AssistantVariant,
} from '@common';
import { geminiAdapter } from './geminiAdapter';

export type AssistantModelDraft = {
  content: string;
  thinking: AssistantThinkingStep[];
  tools: AssistantToolCall[];
  /** Actual token usage reported by the provider, when available. */
  usage?: AssistantUsageTokens;
  /** Provider-native state needed to continue after tool execution. */
  continuation?: AssistantModelContinuation;
};

export type AssistantModelContinuation = {
  /** Provider-native steps accumulated across every round so far. */
  steps: Array<Record<string, unknown>>;
};

export type AssistantModelToolResult = {
  toolId: string;
  name: string;
  /** Provider-facing text content, usually JSON. */
  content: string;
  isError?: boolean;
};

export type AssistantModelRequest = {
  mode: AssistantMode;
  variant: AssistantVariant;
  modelId: AssistantModelId;
  /** Fully prepared context, oldest first. */
  messages: AssistantContextMessage[];
  usage: AssistantContextUsage;
  /** Opaque provider state from a previous draft that requested tools. */
  continuation?: AssistantModelContinuation;
  /** Executed results for the tool calls in `continuation`. */
  toolResults?: AssistantModelToolResult[];
  /**
   * Omits tool declarations so the model has to answer with the results it
   * already has. Used for the final round of a long tool loop.
   */
  disableTools?: boolean;
  /** Cancels the in-flight provider request when the client stream is cancelled. */
  signal?: AbortSignal;
};

/** Live callbacks fired while the provider response is still arriving. */
export type AssistantModelStreamHandlers = {
  /** Called once for each text chunk, before the draft is complete. */
  onTextDelta?: (delta: string) => void;
};

/** Boundary between websocket orchestration and the sole provider, Gemini. */
export interface AssistantModelAdapter {
  readonly id: string;
  generate(
    request: AssistantModelRequest,
    handlers?: AssistantModelStreamHandlers,
  ): Promise<AssistantModelDraft>;
}

const adapter: AssistantModelAdapter = geminiAdapter;

export function getAssistantModelAdapter(): AssistantModelAdapter {
  return adapter;
}
