import { expect, test } from 'bun:test';
import { splitAssistantResponseIntoTokens } from './assistantStream';

test('token splitting preserves the original response exactly', () => {
  const content = 'Hello there.\n\nThis is a **longer** response with `code`.';
  const tokens = splitAssistantResponseIntoTokens(content);
  expect(tokens.length).toBeGreaterThan(1);
  expect(tokens.join('')).toBe(content);
});

test('token splitting keeps whitespace that starts a streamed chunk', () => {
  const content = ' hello\n  world';
  const tokens = splitAssistantResponseIntoTokens(content);
  expect(tokens.join('')).toBe(content);
  expect(tokens[0]).toBe(' ');
});

test('token splitting handles empty and whitespace-only responses', () => {
  expect(splitAssistantResponseIntoTokens('')).toEqual([]);
  expect(splitAssistantResponseIntoTokens('   \n  ')).toEqual([]);
});

test('live chunks keep whitespace-only deltas so words cannot join', () => {
  expect(splitAssistantResponseIntoTokens(' ', { preserveWhitespaceOnly: true })).toEqual([' ']);
  expect(splitAssistantResponseIntoTokens('\n', { preserveWhitespaceOnly: true })).toEqual(['\n']);
  expect(splitAssistantResponseIntoTokens('  \n ', { preserveWhitespaceOnly: true })).toEqual(['  \n ']);
});
