import { describe, expect, it } from 'bun:test';
import { normalizeAssistantToolInput } from './assistantTools';

describe('assistant tool input normalization', () => {
  it('applies safe defaults to read tools', () => {
    const input = normalizeAssistantToolInput('devices.data', {});
    expect(input.name).toBe('devices.data');
    expect(input.hours).toBe(24);
    expect(input.limit).toBe(20);
    expect(input.metric).toBe('all');
  });

  it('bounds numeric arguments', () => {
    const input = normalizeAssistantToolInput('team.members', { limit: 999 });
    expect(input.limit).toBe(100);
  });

  it('validates interactive question steps', () => {
    const input = normalizeAssistantToolInput('user.question', {
      prompt: 'Which signal matters?',
      steps: [
        {
          id: 'metric',
          prompt: 'Pick one',
          suggestedAnswers: ['Temperature', 'Humidity'],
          recommendedAnswer: 'Humidity',
        },
      ],
    });
    expect(input.question?.steps[0]?.recommendedAnswer).toBe('Humidity');
    expect(input.question?.customAnswerAllowed).toBe(true);
  });

  it('rejects invalid questions', () => {
    expect(() => normalizeAssistantToolInput('user.question', { prompt: 'Pick' })).toThrow();
    expect(() =>
      normalizeAssistantToolInput('user.question', {
        prompt: 'Pick',
        steps: [{ id: 'one', prompt: 'Pick one', suggestedAnswers: ['Only one'] }],
      }),
    ).toThrow();
  });

  it('validates alert rule arguments', () => {
    const input = normalizeAssistantToolInput('alerts.create', {
      name: 'Too warm',
      logic: 'or',
      conditions: [{ metric: 'temperature', operator: 'gt', value: 28 }],
      integrationIds: ['one', 'two'],
      repeatIntervalMinutes: 99999,
    });
    expect(input.logic).toBe('or');
    expect(input.conditions?.[0]).toEqual({ metric: 'temperature', operator: 'gt', value: 28 });
    expect(input.integrationIds).toEqual(['one', 'two']);
    expect(input.repeatIntervalMinutes).toBe(10080);
    expect(() => normalizeAssistantToolInput('alerts.create', { name: 'Bad' })).toThrow();
    expect(() =>
      normalizeAssistantToolInput('alerts.create', {
        name: 'Bad',
        conditions: [{ metric: ' Radiation ', operator: 'gt', value: 1 }],
      }),
    ).toThrow();
  });

  it('rejects unknown tools', () => {
    expect(() => normalizeAssistantToolInput('system.delete', {})).toThrow();
  });
});
