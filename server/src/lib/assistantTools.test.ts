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

  it('executes the full alert lifecycle against registered providers', async () => {
    const calls: string[] = [];
    registerAssistantDataProviders({
      async createAlert(_userUuid, input) {
        calls.push(`create:${input.displayName}`);
        return { alert: { id: 'alert-1', name: input.displayName } } as never;
      },
      async updateAlert(_userUuid, input) {
        calls.push(`update:${input.id}`);
        return { alert: { id: input.id, name: 'Updated' } } as never;
      },
      async deleteAlert(_userUuid, id) {
        calls.push(`delete:${id}`);
        return { deleted: true } as never;
      },
      async testAlert(_userUuid, id) {
        calls.push(`test:${id}`);
        return { results: [] } as never;
      },
      async muteAlert(_userUuid, input) {
        calls.push(`mute:${input.id}`);
        return { muted: true } as never;
      },
    });

    const condition = { metric: 'temperature', operator: 'gt', value: 30 };
    const created = await executeAssistantTool('alerts.create', {
      ...baseContext,
      input: { name: 'Too hot', conditions: [condition] },
    });
    expect(created.status).toBe('ok');

    for (const name of ['alerts.update', 'alerts.delete', 'alerts.test', 'alerts.mute'] as const) {
      const result = await executeAssistantTool(name, {
        ...baseContext,
        input: { id: 'alert-1' },
      });
      expect(result.status).toBe('ok');
    }
    expect(calls).toEqual([
      'create:Too hot',
      'update:alert-1',
      'delete:alert-1',
      'test:alert-1',
      'mute:alert-1',
    ]);
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
