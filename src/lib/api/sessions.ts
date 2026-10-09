import type { SessionListPayload } from '../../../common';
import type { RequestClient } from './client';

export function createSessionsApi(client: RequestClient) {
  return {
    async list() {
      const response = await client.requestJson<SessionListPayload>('/api/sessions');
      return response.sessions;
    },
    async remove(id: string) {
      await client.requestJson<null>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
