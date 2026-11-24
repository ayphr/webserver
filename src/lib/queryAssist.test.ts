import { describe, expect, test } from 'bun:test';
import { prepareAssistedQuery } from './queryAssist';

describe('prepareAssistedQuery', () => {
  test('accepts and formats a valid query', () => {
    const result = prepareAssistedQuery({
      query: 'findAll(p->{p.temperature>20})',
      explanation: 'Finds warm readings.',
    });

    expect(result.explanation).toBe('Finds warm readings.');
    expect(() => prepareAssistedQuery({ query: result.query })).not.toThrow();
  });

  test('normalizes explanation whitespace and supplies a fallback', () => {
    expect(prepareAssistedQuery({
      query: 'findAll(p -> { p.temperature > 20 })',
      explanation: '  Finds\nwarm readings.  ',
    }).explanation).toBe('Finds warm readings.');
    expect(prepareAssistedQuery({
      query: 'findAll(p -> { p.temperature > 20 })',
      explanation: 42,
    }).explanation).toBe('Iris wrote a query from your description.');
  });

  test('rejects malformed responses', () => {
    expect(() => prepareAssistedQuery(null)).toThrow('Iris did not return a query');
    expect(() => prepareAssistedQuery({ query: 42 })).toThrow('Iris did not return a query');
    expect(() => prepareAssistedQuery({ query: '   ' })).toThrow('Iris did not return a query');
  });

  test('rejects invalid TQL before it reaches the editor', () => {
    expect(() => prepareAssistedQuery({
      query: 'SELECT temperature FROM readings',
      explanation: 'Not TQL.',
    })).toThrow('Iris returned an invalid query');
  });
});
