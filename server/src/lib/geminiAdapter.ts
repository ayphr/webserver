import {
  ASSISTANT_TOOL_DEFINITIONS,
  estimateTokens,
  isAssistantToolName,
  type AssistantContextMessage,
  type AssistantToolCall,
  type AssistantUsageTokens,
} from '@common';
import { GEMINI_API_KEY } from '../env';
import type {
  AssistantModelAdapter,
  AssistantModelDraft,
  AssistantModelRequest,
  AssistantSummaryRequest,
} from './assistantModel';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 8_192;

const GEMINI_TOOLS = Object.values(ASSISTANT_TOOL_DEFINITIONS).map((definition) => ({
  type: 'function',
  name: definition.name,
  description: definition.description,
  parameters: definition.parameters ?? { type: 'object', properties: {} },
}));

const buildAssistantSystemPrompt = (): string => {
  const toolLines = Object.values(ASSISTANT_TOOL_DEFINITIONS)
    .map((definition) => `- ${definition.name}: ${definition.description}`)
    .join('\\n');
  return [
    'You are Iris, the AI assistant built into the Ayphr web application.',
    'You help users understand their devices, locations, team settings, and team members, and you can ask them clarifying questions when needed.',
    `Current date and time: ${new Date().toISOString()} (server time).`,
    'Ayphr environment: users belong to teams; teams own devices and locations; data is scoped to the team; credits are billed per model usage at 1 credit = $0.005 USD.',
    'Available tools (call them only when the answer needs live data; the server executes them and returns results):',
    toolLines,
    'How the user controls you: they choose the model variant, permission level, allowed tools, and notification level; sensitive or unallowed tools require explicit approval; they can compact long conversations.',
    'Safety: never provide instructions for self-harm, violence, abuse, or sexual content involving minors; for suicidal intent, respond with crisis support and localized resources; refuse other harmful requests clearly.',
    'When you use a tool, summarize the returned data plainly and cite what came from it; do not invent device readings or team data.',
  ].join('\\n\\n');
};

/** The opt-in marker is stripped before anything is sent to Gemini. */
export const stripAiPrefix = (content: string) => content.replace(/^\s*ai:\s*/i, '');

type GeminiUsage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
};

export type GeminiRequestBody = {
  model: string;
  input: Array<{
    type: 'user_input' | 'model_output';
    content: Array<{ type: 'text'; text: string }>;
  }>;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  store: boolean;
  stream: boolean;
  generation_config: { max_output_tokens: number };
};

const toGeminiSteps = (messages: AssistantContextMessage[]): GeminiRequestBody['input'] =>
  messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      type: message.role === 'assistant' ? 'model_output' : 'user_input',
      content: [{ type: 'text' as const, text: stripAiPrefix(message.content) }],
    }));

const toSystemInstruction = (messages: AssistantContextMessage[]) => {
  const parts = [buildAssistantSystemPrompt()];
  const summary = messages
    .filter((message) => message.role === 'system')
    .map((message) => stripAiPrefix(message.content))
    .join('\n\n');
  if (summary) parts.push(summary);
  return parts.join('\n\n');
};

/**
 * Reads a Gemini SSE stream and collects the text deltas plus final usage.
 * Kept separate from the adapter so the wire format can be tested in isolation.
 */
export async function readGeminiEventStream(
  response: Response,
): Promise<{ content: string; usage?: GeminiUsage; toolCalls: Array<{ id?: string; name: string; arguments: string }> }> {
  if (!response.body) throw new Error('Gemini returned an empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: GeminiUsage | undefined;
  const toolCalls: Array<{ id?: string; name: string; arguments: string }> = [];
  const pendingCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  const finalized = new Set<number>();

  const handleFrame = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') return;

    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null) return;
      event = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const type = event.event_type;
    const index = typeof event.index === 'number' ? event.index : 0;

    if (type === 'step.start') {
      const step = typeof event.step === 'object' && event.step !== null ? (event.step as Record<string, unknown>) : null;
      if (step?.type === 'function_call') {
        const entry = pendingCalls.get(index) ?? { arguments: '' };
        if (typeof step.id === 'string') entry.id = step.id;
        if (typeof step.name === 'string') entry.name = step.name;
        if (typeof step.arguments === 'string') entry.arguments += step.arguments;
        pendingCalls.set(index, entry);
      }
      return;
    }

    if (type === 'step.stop') {
      const entry = pendingCalls.get(index);
      if (entry?.name && !finalized.has(index)) {
        toolCalls.push({ id: entry.id, name: entry.name, arguments: entry.arguments });
        finalized.add(index);
      }
      return;
    }

    if (type === 'step.delta') {
      const delta = event.delta;
      if (typeof delta === 'object' && delta !== null) {
        const candidate = delta as Record<string, unknown>;
        if (candidate.type === 'arguments_delta' && typeof candidate.arguments === 'string') {
          const entry = pendingCalls.get(index) ?? { arguments: '' };
          entry.arguments += candidate.arguments;
          pendingCalls.set(index, entry);
        }
        if (candidate.type === 'text' && typeof candidate.text === 'string') {
          content += candidate.text;
        }
      }
      return;
    }

    if (type === 'interaction.completed') {
      const interaction = event.interaction;
      if (typeof interaction === 'object' && interaction !== null) {
        const candidate = interaction as Record<string, unknown>;
        if (typeof candidate.usage === 'object' && candidate.usage !== null) {
          usage = candidate.usage as GeminiUsage;
        }
      }
      return;
    }

    if (type === 'error') {
      const error = event.error;
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as Record<string, unknown>).message)
          : 'Gemini stream failed';
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // SSE frames may use either LF or CRLF separators.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleFrame(buffer);

  for (const [pendingIndex, entry] of pendingCalls) {
    if (entry.name && !finalized.has(pendingIndex)) {
      toolCalls.push({ id: entry.id, name: entry.name, arguments: entry.arguments });
      finalized.add(pendingIndex);
    }
  }

  return { content, usage, toolCalls };
};

/** Builds the stateless request body, stripped of the `ai:` opt-in marker. */
export function buildGeminiRequestBody(
  modelId: string,
  messages: AssistantContextMessage[],
): GeminiRequestBody {
  const systemInstruction = toSystemInstruction(messages);
  return {
    model: modelId,
    input: toGeminiSteps(messages),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    tools: GEMINI_TOOLS,
    store: false,
    stream: true,
    generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
  };
}

async function requestGemini(
  modelId: string,
  messages: AssistantContextMessage[],
  apiKey: string,
): Promise<AssistantModelDraft> {
  const response = await fetch(`${GEMINI_ENDPOINT}?alt=sse`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(buildGeminiRequestBody(modelId, messages)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const { content, usage, toolCalls } = await readGeminiEventStream(response);
  const inputText = messages.map((message) => stripAiPrefix(message.content)).join('\n');
  const reportedInput = usage?.total_input_tokens;
  const reportedOutput = usage?.total_output_tokens;
  const thoughtTokens = usage?.total_thought_tokens ?? 0;
  const resolvedUsage: AssistantUsageTokens = {
    inputTokens:
      typeof reportedInput === 'number' && Number.isFinite(reportedInput)
        ? reportedInput
        : estimateTokens(inputText),
    outputTokens:
      typeof reportedOutput === 'number' && Number.isFinite(reportedOutput)
        ? reportedOutput + Math.max(0, thoughtTokens)
        : estimateTokens(content),
  };

  const tools: AssistantToolCall[] = toolCalls.map((call, toolIndex) => {
    let input: Record<string, unknown> = {};
    if (call.arguments.trim()) {
      try {
        const parsed: unknown = JSON.parse(call.arguments);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        input = {};
      }
    }
    const definition = isAssistantToolName(call.name) ? ASSISTANT_TOOL_DEFINITIONS[call.name] : undefined;
    return {
      id: call.id || `gemini-tool-${toolIndex}`,
      name: call.name,
      label: definition?.label ?? call.name,
      status: 'pending',
      input,
      durationMs: 0,
    };
  });

  return {
    content: content.trim(),
    thinking: [],
    tools,
    usage: resolvedUsage,
  };
}

export const geminiAdapter: AssistantModelAdapter = {
  id: 'gemini',

  async generate(request: AssistantModelRequest) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    return requestGemini(request.modelId, request.messages, GEMINI_API_KEY);
  },

  async summarize(_request: AssistantSummaryRequest) {
    // Compaction stays local: the `ai:` opt-in applies only to user messages.
    throw new Error('Gemini adapter does not perform summarization');
  },
};

/** Routes `ai:` prompts to Gemini and everything else to the local mock. */
export function createAssistantModelRouter(
  mock: AssistantModelAdapter,
  gemini: AssistantModelAdapter,
): AssistantModelAdapter {
  return {
    id: 'router',

    generate(request) {
      // An `ai:` prompt always opts into Gemini. If the key is missing, surface
      // the configuration error rather than silently answering with mock data.
      if (request.useLiveAI) return gemini.generate(request);
      return mock.generate(request);
    },

    summarize(request) {
      return mock.summarize(request);
    },

    countTokens(text) {
      return mock.countTokens?.(text) ?? Promise.resolve(estimateTokens(text));
    },
  };
}
