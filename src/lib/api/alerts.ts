import type {
  AlertCreateRequest,
  AlertListPayload,
  AlertPayload,
  AlertUpdateRequest,
} from '@common';
import type { RequestClient } from './client';

export function createAlertsApi(client: RequestClient) {
  return {
    async list(serial: number) {
      const response = await client.requestJson<AlertListPayload>(`/api/devices/${serial}/alerts`);
      return response.alerts;
    },
    async create(serial: number, input: AlertCreateRequest) {
      const response = await client.requestJson<AlertPayload>(`/api/devices/${serial}/alerts`, {
        method: 'POST',
        body: input,
      });
      return response.alert;
    },
    async update(serial: number, id: string, input: AlertUpdateRequest) {
      const response = await client.requestJson<AlertPayload>(
        `/api/devices/${serial}/alerts/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: input,
        },
      );
      return response.alert;
    },
    async remove(serial: number, id: string) {
      await client.requestJson(`/api/devices/${serial}/alerts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
  };
}
