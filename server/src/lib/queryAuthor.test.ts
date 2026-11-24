import { describe, expect, test } from 'bun:test';
import type { AssistantModelDraft, AssistantModelRequest } from './assistantModel';
import {
  QueryAuthorError,
  buildQueryAuthorUserPrompt,
  generateTqlQuery,
  parseQueryAuthorResponse,
} from './queryAuthor';
import { getQueryBoostRequiredSteps, parseQuery, type QueryAssistRequest } from '@common';

const request: QueryAssistRequest = {
  prompt: 'Find warm readings from the lab',
  serials: [123],
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-02T00:00:00.000Z',
  type: 'standard',
};

function adapterWithResponses(contents: string[]) {
  const requests: AssistantModelRequest[] = [];
  return {
    adapter: {
      id: 'test-adapter',
      async generate(modelRequest: AssistantModelRequest): Promise<AssistantModelDraft> {
        requests.push(modelRequest);
        return {
          content: contents.shift() ?? '',
          thinking: [],
          tools: [],
        };
      },
    },
    get calls() {
      return requests.map((entry) => entry.messages.map((message) => message.content));
    },
    requests,
  };
}

describe('buildQueryAuthorUserPrompt', () => {
  test('includes server-resolved context and existing query', () => {
    const prompt = buildQueryAuthorUserPrompt({
      ...request,
      existingQuery: 'findAll()',
      deviceLabels: [{ serial: 123, name: 'Lab Sensor' }],
    });

    expect(prompt).toContain(request.prompt);
    expect(prompt).toContain('Lab Sensor (serial 123)');
    expect(prompt).toContain(request.from);
    expect(prompt).toContain('Query mode: standard');
    expect(prompt).toContain('Current editor query');
    expect(prompt).toContain('findAll()');
  });

  test('includes correction feedback on retry', () => {
    const prompt = buildQueryAuthorUserPrompt(request, 'Use braces around the condition.');
    expect(prompt).toContain('Problem with the previous attempt: Use braces around the condition.');
  });
});

describe('parseQueryAuthorResponse', () => {
  test('extracts an explanation and fenced TQL query', () => {
    const parsed = parseQueryAuthorResponse([
      'Explanation: Finds warm readings.',
      '',
      '```tql',
      'findAll(p -> { p.temperature > 20 })',
      '```',
    ].join('\n'));

    expect(parsed?.explanation).toBe('Finds warm readings.');
    expect(parsed?.query).toBe('findAll(p -> { p.temperature > 20 })');
  });

  test('accepts an unfenced single query with a fallback explanation', () => {
    const parsed = parseQueryAuthorResponse('findAll(p -> { p.humidity < 40 })');
    expect(parsed?.query).toBe('findAll(p -> { p.humidity < 40 })');
    expect(parsed?.explanation).toBe('Iris wrote a query from your description.');
  });

  test('rejects an empty response', () => {
    expect(parseQueryAuthorResponse('Explanation: nothing\n```tql\n\n```')).toBeNull();
  });
});

describe('generateTqlQuery', () => {
  test('returns validated, formatted TQL from a valid response', async () => {
    const { adapter, requests } = adapterWithResponses([
      [
        'Explanation: Finds readings above twenty degrees.',
        '```tql',
        'findAll(p->{p.temperature>20})',
        '```',
      ].join('\n'),
    ]);

    const result = await generateTqlQuery(request, { adapter });

    expect(result.explanation).toBe('Finds readings above twenty degrees.');
    expect(result.query).toContain('findAll');
    expect(() => parseValidQuery(result.query)).not.toThrow();
    expect(requests[0]?.mode).toBe('chat');
    expect(requests[0]?.disableTools).toBe(true);
    expect(requests[0]?.usage.usedTokens).toBeGreaterThan(0);
  });

  test('passes the abort signal to the provider request', async () => {
    const controller = new AbortController();
    const { adapter, requests } = adapterWithResponses([
      '```tql\nfindAll(p -> { p.temperature > 20 })\n```',
    ]);

    await generateTqlQuery(request, { adapter, signal: controller.signal });

    expect(requests[0]?.signal).toBe(controller.signal);
  });

  test('returns advanced queries so the Queries tab can offer Boost', async () => {
    const { adapter } = adapterWithResponses([
      '```tql\nfindAll() then window(\'1h\', \'avg\', p -> { p.temperature })\n```',
    ]);

    const result = await generateTqlQuery({ ...request, type: 'standard' }, { adapter });

    expect(result.query).toMatch(/window|resample/);
    expect(getQueryBoostRequiredSteps(result.query).length).toBeGreaterThan(0);
  });

  test('retries once when the first query is invalid', async () => {
    const { adapter, requests } = adapterWithResponses([
      '```tql\nSELECT * FROM temperature\n```',
      '```tql\nfindAll(p -> { p.temperature > 20 })\n```',
    ]);

    const result = await generateTqlQuery(request, { adapter });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[1]?.content).toContain('Problem with the previous attempt');
    expect(result.query).toContain('findAll');
  });

  test('throws a user-facing error after repeated invalid output', async () => {
    const { adapter } = adapterWithResponses([
      '```tql\nnot tql at all\n```',
      '```tql\nSELECT * FROM readings\n```',
    ]);

    const error = await generateTqlQuery(request, { adapter }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(QueryAuthorError);
    expect((error as Error).message).toBe('Iris could not write a valid query. Try describing it differently.');
  });

  test('rejects invalid request context before calling the model', async () => {
    const { adapter, calls } = adapterWithResponses([]);

    await expect(generateTqlQuery({ ...request, prompt: '  ' }, { adapter })).rejects.toThrow(QueryAuthorError);
    await expect(generateTqlQuery({ ...request, serials: [] }, { adapter })).rejects.toThrow(QueryAuthorError);
    await expect(generateTqlQuery({ ...request, from: 'not a date' }, { adapter })).rejects.toThrow(QueryAuthorError);
    expect(calls).toHaveLength(0);
  });
});

function parseValidQuery(query: string): void {
  // parseQuery throws on invalid TQL; generateTqlQuery must never return invalid TQL.
  parseQuery(query);
}
