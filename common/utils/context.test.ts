import { describe, expect, it } from 'bun:test';
import type { AssistantChat, AssistantMessage } from '../types/assistant';
import {
  estimateTokens,
  formatTokenCount,
  planAssistantContext,
  ASSISTANT_CONTEXT_RECENT_MESSAGES,
} from './context';

const messages = (count: number): AssistantMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index + 1}`,
    createdAt: index + 1,
  }));

const chat = (items: AssistantMessage[], overrides: Partial<AssistantChat> = {}): AssistantChat => ({
  id: 'chat-1',
  title: 'Chat',
  folderId: null,
  mode: 'chat',
  messages: items,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('assistant context helpers', () => {
  it('estimates tokens at roughly four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(401))).toBe(101);
  });

  it('uses the model input budget for the selected variant', () => {
    const plan = planAssistantContext({ chat: chat(messages(2)), variant: 'standard' });
    expect(plan.usage.modelId).toBe('gemini-4-hydrogen');
    expect(plan.usage.budgetTokens).toBe(1_048_576 - 65_536);
    expect(plan.usage.contextWindowTokens).toBe(1_048_576);
    expect(plan.usage.usedTokens).toBeGreaterThan(0);
    expect(plan.needsCompaction).toBe(false);
  });

  it('identifies older messages to compact and keeps the most recent ones', () => {
    const items = messages(12);
    const plan = planAssistantContext({
      chat: chat(items),
      variant: 'standard',
      thresholdRatio: 0,
    });
    expect(plan.needsCompaction).toBe(true);
    expect(plan.olderMessages).toHaveLength(12 - ASSISTANT_CONTEXT_RECENT_MESSAGES);
    expect(plan.olderMessages[0]?.id).toBe(1);
    expect(plan.olderMessages.at(-1)?.id).toBe(4);
  });

  it('excludes messages already folded into a summary', () => {
    const plan = planAssistantContext({
      chat: chat(messages(10), {
        contextSummary: 'Earlier chat summary',
        compactedThroughMessageId: 6,
      }),
      variant: 'standard',
    });
    expect(plan.usage.compactedMessageCount).toBe(6);
    expect(plan.usage.compacted).toBe(true);
    expect(plan.contextMessages.some((message) => message.role === 'system')).toBe(true);
    expect(plan.contextMessages.filter((message) => message.role === 'user')).toHaveLength(2);
  });

  it('formats token counts compactly', () => {
    expect(formatTokenCount(820)).toBe('820');
    expect(formatTokenCount(9_400)).toBe('9.4k');
    expect(formatTokenCount(1_048_576)).toBe('1.0m');
  });
});
