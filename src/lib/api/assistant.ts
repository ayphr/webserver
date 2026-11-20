import type { AssistantMetricsPayload, AssistantState, AssistantStatePayload } from '@common';
import type { RequestClient } from './client';

export function createAssistantApi(client: RequestClient) {
  return {
    async getState(): Promise<AssistantState> {
      const response = await client.requestJson<AssistantStatePayload>('/api/assistant');
      return response.state;
    },
    async saveState(state: AssistantState): Promise<AssistantState> {
      const response = await client.requestJson<AssistantStatePayload>('/api/assistant', {
        method: 'PUT',
        body: { state },
      });
      return response.state;
    },
    async getMetrics(periodDays = 30, signal?: AbortSignal): Promise<AssistantMetricsPayload> {
      return client.requestJson<AssistantMetricsPayload>(`/api/assistant/metrics?days=${periodDays}`, {
        signal,
      });
    },
  };
}
