import type { LocationListPayload, LocationPayload } from '@common';
import type { RequestClient } from './client';

export function createLocationsApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<LocationListPayload>('/api/locations');
      return response.locations;
    },
    async create(name: string) {
      const response = await client.requestJson<LocationPayload>('/api/locations', {
        method: 'POST',
        body: { name },
      });
      return response.location;
    },
    async get(id: string) {
      const response = await client.requestJson<LocationPayload>(`/api/locations/${encodeURIComponent(id)}`);
      return response.location;
    },
    async update(id: string, input: { name?: string }) {
      const response = await client.requestJson<LocationPayload>(`/api/locations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
      });
      return response.location;
    },
    async remove(id: string) {
      await client.requestJson(`/api/locations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
  };
}