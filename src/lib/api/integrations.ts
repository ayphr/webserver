import type { IntegrationListPayload, IntegrationPayload, IntegrationCreateRequest, IntegrationUpdateRequest, IntegrationTestPayload } from '@common';
import type { RequestClient } from './client';
import { API_PATHS, apiPath } from './generated/routes';

export function createIntegrationsApi(client: RequestClient) {
  return {
    async listMine() {
      const response = await client.requestJson<IntegrationListPayload>(apiPath(API_PATHS.getIntegrations));
      return response.integrations;
    },
    async create(input: IntegrationCreateRequest) {
      const response = await client.requestJson<IntegrationPayload>(apiPath(API_PATHS.postIntegrations), {
        method: 'POST',
        body: input,
      });
      return response.integration;
    },
    async get(id: string) {
      const response = await client.requestJson<IntegrationPayload>(apiPath(API_PATHS.getIntegrationsId, { id: id }));
      return response.integration;
    },
    async update(id: string, input: IntegrationUpdateRequest) {
      const response = await client.requestJson<IntegrationPayload>(apiPath(API_PATHS.patchIntegrationsId, { id: id }), {
        method: 'PATCH',
        body: input,
      });
      return response.integration;
    },
    async remove(id: string) {
      await client.requestJson(apiPath(API_PATHS.deleteIntegrationsId, { id: id }), {
        method: 'DELETE',
      });
    },
    async test(id: string) {
      const response = await client.requestJson<IntegrationTestPayload>(apiPath(API_PATHS.postIntegrationsIdTest, { id: id }), {
        method: 'POST',
      });
      return response;
    },
  };
}