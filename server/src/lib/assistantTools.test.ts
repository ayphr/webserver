import { describe, expect, it } from 'bun:test';
import {
  executeAssistantTool,
  registerAssistantDataProviders,
} from './assistantTools';

const baseContext = {
  userUuid: 'user-1',
  chatId: 'chat-1',
  requestId: 'request-1',
  toolId: 'tool-1',
  askUser: async () => ({}),
};

describe('assistant tool execution', () => {
  it('executes read tools against registered providers', async () => {
    registerAssistantDataProviders({
      async listDevices() {
        return { devices: [{ serial: 1 }] };
      },
      async readDeviceData() {
        throw new Error('not used');
      },
      async listLocations() {
        throw new Error('not used');
      },
      async getTeamSettings() {
        throw new Error('not used');
      },
      async listTeamMembers() {
        throw new Error('not used');
      },
    });

    const result = await executeAssistantTool('devices.list', {
      ...baseContext,
      input: { limit: 5 },
    });
    expect(result.status).toBe('ok');
    expect(result.name).toBe('devices.list');
    expect(result.summary).toContain('serial');
  });

  it('waits for an interactive answer', async () => {
    const result = await executeAssistantTool('user.question', {
      ...baseContext,
      input: {
        prompt: 'Choose one',
        steps: [
          {
            id: 'choice',
            prompt: 'Pick a color',
            suggestedAnswers: ['Blue', 'Green'],
            recommendedAnswer: 'Blue',
          },
        ],
      },
      askUser: async () => ({ choice: 'Green' }),
    });
    expect(result.status).toBe('ok');
    expect(result.answers).toEqual({ choice: 'Green' });
  });

  it('reports unknown tools without throwing', async () => {
    const result = await executeAssistantTool('unknown.tool', {
      ...baseContext,
      input: {},
    });
    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown tool');
  });
});
