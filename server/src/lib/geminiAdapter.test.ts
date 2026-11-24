import { describe, expect, it } from 'bun:test';
import {
  buildAssistantSystemPrompt,
  buildGeminiRequestBody,
  geminiAdapter,
  readGeminiEventStream,
} from './geminiAdapter';
import { getAssistantModelAdapter } from './assistantModel';

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
  it('is the only registered assistant model adapter', () => {
    expect(geminiAdapter.id).toBe('gemini');
    expect(getAssistantModelAdapter()).toBe(geminiAdapter);
  });

  it('builds a multi-line system prompt without internal identifiers', () => {
    const prompt = buildAssistantSystemPrompt();
    expect(prompt).toContain('You are Iris');
    expect(prompt).toContain('\n');
    expect(prompt).not.toContain('\\n');
    expect(prompt).toContain('look it up in the user’s workspace');
    expect(prompt).toContain('human-readable');
    expect(prompt).toContain('TQL');
    expect(prompt).toContain('Iris writer');
    expect(prompt).not.toMatch(/\bdevices\.list\b|\buser\.question\b|\balerts\.create\b/);
    expect(prompt).not.toMatch(/\bgemini-\d|\b\/v1beta\/|\bassistantStates\b/);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('builds a stateless request without unsupported step fields', () => {
    const body = buildGeminiRequestBody('gemini-4-hydrogen', [
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
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
      [{ role: 'user', content: 'What devices do I have?' }],
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
      [{ role: 'user', content: 'hi' }],
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

  it('creates unique fallback tool IDs for calls from different responses', async () => {
    const responseForCall = () => sseResponse([
      frame('step.start', { step: { type: 'function_call', name: 'devices.list', arguments: {} } }),
      frame('step.delta', { delta: { type: 'arguments_delta', arguments: '{"limit":1}' } }),
      frame('step.stop', {}),
    ]);
    const first = await readGeminiEventStream(responseForCall());
    const second = await readGeminiEventStream(responseForCall());

    expect(first.toolCalls).toHaveLength(1);
    expect(second.toolCalls).toHaveLength(1);
    const firstId = first.toolCalls[0]!.id!;
    const secondId = second.toolCalls[0]!.id!;
    expect(firstId).toMatch(/^gemini-tool-/);
    expect(secondId).toMatch(/^gemini-tool-/);
    expect(firstId).not.toBe(secondId);
  });

  it('does not collapse events without an index onto step 0', async () => {
    const response = sseResponse([
      frame('step.start', { index: 7, step: { type: 'function_call', name: 'devices.list', arguments: {} } }),
      frame('step.delta', { delta: { type: 'arguments_delta', arguments: '{"limit":2}' } }),
      frame('step.stop', {}),
      frame('step.start', { step: { type: 'thought' } }),
      frame('step.delta', { delta: { type: 'thought_signature', signature: 'sig-7' } }),
      frame('step.stop', {}),
    ]);

    const result = await readGeminiEventStream(response);
    expect(result.toolCalls).toEqual([
      { id: result.toolCalls[0]!.id, name: 'devices.list', arguments: '{"limit":2}' },
    ]);
    expect(result.steps).toEqual([
      { type: 'function_call', id: result.toolCalls[0]!.id, name: 'devices.list', arguments: { limit: 2 } },
      { type: 'thought', signature: 'sig-7' },
    ]);
  });

  it('only forwards model_output text to onTextDelta', async () => {
    const response = sseResponse([
      frame('step.start', { index: 0, step: { type: 'thought' } }),
      frame('step.delta', { index: 0, delta: { type: 'text', text: 'internal reasoning' } }),
      frame('step.stop', { index: 0 }),
      frame('step.start', { index: 1, step: { type: 'model_output' } }),
      frame('step.delta', { index: 1, delta: { type: 'text', text: 'Visible answer' } }),
      frame('step.stop', { index: 1 }),
    ]);

    const seen: string[] = [];
    const result = await readGeminiEventStream(response, {
      onTextDelta: (delta) => seen.push(delta),
    });
    expect(seen).toEqual(['Visible answer']);
    expect(result.content).toBe('Visible answer');
  });

  it('emits text deltas before the stream finishes', async () => {
    let releaseSecond: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const firstFrame = frame('step.delta', { delta: { type: 'text', text: 'first ' } });
    const secondFrame = frame('step.delta', { delta: { type: 'text', text: 'second' } });
    const encoder = new TextEncoder();

    const stream = new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(firstFrame));
          await gate;
          controller.enqueue(encoder.encode(secondFrame));
          controller.close();
        },
      }),
    );

    const seen: string[] = [];
    let firedBeforeSecondFrame = false;
    const pending = readGeminiEventStream(stream, {
      onTextDelta: (delta) => {
        seen.push(delta);
        if (seen.length === 1) {
          // The gate is still closed here, so this proves the callback fired
          // before the provider finished streaming.
          firedBeforeSecondFrame = true;
          releaseSecond?.();
        }
      },
    });
    const result = await pending;
    expect(firedBeforeSecondFrame).toBe(true);
    expect(seen).toEqual(['first ', 'second']);
    expect(result.content).toBe('first second');
  });

});
