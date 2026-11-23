import {
  estimateTokens,
  type AssistantContextMessage,
  type AssistantContextUsage,
  type AssistantMode,
  type AssistantModelId,
  type AssistantVariant,
} from '@common';
import {
  createAssistantMockFollowUp,
  createAssistantMockStream,
  type AssistantMockStream,
} from './assistantStream';
import { geminiAdapter, createAssistantModelRouter } from './geminiAdapter';

export type AssistantModelDraft = AssistantMockStream & {
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
  /** True when the user opted into the real provider with the `ai:` prefix. */
  useLiveAI?: boolean;
  /** Opaque provider state from a previous draft that requested tools. */
  continuation?: AssistantModelContinuation;
  /** Executed results for the tool calls in `continuation`. */
  toolResults?: AssistantModelToolResult[];
  /**
   * Omits tool declarations so the model has to answer with the results it
   * already has. Used for the final round of a long tool loop.
   */
  disableTools?: boolean;
};

export type AssistantSummaryRequest = {
  modelId: AssistantModelId;
  messages: AssistantContextMessage[];
  maxTokens: number;
};

/**
 * Boundary between the websocket orchestration and a real provider. The router
 * selects between the local mock and the Gemini adapter per request.
 */
export interface AssistantModelAdapter {
  readonly id: string;
  generate(request: AssistantModelRequest): Promise<AssistantModelDraft>;
  summarize(request: AssistantSummaryRequest): Promise<string>;
  countTokens?(text: string): Promise<number>;
}

const mockAdapter: AssistantModelAdapter = {
  id: 'mock',

  async generate({ mode, variant, toolResults }) {
    if (toolResults && toolResults.length > 0) {
      return createAssistantMockFollowUp(mode, variant, toolResults);
    }
    return createAssistantMockStream(mode, variant);
  },

  async summarize({ messages, maxTokens }) {
    if (messages.length === 0) return '';
    const lines = messages.map((message) => {
      const content = message.content.replace(/\s+/g, ' ').trim();
      return `- ${message.role}: ${content}`;
    });
    const maxChars = Math.max(1, maxTokens * 4);
    let body = lines.join('\n');
    if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;
    return `Summary of earlier conversation:\n${body}`;
  },

  async countTokens(text) {
    return estimateTokens(text);
  },
};

/**
 * Requests use the mock provider by default. A prompt beginning with `ai:` is
 * routed to Gemini; the prefix is stripped inside the adapter before the
 * request is sent. A missing GEMINI_API_KEY surfaces as a stream error.
 */
let activeAdapter: AssistantModelAdapter = createAssistantModelRouter(mockAdapter, geminiAdapter);

export function getAssistantModelAdapter(): AssistantModelAdapter {
  return activeAdapter;
}

/** Used by a real AI integration to replace the mock provider. */
export function setAssistantModelAdapter(adapter: AssistantModelAdapter): void {
  activeAdapter = adapter;
}
