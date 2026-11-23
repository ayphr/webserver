import { describe, expect, it } from 'bun:test';
import { createAssistantMockFollowUp } from './assistantStream';

describe('mock continuation', () => {
  it('answers after a tool round without requesting more tools', () => {
    const draft = createAssistantMockFollowUp('task', 'standard', [
      { name: 'devices.list', content: '{"devices":[{"name":"Sensor"}]}' },
      { name: 'team.members', content: '{"members":[]}' },
    ]);

    expect(draft.tools).toEqual([]);
    expect(draft.thinking).toEqual([]);
    expect(draft.content).toContain('Sensor');
    expect(draft.content.length).toBeGreaterThan(0);
  });

  it('does not invent an answer when every tool failed', () => {
    const draft = createAssistantMockFollowUp('chat', 'nano', [
      { name: 'devices.data', content: '{"error":"denied"}', isError: true },
    ]);

    expect(draft.tools).toEqual([]);
    expect(draft.content).toContain("couldn't");
  });
});
