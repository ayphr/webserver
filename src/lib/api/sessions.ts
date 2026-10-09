import type { SessionListPayload } from '../../../common';
import type { RequestClient } from './client';

export function createSessionsApi(client: RequestClient) {
  return {
    async list() {
      const response = await client.requestJson<SessionListPayload>('/api/sessions');
      return response.sessions;
    },
  };
}
