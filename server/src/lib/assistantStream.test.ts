import { expect, test } from 'bun:test';
import {
  createAssistantMockStream,
  splitAssistantResponseIntoTokens,
} from './assistantStream';

test('stream tokens reconstruct the original markdown exactly', () => {
  for (const mode of ['chat', 'task'] as const) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const { content } = createAssistantMockStream(mode);
      expect(splitAssistantResponseIntoTokens(content).join('')).toBe(content);
    }
  }
});

test('mock streams expose valid thinking and tool state', () => {
  for (const mode of ['chat', 'task'] as const) {
    const stream = createAssistantMockStream(mode, 'turbo');

    expect(stream.content.length).toBeGreaterThan(0);
    expect(stream.thinking.every((step) => step.status === 'pending')).toBe(true);
    expect(stream.tools.every((tool) => tool.status === 'pending')).toBe(true);
    expect(new Set(stream.thinking.map((step) => step.id)).size).toBe(stream.thinking.length);
    expect(new Set(stream.tools.map((tool) => tool.id)).size).toBe(stream.tools.length);
  }
});

test('task responses use markdown headings', () => {
  const { content } = createAssistantMockStream('task');
  expect(content.startsWith('## ')).toBe(true);
});
