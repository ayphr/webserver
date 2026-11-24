import { describe, expect, test } from 'bun:test';
import { parseQueryAssistBody } from './queries';

const validBody = {
  prompt: '  Find warm readings  ',
  serials: [12, 12, 34],
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-02T00:00:00.000Z',
  type: 'boost',
  existingQuery: 'findAll()',
};

describe('parseQueryAssistBody', () => {
  test('normalizes a valid request', () => {
    const parsed = parseQueryAssistBody(validBody);
    expect('request' in parsed).toBe(true);
    if (!('request' in parsed)) return;

    expect(parsed.request).toEqual({
      prompt: 'Find warm readings',
      serials: [12, 34],
      from: validBody.from,
      to: validBody.to,
      type: 'boost',
      existingQuery: 'findAll()',
    });
  });

  test('defaults a missing type to standard and omits blank editor context', () => {
    const body = { ...validBody, existingQuery: '   ' };
    delete (body as { type?: string }).type;
    const parsed = parseQueryAssistBody(body);
    expect('request' in parsed).toBe(true);
    if (!('request' in parsed)) return;

    expect(parsed.request.type).toBe('standard');
    expect(parsed.request.existingQuery).toBeUndefined();
  });

  test('accepts numeric serial strings through the shared serial parser', () => {
    const parsed = parseQueryAssistBody({ ...validBody, serials: ['12', 34] });
    expect('request' in parsed).toBe(true);
    if (!('request' in parsed)) return;
    expect(parsed.request.serials).toEqual([12, 34]);
  });

  test('rejects missing, oversized, or malformed fields', () => {
    expect(parseQueryAssistBody(null)).toEqual({ error: 'request body must be valid JSON' });
    expect(parseQueryAssistBody({ ...validBody, prompt: '   ' })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, prompt: 'x'.repeat(1001) })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, serials: [] })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, serials: [12, 'abc'] })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, type: 'unknown' })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, existingQuery: 'x'.repeat(20_001) })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, from: 'yesterday' })).toHaveProperty('error');
    expect(parseQueryAssistBody({ ...validBody, to: '2025-01-01T00:00:00.000Z' })).toHaveProperty('error');
  });
});
