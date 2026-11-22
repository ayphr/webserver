import type { SessionListPayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createSessionsApi(client: RequestClient) {
  return {
    async list() {
      const response = await client.requestJson<SessionListPayload>(apiPath(API_PATHS.getSessions));
      return response.sessions;
    },
    async remove(id: string) {
      await client.requestJson<null>(apiPath(API_PATHS.deleteSessionsId, { id: id }), { method: 'DELETE' });
    },
    async removeOthers() {
      await client.requestJson<null>(apiPath(API_PATHS.postAuthLogoutOthers), { method: 'POST' });
    },
  };
}
