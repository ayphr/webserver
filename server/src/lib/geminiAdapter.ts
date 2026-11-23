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
  AssistantModelContinuation,
  AssistantModelDraft,
  AssistantModelRequest,
  AssistantModelToolResult,
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

export const buildAssistantSystemPrompt = (): string => {
  const toolLines = Object.values(ASSISTANT_TOOL_DEFINITIONS)
    .map((definition) => `- ${definition.name}: ${definition.description}`)
    .join('\n');
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
  ].join('\n\n');
};

/** The opt-in marker is stripped before anything is sent to Gemini. */
export const stripAiPrefix = (content: string) => content.replace(/^\s*ai:\s*/i, '');

/**
 * True when a prompt opted into the live provider with an `ai:` prefix. Kept
 * next to `stripAiPrefix` so detection and stripping can never disagree.
 */
export const isLiveAiPrompt = (content: string | undefined): boolean =>
  /^\s*ai:/i.test(content ?? '');

type GeminiUsage = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
};

type GeminiStep = Record<string, unknown>;

type PendingStep = {
  kind: 'function_call' | 'model_output' | 'thought' | 'other';
  step: GeminiStep;
  arguments: string;
  text: string;
  summary: string;
  finalized: boolean;
};

const parseArguments = (text: string): Record<string, unknown> => {
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed arguments are surfaced as an empty object; the tool validator
    // reports the invalid input to the model.
  }
  return {};
};

const stepKind = (type: unknown): PendingStep['kind'] =>
  type === 'function_call' || type === 'model_output' || type === 'thought' ? type : 'other';

export type GeminiRequestBody = {
  model: string;
  input: Array<Record<string, unknown>>;
  system_instruction?: string;
  tools?: Array<Record<string, unknown>>;
  store: boolean;
  stream: boolean;
  generation_config: { max_output_tokens: number };
};

const toGeminiSteps = (messages: AssistantContextMessage[]): Array<Record<string, unknown>> =>
  messages
    .filter((message) => message.role !== 'system')
    .flatMap((message) => {
      const text = stripAiPrefix(message.content).trim();
      if (!text) return [];
      return [
        {
          type: message.role === 'assistant' ? 'model_output' : 'user_input',
          content: [{ type: 'text' as const, text }],
        },
      ];
    });

/** Function results are fed back as their own steps in the stateless history. */
const toFunctionResultSteps = (
  results: AssistantModelToolResult[] = [],
): Array<Record<string, unknown>> =>
  results.map((entry) => ({
    type: 'function_result',
    name: entry.name,
    call_id: entry.toolId,
    result: [{ type: 'text', text: entry.content }],
  }));

const toSystemInstruction = (messages: AssistantContextMessage[]) => {
  const parts = [buildAssistantSystemPrompt()];
  const summary = messages
    .filter((message) => message.role === 'system')
    .map((message) => stripAiPrefix(message.content).trim())
    .filter(Boolean)
    .join('\n\n');
  if (summary) parts.push(summary);
  return parts.join('\n\n');
};

export type GeminiEventStreamResult = {
  content: string;
  usage?: GeminiUsage;
  toolCalls: Array<{ id?: string; name: string; arguments: string }>;
  /** Assembled model steps, ordered as they appeared in the stream. */
  steps: GeminiStep[];
};

/**
 * Reads a Gemini SSE stream and collects text, usage, function calls, and the
 * assembled model steps. The steps are replayed verbatim in stateless
 * follow-up requests, so a tool round can continue with the provider.
 * Kept separate from the adapter so the wire format can be tested in isolation.
 */
export async function readGeminiEventStream(response: Response): Promise<GeminiEventStreamResult> {
  if (!response.body) throw new Error('Gemini returned an empty response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage: GeminiUsage | undefined;
  let fallbackCallId = 0;
  const toolCalls: Array<{ id?: string; name: string; arguments: string }> = [];
  const pendingSteps = new Map<number, PendingStep>();
  const stepOrder = new Set<number>();

  const finalizeStep = (index: number) => {
    const pending = pendingSteps.get(index);
    if (!pending || pending.finalized) return;
    pending.finalized = true;

    if (pending.kind === 'function_call') {
      const name = typeof pending.step.name === 'string' ? pending.step.name : '';
      if (!name) return;
      const declaredId = typeof pending.step.id === 'string' ? pending.step.id : '';
      const id = declaredId || `gemini-tool-${fallbackCallId++}`;
      pending.step.id = id;
      // Streaming providers send an empty object at step.start and the real
      // arguments as `arguments_delta`. Keep a non-empty object if one arrived
      // without deltas instead of replacing it with `{}`.
      const declaredArguments = pending.step.arguments;
      const argumentsText = pending.arguments.trim()
        ? pending.arguments
        : typeof declaredArguments === 'string'
          ? declaredArguments
          : declaredArguments && typeof declaredArguments === 'object'
            ? JSON.stringify(declaredArguments)
            : '';
      pending.step.arguments = argumentsText ? parseArguments(argumentsText) : {};
      toolCalls.push({ id, name, arguments: argumentsText });
      return;
    }

    if (pending.kind === 'model_output' && pending.text) {
      pending.step.content = [{ type: 'text', text: pending.text }];
      return;
    }

    if (pending.kind === 'thought') {
      if (pending.summary) pending.step.summary = { type: 'text', text: pending.summary };
    }
  };

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
      const step =
        typeof event.step === 'object' && event.step !== null
          ? (event.step as Record<string, unknown>)
          : null;
      if (!step) return;
      stepOrder.add(index);
      pendingSteps.set(index, {
        kind: stepKind(step.type),
        step: { ...step },
        arguments: typeof step.arguments === 'string' ? step.arguments : '',
        text: '',
        summary: '',
        finalized: false,
      });
      return;
    }

    if (type === 'step.stop') {
      stepOrder.add(index);
      finalizeStep(index);
      return;
    }

    if (type === 'step.delta') {
      const delta = event.delta;
      if (typeof delta !== 'object' || delta === null) return;
      const candidate = delta as Record<string, unknown>;
      const pending = pendingSteps.get(index);

      if (candidate.type === 'arguments_delta' && typeof candidate.arguments === 'string') {
        stepOrder.add(index);
        if (pending) {
          pending.arguments += candidate.arguments;
        }
        return;
      }

      if (candidate.type === 'text' && typeof candidate.text === 'string') {
        content += candidate.text;
        if (pending) pending.text += candidate.text;
        return;
      }

      if (candidate.type === 'thought_signature' && typeof candidate.signature === 'string') {
        if (pending) pending.step.signature = candidate.signature;
        return;
      }

      if (candidate.type === 'thought_summary') {
        const summary = candidate.content;
        if (
          pending &&
          typeof summary === 'object' &&
          summary !== null &&
          (summary as Record<string, unknown>).type === 'text' &&
          typeof (summary as Record<string, unknown>).text === 'string'
        ) {
          pending.summary += String((summary as Record<string, unknown>).text);
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
  buffer += decoder.decode().replace(/\r\n/g, '\n');
  if (buffer.trim()) handleFrame(buffer);

  for (const index of stepOrder) finalizeStep(index);

  const steps: GeminiStep[] = [...stepOrder]
    .sort((left, right) => left - right)
    .flatMap((index) => {
      const pending = pendingSteps.get(index);
      if (!pending) return [];
      if (pending.kind === 'function_call') {
        return typeof pending.step.name === 'string' && pending.step.name ? [pending.step] : [];
      }
      if (pending.kind === 'model_output') {
        return pending.text ? [pending.step] : [];
      }
      if (pending.kind === 'thought') {
        return pending.step.signature !== undefined || pending.summary ? [pending.step] : [];
      }
      return [];
    });

  return { content, usage, toolCalls, steps };
};

/**
 * Builds the stateless request body, stripped of the `ai:` opt-in marker.
 * Continuation steps and function results are replayed after the base context
 * because `store: false` keeps no server-side conversation state.
 */
export function buildGeminiRequestBody(
  modelId: string,
  messages: AssistantContextMessage[],
  continuation?: AssistantModelContinuation,
  toolResults?: AssistantModelToolResult[],
  disableTools = false,
): GeminiRequestBody {
  const systemInstruction = toSystemInstruction(messages);
  return {
    model: modelId,
    input: [
      ...toGeminiSteps(messages),
      ...(continuation?.steps ?? []),
      ...toFunctionResultSteps(toolResults),
    ],
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(disableTools ? {} : { tools: GEMINI_TOOLS }),
    store: false,
    stream: true,
    generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
  };
}

async function requestGemini(request: AssistantModelRequest, apiKey: string): Promise<AssistantModelDraft> {
  const { modelId, messages, continuation, toolResults, disableTools } = request;
  const response = await fetch(`${GEMINI_ENDPOINT}?alt=sse`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      'Api-Revision': API_REVISION,
    },
    body: JSON.stringify(
      buildGeminiRequestBody(modelId, messages, continuation, toolResults, disableTools),
    ),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const { content, usage, toolCalls, steps } = await readGeminiEventStream(response);
  const inputText = [
    ...messages.map((message) => stripAiPrefix(message.content)),
    ...(continuation?.steps ?? []).map((step) => JSON.stringify(step)),
    ...(toolResults ?? []).map((result) => result.content),
  ].join('\n');
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
        : estimateTokens(`${content}\n${toolCalls.map((call) => call.arguments).join('\n')}`),
  };

  const tools: AssistantToolCall[] = toolCalls.map((call) => {
    const definition = isAssistantToolName(call.name) ? ASSISTANT_TOOL_DEFINITIONS[call.name] : undefined;
    return {
      id: call.id as string,
      name: call.name,
      label: definition?.label ?? call.name,
      status: 'pending',
      input: parseArguments(call.arguments),
      durationMs: 0,
    };
  });

  // Keep the entire stateless history after the base messages: prior model
  // steps, the results we just sent, and the steps from this response.
  const history = [
    ...(continuation?.steps ?? []),
    ...toFunctionResultSteps(toolResults),
    ...steps,
  ];

  return {
    content: content.trim(),
    thinking: [],
    tools,
    usage: resolvedUsage,
    ...(history.length > 0 ? { continuation: { steps: history } } : {}),
  };
}

export const geminiAdapter: AssistantModelAdapter = {
  id: 'gemini',

  async generate(request: AssistantModelRequest) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
    return requestGemini(request, GEMINI_API_KEY);
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
