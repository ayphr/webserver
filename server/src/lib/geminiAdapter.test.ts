import { describe, expect, it } from 'bun:test';
import {
  buildAssistantSystemPrompt,
  buildGeminiRequestBody,
  createAssistantModelRouter,
  isLiveAiPrompt,
  readGeminiEventStream,
  stripAiPrefix,
} from './geminiAdapter';
import type { AssistantModelAdapter, AssistantModelRequest } from './assistantModel';

const sseResponse = (frames: string[]) => new Response(frames.join(''));

const frame = (eventType: string, payload: Record<string, unknown>, crlf = false) => {
  const nl = crlf ? '\r\n' : '\n';
  return [
    `event: ${eventType}${nl}`,
    `data: ${JSON.stringify({ event_type: eventType, ...payload })}${nl}`,
    nl,
  ].join('');
};

describe('Gemini adapter', () => {
  it('strips the ai: opt-in prefix before sending content', () => {
    expect(stripAiPrefix('ai: hello')).toBe('hello');
    expect(stripAiPrefix('  AI:   hello')).toBe('hello');
    expect(stripAiPrefix('hello ai: world')).toBe('hello ai: world');
  });

  it('detects the ai: opt-in with the same rules it strips with', () => {
    expect(isLiveAiPrompt('ai: hello')).toBe(true);
    expect(isLiveAiPrompt('  AI:   hello')).toBe(true);
    expect(isLiveAiPrompt('ai:')).toBe(true);
    expect(isLiveAiPrompt('hello ai: world')).toBe(false);
    expect(isLiveAiPrompt(undefined)).toBe(false);
    expect(isLiveAiPrompt('')).toBe(false);
    // Regression: a doubled escape matched a literal backslash instead.
    expect(isLiveAiPrompt('\\sai: hello')).toBe(false);
  });

  it('builds a multi-line system prompt with real newlines', () => {
    const prompt = buildAssistantSystemPrompt();
    expect(prompt).toContain('You are Iris');
    expect(prompt).toContain('\n');
    expect(prompt).not.toContain('\\n');
    expect(prompt).toContain('devices.list');
    expect(prompt).toContain('user.question');
    expect(prompt).toContain('human-readable');
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('builds a stateless request without unsupported step fields', () => {
    const body = buildGeminiRequestBody('gemini-4-hydrogen', [
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'ai: Hello' },
      { role: 'assistant', content: 'ai: Hi' },
    ]);

    expect(body.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(body.system_instruction).toContain('You are Iris');
    expect(body.system_instruction).toContain('Be brief');
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.tools?.some((tool) => tool.name === 'devices.list')).toBe(true);
    expect('status' in body.input[0]!).toBe(false);
  });

  it('appends continuation steps and function results to the stateless input', () => {
    const body = buildGeminiRequestBody(
      'gemini-4-hydrogen',
      [{ role: 'user', content: 'ai: What devices do I have?' }],
      {
        steps: [{ type: 'function_call', id: 'call-1', name: 'devices.list', arguments: {} }],
      },
      [
        {
          toolId: 'call-1',
          name: 'devices.list',
          content: '{"devices":[]}',
        },
      ],
    );

    expect(body.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'What devices do I have?' }] },
      { type: 'function_call', id: 'call-1', name: 'devices.list', arguments: {} },
      {
        type: 'function_result',
        name: 'devices.list',
        call_id: 'call-1',
        result: [{ type: 'text', text: '{"devices":[]}' }],
      },
    ]);
    // Tools must be re-sent on every stateless follow-up request.
    expect(body.tools?.some((tool) => tool.name === 'devices.list')).toBe(true);
    expect(body.store).toBe(false);
  });

  it('can omit tools on a forced final round', () => {
    const body = buildGeminiRequestBody(
      'gemini-4-hydrogen',
      [{ role: 'user', content: 'ai: hi' }],
      undefined,
      undefined,
      true,
    );
    expect(body.tools).toBeUndefined();
  });

  it('assembles model steps so tool rounds can be replayed verbatim', async () => {
    const response = sseResponse([
      frame('step.start', { index: 0, step: { type: 'thought' } }),
      frame('step.delta', { index: 0, delta: { type: 'thought_signature', signature: 'sig-1' } }),
      frame('step.stop', { index: 0 }),
      frame('step.start', {
        index: 1,
        step: { type: 'function_call', id: 'call-9', name: 'team.members', arguments: {} },
      }),
      frame('step.delta', {
        index: 1,
        delta: { type: 'arguments_delta', arguments: '{"limit":5}' },
      }),
      frame('step.stop', { index: 1 }),
      frame('step.start', { index: 2, step: { type: 'model_output' } }),
      frame('step.delta', { index: 2, delta: { type: 'text', text: 'Here you go' } }),
      frame('step.stop', { index: 2 }),
    ]);

    const result = await readGeminiEventStream(response);
    expect(result.content).toBe('Here you go');
    expect(result.toolCalls).toEqual([
      { id: 'call-9', name: 'team.members', arguments: '{"limit":5}' },
    ]);
    expect(result.steps).toEqual([
      { type: 'thought', signature: 'sig-1' },
      { type: 'function_call', id: 'call-9', name: 'team.members', arguments: { limit: 5 } },
      { type: 'model_output', content: [{ type: 'text', text: 'Here you go' }] },
    ]);
  });

  it('parses text deltas and final usage from CRLF SSE frames', async () => {
    const response = sseResponse([
      frame('interaction.created', {}, true),
      frame('step.delta', { delta: { type: 'text', text: 'Hello ' } }, true),
      frame('step.delta', { delta: { type: 'text', text: 'world' } }, true),
      frame(
        'interaction.completed',
        {
          interaction: {
            usage: {
              total_input_tokens: 7,
              total_output_tokens: 12,
              total_thought_tokens: 5,
            },
          },
        },
        true,
      ),
      'data: [DONE]\r\n\r\n',
    ]);

    const result = await readGeminiEventStream(response);
    expect(result.content).toBe('Hello world');
    expect(result.usage?.total_input_tokens).toBe(7);
    expect(result.usage?.total_output_tokens).toBe(12);
    expect(result.usage?.total_thought_tokens).toBe(5);
  });

  it('surfaces stream error frames', async () => {
    const response = sseResponse([
      frame('error', { error: { message: 'quota exceeded', code: 'resource_exhausted' } }),
    ]);
    await expect(readGeminiEventStream(response)).rejects.toThrow('quota exceeded');
  });

  it('forwards continuation state and tool results through the router', async () => {
    let received: AssistantModelRequest | undefined;
    const mock: AssistantModelAdapter = {
      id: 'mock',
      async generate(request) {
        received = request;
        return { content: 'final', thinking: [], tools: [] };
      },
      async summarize() {
        return '';
      },
    };
    const gemini: AssistantModelAdapter = {
      id: 'gemini',
      async generate() {
        throw new Error('unused');
      },
      async summarize() {
        return '';
      },
    };
    const continuation = { steps: [{ type: 'function_call', id: 'c1', name: 'devices.list' }] };
    const toolResults = [{ toolId: 'c1', name: 'devices.list', content: '{}' }];

    await createAssistantModelRouter(mock, gemini).generate({
      mode: 'task',
      variant: 'standard',
      modelId: 'gemini-4-hydrogen',
      messages: [],
      usage: {} as AssistantModelRequest['usage'],
      useLiveAI: false,
      continuation,
      toolResults,
      disableTools: true,
    });

    expect(received?.continuation).toBe(continuation);
    expect(received?.toolResults).toBe(toolResults);
    expect(received?.disableTools).toBe(true);
  });

  it('routes ai: prompts to Gemini and everything else to the mock', async () => {
    let mockCalls = 0;
    let geminiCalls = 0;
    const mock: AssistantModelAdapter = {
      id: 'mock',
      async generate() {
        mockCalls += 1;
        return { content: 'mock', thinking: [], tools: [] };
      },
      async summarize() {
        return 'summary';
      },
    };
    const gemini: AssistantModelAdapter = {
      id: 'gemini',
      async generate() {
        geminiCalls += 1;
        return { content: 'live', thinking: [], tools: [] };
      },
      async summarize() {
        throw new Error('unused');
      },
    };
    const router = createAssistantModelRouter(mock, gemini);
    const request = { useLiveAI: true } as AssistantModelRequest;

    await router.generate(request);
    expect(geminiCalls).toBe(1);
    expect(mockCalls).toBe(0);

    await router.generate({ ...request, useLiveAI: false });
    expect(geminiCalls).toBe(1);
    expect(mockCalls).toBe(1);
  });
});
