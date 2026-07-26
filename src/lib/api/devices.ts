import type { DeviceListPayload, DevicePayload } from '../../../common';
import type { AyphrRequestClient } from './client';

export function createDevicesApi(client: AyphrRequestClient) {
  return {
    async register(input: { serial: number; location: { lat: number; lon: number } }) {
      const response = await client.requestJson<DevicePayload>('/api/devices/register', {
        method: 'POST',
        body: input,
      });
      return response.device;
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
