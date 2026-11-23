import { expect, test } from 'bun:test';
import { splitAssistantResponseIntoTokens } from './assistantStream';

test('token splitting preserves the original response exactly', () => {
  const content = 'Hello there.\n\nThis is a **longer** response with `code`.';
  const tokens = splitAssistantResponseIntoTokens(content);
  expect(tokens.length).toBeGreaterThan(1);
  expect(tokens.join('')).toBe(content);
});

test('token splitting handles empty and whitespace-only responses', () => {
  expect(splitAssistantResponseIntoTokens('')).toEqual([]);
  expect(splitAssistantResponseIntoTokens('   \n  ')).toEqual([]);
});
