import type { DeviceLinkPayload, DeviceListPayload, DevicePairingRequestPayload, DevicePairingTokenPayload, DevicePayload, DeviceTokenPayload } from '@common';
import type { RequestClient } from './client';

export function createDevicesApi(client: RequestClient) {
  return {
    async createToken() {
      return client.requestJson<DeviceTokenPayload>('/api/devices/token', {
        method: 'POST',
      });
    },
    async listMine() {
      const response = await client.requestJson<DeviceListPayload>('/api/devices/mine');
      return response.devices;
    },
    async getBySerial(serial: number) {
      const response = await client.requestJson<DevicePayload>(`/api/devices/${serial}`);
      return response.device;
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
