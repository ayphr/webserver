import {
  estimateTokens,
  type AssistantContextMessage,
  type AssistantContextUsage,
  type AssistantMode,
  type AssistantModelId,
  type AssistantVariant,
} from '@common';
import { createAssistantMockStream, type AssistantMockStream } from './assistantStream';
import { geminiAdapter, createAssistantModelRouter } from './geminiAdapter';

export type AssistantModelDraft = AssistantMockStream;

export type AssistantModelRequest = {
  mode: AssistantMode;
  variant: AssistantVariant;
  modelId: AssistantModelId;
  /** Fully prepared context, oldest first. */
  messages: AssistantContextMessage[];
  usage: AssistantContextUsage;
  /** True when the user opted into the real provider with the `ai:` prefix. */
  useLiveAI?: boolean;
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

  async generate({ mode, variant }) {
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
