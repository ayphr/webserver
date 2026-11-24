import { describe, expect, test } from 'bun:test';
import { prepareAssistedQuery } from './queryAssist';

const validResponse = {
  query: 'findAll(p->{p.temperature>20})',
  explanation: 'Finds warm readings.',
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-01-02T00:00:00.000Z',
  type: 'standard',
  creditCost: 0.08,
};

describe('prepareAssistedQuery', () => {
  test('accepts and formats a valid query with chosen run settings', () => {
    const result = prepareAssistedQuery(validResponse);

    expect(result.explanation).toBe('Finds warm readings.');
    expect(result.from).toBe(validResponse.from);
    expect(result.to).toBe(validResponse.to);
    expect(result.type).toBe('standard');
    expect(result.creditCost).toBe(0.08);
    expect(() => prepareAssistedQuery({ ...validResponse, query: result.query })).not.toThrow();
  });

  test('accepts Date objects revived by the API client', () => {
    const result = prepareAssistedQuery({
      ...validResponse,
      from: new Date(validResponse.from),
      to: new Date(validResponse.to),
    });

    expect(result.from).toBe(validResponse.from);
    expect(result.to).toBe(validResponse.to);
  });

  test('normalizes explanation whitespace and supplies a fallback', () => {
    expect(prepareAssistedQuery({
      ...validResponse,
      explanation: '  Finds\nwarm readings.  ',
    }).explanation).toBe('Finds warm readings.');
    expect(prepareAssistedQuery({
      ...validResponse,
      explanation: 42,
    }).explanation).toBe('Iris wrote a query from your description.');
  });

  test('rejects malformed responses', () => {
    expect(() => prepareAssistedQuery(null)).toThrow('Iris did not return a query');
    expect(() => prepareAssistedQuery({ ...validResponse, query: 42 })).toThrow('Iris did not return a query');
    expect(() => prepareAssistedQuery({ ...validResponse, query: '   ' })).toThrow('Iris did not return a query');
  });

  test('rejects invalid TQL before it reaches the editor', () => {
    expect(() => prepareAssistedQuery({
      ...validResponse,
      query: 'SELECT temperature FROM readings',
      explanation: 'Not TQL.',
    })).toThrow('Iris returned an invalid query');
  });

  test('rejects invalid run settings', () => {
    expect(() => prepareAssistedQuery({
      ...validResponse,
      from: 'yesterday',
    })).toThrow('Iris returned an invalid time range');
    expect(() => prepareAssistedQuery({
      ...validResponse,
      to: '2025-01-01T00:00:00.000Z',
    })).toThrow('Iris returned an invalid time range');
    expect(() => prepareAssistedQuery({
      ...validResponse,
      type: 'turbo',
    })).toThrow('Iris returned an invalid query mode');
  });

  test('falls back to the current range and mode when the response omits them', () => {
    const result = prepareAssistedQuery({
      query: validResponse.query,
      explanation: validResponse.explanation,
      creditCost: validResponse.creditCost,
    }, {
      from: '2025-02-01T00:00:00Z',
      to: '2025-02-02T00:00:00Z',
      type: 'boost',
    });

    expect(result.from).toBe('2025-02-01T00:00:00.000Z');
    expect(result.to).toBe('2025-02-02T00:00:00.000Z');
    expect(result.type).toBe('boost');
  });

  test('ignores invalid response run settings when a fallback is available', () => {
    const result = prepareAssistedQuery({
      ...validResponse,
      from: 'yesterday',
      to: null,
      type: 'turbo',
    }, {
      from: validResponse.from,
      to: validResponse.to,
      type: 'standard',
    });

    expect(result.from).toBe(validResponse.from);
    expect(result.to).toBe(validResponse.to);
    expect(result.type).toBe('standard');
  });
});
