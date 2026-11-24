import { expect, test } from 'bun:test';
import { summarizeAssistantContext } from './assistantContextSummary';

test('context summary condenses older messages without model calls', () => {
  const messages = [
    { role: 'system' as const, content: 'Existing summary' },
    { role: 'user' as const, content: 'What did the device report?' },
    { role: 'assistant' as const, content: 'It reported a temperature of 22C.' },
  ];

  const summary = summarizeAssistantContext(messages, 200);
  expect(summary).toContain('Summary of earlier conversation');
  expect(summary).toContain('- system: Existing summary');
  expect(summary).toContain('- assistant: It reported a temperature of 22C.');
});

test('context summary returns nothing for empty or blank histories', () => {
  expect(summarizeAssistantContext([], 200)).toBe('');
  expect(summarizeAssistantContext([{ role: 'user', content: '   ' }], 200)).toBe('');
});

test('context summary truncates without splitting surrogate pairs', () => {
  const messages = [{ role: 'assistant' as const, content: '😀'.repeat(200) }];
  const summary = summarizeAssistantContext(messages, 12);
  expect(summary.endsWith('…')).toBe(true);
  expect(summary).not.toContain('\uFFFD');
});
