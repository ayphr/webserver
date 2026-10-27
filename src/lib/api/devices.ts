import type { DeviceListPayload, DevicePayload, DeviceTokenPayload } from '@common';
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
  };
}
