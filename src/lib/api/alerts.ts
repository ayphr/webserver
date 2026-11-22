import type {
  AlertCreateRequest,
  AlertListPayload,
  AlertPayload,
  AlertUpdateRequest,
} from '@common';
import type { RequestClient } from './client';

/** Mute updates accept ISO strings from datetime-local inputs alongside Date values. */
export type AlertUpdateInput = Omit<AlertUpdateRequest, 'mutedUntil'> & {
  mutedUntil?: Date | string | null;
};

export type AlertTestResult = {
  integrationId: string;
  ok: boolean;
  status?: number;
  error?: string;
};

export type AlertTestResponse = {
  results: AlertTestResult[];
};

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
    async update(serial: number, id: string, input: AlertUpdateInput) {
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
    async testAlert(serial: number, id: string) {
      const response = await client.requestJson<AlertTestResponse>(
        `/api/devices/${serial}/alerts/${encodeURIComponent(id)}/test`,
        { method: 'POST' },
      );
      return response.results;
    },
  };
}
