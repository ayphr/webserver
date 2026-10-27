import type { Connection } from '@common';
import type { RequestClient } from './client';

export function createConnectionsApi(client: RequestClient) {
  return {
    async list() {
      const response = await client.requestJson<{ connections: Connection[] }>('/api/connections');
      return response.connections;
    },
    async revoke(id: string) {
      await client.requestJson<null>(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
