import type {
  AlertCreateRequest,
  AlertListPayload,
  AlertPayload,
  AlertUpdateRequest,
} from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

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
      const response = await client.requestJson<AlertListPayload>(apiPath(API_PATHS.getDevicesSerialAlerts, { serial: serial }));
      return response.alerts;
    },
    async create(serial: number, input: AlertCreateRequest) {
      const response = await client.requestJson<AlertPayload>(apiPath(API_PATHS.postDevicesSerialAlerts, { serial: serial }), {
        method: 'POST',
        body: input,
      });
      return response.alert;
    },
    async update(serial: number, id: string, input: AlertUpdateInput) {
      const response = await client.requestJson<AlertPayload>(
        apiPath(API_PATHS.patchDevicesSerialAlertsId, { serial: serial, id: id }),
        {
          method: 'PATCH',
          body: input,
        },
      );
      return response.alert;
    },
    async remove(serial: number, id: string) {
      await client.requestJson(apiPath(API_PATHS.deleteDevicesSerialAlertsId, { serial: serial, id: id }), {
        method: 'DELETE',
      });
    },
    async testAlert(serial: number, id: string) {
      const response = await client.requestJson<AlertTestResponse>(
        apiPath(API_PATHS.postDevicesSerialAlertsIdTest, { serial: serial, id: id }),
        { method: 'POST' },
      );
      return response.results;
    },
  };
}
