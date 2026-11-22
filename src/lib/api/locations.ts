import type { LocationListPayload, LocationPayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createLocationsApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<LocationListPayload>(apiPath(API_PATHS.getLocations));
      return response.locations;
    },
    async create(name: string) {
      const response = await client.requestJson<LocationPayload>(apiPath(API_PATHS.postLocations), {
        method: 'POST',
        body: { name },
      });
      return response.location;
    },
    async get(id: string) {
      const response = await client.requestJson<LocationPayload>(apiPath(API_PATHS.getLocationsId, { id: id }));
      return response.location;
    },
    async update(id: string, input: { name?: string }) {
      const response = await client.requestJson<LocationPayload>(apiPath(API_PATHS.patchLocationsId, { id: id }), {
        method: 'PATCH',
        body: input,
      });
      return response.location;
    },
    async remove(id: string) {
      await client.requestJson(apiPath(API_PATHS.deleteLocationsId, { id: id }), {
        method: 'DELETE',
      });
    },
  };
}