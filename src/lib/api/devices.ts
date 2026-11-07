import type {
  DeviceDataPointsPayload,
  DeviceLinkPayload,
  DeviceListPayload,
  DevicePairingRequestPayload,
  DevicePairingTokenPayload,
  DevicePayload,
  DeviceUnlinkPayload,
  DeviceUpdatePayload,
} from '@common';
import type { RequestClient } from './client';

export function createDevicesApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<DeviceListPayload>('/api/devices/mine');
      return response.devices;
    },
    async getBySerial(serial: number) {
      const response = await client.requestJson<DevicePayload>(`/api/devices/${serial}`);
      return response.device;
    },
    async getDataPoints(serial: number, options?: { period?: string; from?: string; to?: string }) {
      const params = new URLSearchParams();
      if (options?.period) params.set('period', options.period);
      if (options?.from) params.set('from', options.from);
      if (options?.to) params.set('to', options.to);
      const query = params.toString();
      const path = `/api/devices/${serial}/data${query ? `?${query}` : ''}`;
      return client.requestJson<DeviceDataPointsPayload>(path);
    },
    async getSharedDataPoints(
      serial: number,
      shareToken: string,
      options?: { period?: string; from?: string; to?: string },
    ) {
      const params = new URLSearchParams({ share: shareToken });
      if (options?.period) params.set('period', options.period);
      if (options?.from) params.set('from', options.from);
      if (options?.to) params.set('to', options.to);
      return client.requestJson<DeviceDataPointsPayload>(`/api/devices/${serial}/shared-data?${params.toString()}`);
    },
    async exportData(serial: number, format: 'csv' | 'json', options?: { period?: string; from?: string; to?: string }) {
      const params = new URLSearchParams({ format });
      if (options?.period) params.set('period', options.period);
      if (options?.from) params.set('from', options.from);
      if (options?.to) params.set('to', options.to);
      return client.requestBlob(`/api/devices/${serial}/data/export?${params.toString()}`);
    },
    async getShare(serial: number) {
      const response = await client.requestJson<{
        share: { token: string | null; access: 'restricted' | 'anyone'; invitedUsernames: string[] };
      }>(`/api/devices/${serial}/share`);
      return response.share;
    },
    async updateShare(serial: number, input: { access: 'restricted' | 'anyone'; invitedUsernames: string[] }) {
      const response = await client.requestJson<{
        share: { token: string; access: 'restricted' | 'anyone'; invitedUsernames: string[] };
      }>(`/api/devices/${serial}/share`, { method: 'PUT', body: input });
      return response.share;
    },
    async deleteDataPoints(serial: number, timestamps: (Date | string)[]) {
      return client.requestJson<{ serial: number; removed: number }>(`/api/devices/${serial}/data`, {
        method: 'DELETE',
        body: { timestamps },
      });
    },
    async update(serial: number, input: { name?: string; locationId?: string }) {
      const response = await client.requestJson<DeviceUpdatePayload>(`/api/devices/${serial}`, {
        method: 'PATCH',
        body: input,
      });
      return response.device;
    },
    async unlink(serial: number) {
      return client.requestJson<DeviceUnlinkPayload>(`/api/devices/${serial}`, {
        method: 'DELETE',
      });
    },
    async requestPairing(input: { serial: number; name?: string }) {
      return client.requestJson<DevicePairingRequestPayload>('/api/devices/pair', {
        method: 'POST',
        body: input,
      });
    },
    async linkByCode(code: string, locationId?: string) {
      return client.requestJson<DeviceLinkPayload>('/api/devices/link', {
        method: 'POST',
        body: { code, locationId },
      });
    },
    async fetchPairingToken(code: string) {
      return client.requestJson<DevicePairingTokenPayload>(`/api/devices/pair/${encodeURIComponent(code)}`, {
        method: 'GET',
        auth: false,
      });
    },
  };
}
