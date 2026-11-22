import type { AssistantState, AssistantStatePayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createAssistantApi(client: RequestClient) {
  return {
    async getState(): Promise<AssistantState> {
      const response = await client.requestJson<AssistantStatePayload>(apiPath(API_PATHS.getAssistant));
      return response.state;
    },
    async saveState(state: AssistantState): Promise<AssistantState> {
      const response = await client.requestJson<AssistantStatePayload>(apiPath(API_PATHS.putAssistant), {
        method: 'PUT',
        body: { state },
      });
      return response.state;
    },
  };
}
